// Attach an operator's own photographs to one of their tour listings.
//
// This exists because the browser automation used to walk the composer
// end-to-end cannot open a native file picker. A human clicks "Upload" and the
// composer's uploadPhoto action does the work; this does the same work from the
// command line.
//
//   node --experimental-strip-types scripts/attach-tour-photos.ts <tourId> <file>...
//
// It REPLICATES src/lib/server/media.ts rather than importing it. The runtime
// image carries scripts/, drizzle/ and schema.ts but not src/ (see the Dockerfile
// COPY list), so a script that imports the service layer cannot run where the
// database and the R2 credentials actually are. The rules that matter are copied
// deliberately and kept next to each other so a drift is visible:
//
//   - the same content types, and the same 12MB ceiling
//   - the same magic-number check, so a non-image cannot be stored as one
//   - the same object key shape, so the bytes land in the tenant's own prefix
//   - the tenant read FROM THE TOUR, never passed in, so bytes cannot be
//     written into a prefix belonging to someone who does not own the listing
//
// Anything beyond that — entitlements, audit rows — belongs to the real action
// and is not reproduced here; this is an operator tool, not a request handler.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.ts';

const [tourId, ...files] = process.argv.slice(2);
if (!tourId || !files.length) {
	console.error('usage: attach-tour-photos.ts <tourId> <file>...');
	process.exit(1);
}

const missing = [
	'DATABASE_URL',
	'R2_ACCOUNT_ID',
	'R2_ACCESS_KEY_ID',
	'R2_SECRET_ACCESS_KEY',
	'R2_BUCKET_NAME',
	'R2_PUBLIC_URL'
].filter((k) => !process.env[k]);
if (missing.length) {
	console.error(`missing env: ${missing.join(', ')}`);
	process.exit(1);
}

/** Extension per accepted type — the same four media.ts allows. */
const ALLOWED = new Map<string, string>([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/avif', 'avif']
]);
const BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.avif': 'image/avif'
};
const MAX_BYTES = 12 * 1024 * 1024;

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, e));

/** The declared type is a claim; the file's own signature is the fact. */
function looksLikeImage(bytes: Uint8Array, type: string): boolean {
	switch (type) {
		case 'image/jpeg':
			return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case 'image/png':
			return bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG';
		case 'image/webp':
			return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
		case 'image/avif':
			return ascii(bytes, 4, 8) === 'ftyp';
		default:
			return false;
	}
}

const sqlClient = postgres(process.env.DATABASE_URL!, { max: 2 });
const db = drizzle(sqlClient, { schema });

const r2 = new S3Client({
	region: 'auto',
	endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID!,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
	}
});
const publicUrl = (key: string) => `${process.env.R2_PUBLIC_URL!.replace(/\/+$/, '')}/${key}`;

/*
 * The tenant comes from the tour. That is the whole ownership check: a caller
 * who names a listing they do not own cannot thereby write into its prefix,
 * because the prefix is built from what the row says, not from what they asked.
 */
const [tour] = await db
	.select({
		id: schema.tours.id,
		tenantId: schema.tours.tenantId,
		title: schema.tours.title,
		heroMediaId: schema.tours.heroMediaId
	})
	.from(schema.tours)
	.where(and(eq(schema.tours.id, tourId), isNull(schema.tours.deletedAt)))
	.limit(1);
if (!tour) {
	console.error(`no live tour ${tourId}`);
	await sqlClient.end();
	process.exit(1);
}
console.log(`tour: ${tour.title}`);

/**
 * Alt text, by file. Written from looking at the photographs — a gallery of
 * "Safari photo 1..6" is worse than nothing for anyone reading with a screen
 * reader, and it is also what a search engine sees.
 */
const ALT: Record<string, string> = {
	'TWS-00118': 'Guests watching an elephant from an open-roofed safari vehicle on a track beneath acacia trees',
	'TWS-00173':
		'A group of travellers standing at the foot of an enormous baobab, their safari vehicle parked alongside',
	'TWS-00135': 'A young lioness lying in the shade at the base of a tree',
	'TWS-00155': 'A cheetah sitting upright in dry grass beneath thorn scrub',
	'TWS-00094': 'A red-billed hornbill perched on a bare branch',
	'TWS-00081': 'Guests and crew eating lunch together at a long table under the trees in the bush'
};
const altFor = (file: string) => {
	const key = Object.keys(ALT).find((k) => basename(file).includes(k));
	return key ? ALT[key] : null;
};

const mediaIds: string[] = [];
for (const path of files) {
	const name = basename(path);
	const type = BY_EXT[extname(path).toLowerCase()];
	const ext = type ? ALLOWED.get(type) : undefined;
	if (!ext) {
		console.log(`  skip ${name} — unsupported type`);
		continue;
	}

	const bytes = new Uint8Array(readFileSync(path));
	if (!bytes.byteLength) {
		console.log(`  skip ${name} — empty`);
		continue;
	}
	if (bytes.byteLength > MAX_BYTES) {
		console.log(`  skip ${name} — over 12MB`);
		continue;
	}
	if (!looksLikeImage(bytes, type)) {
		console.log(`  skip ${name} — not a valid ${type}`);
		continue;
	}

	const objectKey = `marketplace/tenants/${tour.tenantId}/tours/${tour.id}/gallery/${randomUUID()}.${ext}`;
	await r2.send(
		new PutObjectCommand({
			Bucket: process.env.R2_BUCKET_NAME,
			Key: objectKey,
			Body: bytes,
			ContentType: type,
			// Keys are random and an object is never rewritten, so cache it hard.
			CacheControl: 'public, max-age=31536000, immutable'
		})
	);

	// Object first, row second: a row without an object is a broken image on a
	// public page, an object without a row is only litter in a bucket.
	const [row] = await db
		.insert(schema.media)
		.values({
			tenantId: tour.tenantId,
			objectKey,
			url: publicUrl(objectKey),
			mimeType: type,
			size: bytes.byteLength,
			altText: altFor(path)
		})
		.returning({ id: schema.media.id });

	mediaIds.push(row.id);
	console.log(`  uploaded ${name} → ${objectKey.slice(-45)} (${Math.round(bytes.byteLength / 1024)} KB)`);
}

if (!mediaIds.length) {
	console.error('nothing uploaded');
	await sqlClient.end();
	process.exit(1);
}

// Rewrite the gallery links, exactly as setTourGallery does: the submitted
// order IS the sort order, so the operator's ordering is the one travellers see.
await db.transaction(async (tx) => {
	await tx.delete(schema.tourMedia).where(eq(schema.tourMedia.tourId, tour.id));
	await tx
		.insert(schema.tourMedia)
		.values(mediaIds.map((mediaId, index) => ({ tourId: tour.id, mediaId, sortOrder: index })));
	// The first photo becomes the main picture only if the operator has not
	// already chosen one — this must never quietly replace a deliberate hero.
	await tx
		.update(schema.tours)
		.set({ heroMediaId: tour.heroMediaId ?? mediaIds[0], updatedAt: new Date() })
		.where(eq(schema.tours.id, tour.id));
});

const [{ count }] = (await db.execute(
	sql`select count(*)::int as count from tour_media where tour_id = ${tour.id}`
)) as unknown as Array<{ count: number }>;
console.log(`gallery: ${count} photo(s); hero ${tour.heroMediaId ? 'left as it was' : 'set to the first'}`);

await sqlClient.end();
