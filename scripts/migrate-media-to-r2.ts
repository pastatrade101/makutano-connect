// Move every stored image into ONE bucket, and repoint the rows at it.
//
//   npm run media:migrate              # dry run: says what would move, touches nothing
//   npm run media:migrate -- --apply   # copies the bytes, then updates the rows
//   npm run media:migrate -- --apply --limit 5
//
// WHY THIS EXISTS
//
// The media table grew three homes. Counted before this script was written:
//
//   pub-90c6162a….r2.dev   82 rows  18.6 MB  the configured R2 bucket
//   …supabase.co           79 rows  47.7 MB  Supabase Storage, marked EXTERNAL
//   pub-8de96adc….r2.dev   48 rows   7.0 MB  the Goldfinch bucket the catalogue
//                                            was imported from, also EXTERNAL
//
// Two of those are somebody else's storage. The imported tour photography in
// particular lives in an account this project does not control, so every one of
// those 48 images is a picture that disappears the day that bucket does. This
// consolidates all of it into the bucket named by the R2_* variables.
//
// THE ORDER MATTERS. For each row: fetch the bytes, PUT them, fetch them back
// over the PUBLIC url to prove the object is really readable, and only then
// update the row. Updating first and copying second would point production at
// objects that might not arrive.
//
// IT NEVER DELETES. The old buckets keep their copies, so a bad run costs
// nothing but duplicate storage and can simply be run again. Empty them by hand
// once the new URLs have been serving for a while.
//
// IT IS IDEMPOTENT. A row already pointing at the target public base is skipped,
// so an interrupted run is resumed by running it again.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const need = [
	'DATABASE_URL',
	'R2_ACCOUNT_ID',
	'R2_ACCESS_KEY_ID',
	'R2_SECRET_ACCESS_KEY',
	'R2_BUCKET_NAME',
	'R2_PUBLIC_URL'
];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
	console.error(`Missing: ${missing.join(', ')}`);
	console.error('Fill them in .env first, then: npm run verify:r2');
	process.exit(1);
}

const ACCOUNT = process.env.R2_ACCOUNT_ID!;
const BUCKET = process.env.R2_BUCKET_NAME!;
const PUBLIC = process.env.R2_PUBLIC_URL!.replace(/\/+$/, '');

// Truncated on purpose: enough to confirm WHICH account answered, without the
// value ending up in a terminal log.
console.log(`account  ${ACCOUNT.slice(0, 6)}…`);
console.log(`bucket   ${BUCKET}`);
console.log(`public   ${PUBLIC}`);
console.log(APPLY ? 'mode     APPLY — will copy and update rows' : 'mode     DRY RUN — nothing will change');
console.log('');

const s3 = new S3Client({
	region: 'auto',
	endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID!,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
	}
});

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });

/**
 * Sources this migration does not touch.
 *
 * The Goldfinch bucket is left exactly as it is, by instruction. Its 48 images
 * are neither read nor copied, and their rows keep pointing at it.
 *
 * Be clear about what that means: those tour photographs stay in storage this
 * project does not control, so they remain pictures that disappear the day that
 * bucket does. That is a deliberate choice, not an oversight — delete the host
 * from this list and re-run to bring them across.
 */
const SKIP_HOSTS = ['pub-8de96adc0f804576b6233fa914136e0d.r2.dev'];

const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
};

/** The same allowlist media.ts enforces on upload. Anything else is not copied. */
const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif'
};

/**
 * Where a row's image belongs in the new bucket.
 *
 * A key that already follows the convention is KEPT — those objects are only
 * changing bucket, and rewriting their keys would invalidate nothing but make
 * every existing key untraceable. The synthetic `external/<host>/…` keys are
 * replaced: they encode the old host, which is exactly what is being left
 * behind. Where the owning row can be identified the real prefix is used, and
 * anything unclaimed lands in `imported/` rather than being guessed at.
 */
function targetKey(row: MediaRow): string {
	if (row.object_key.startsWith('marketplace/')) return row.object_key;

	const ext = EXT[row.mime_type ?? ''] ?? row.object_key.split('.').pop() ?? 'jpg';
	const name = `${randomUUID()}.${ext}`;

	if (row.owner_kind === 'country') return `marketplace/platform/countries/${row.owner_id}/${name}`;
	if (row.owner_kind === 'destination') return `marketplace/platform/destinations/${row.owner_id}/${name}`;
	if (row.owner_kind === 'category') return `marketplace/platform/categories/${row.owner_id}/${name}`;
	if (row.owner_kind === 'style') return `marketplace/platform/travel-styles/${row.owner_id}/${name}`;
	if (row.owner_kind === 'operator' && row.owner_tenant)
		return `marketplace/tenants/${row.owner_tenant}/operator/${name}`;
	if (row.owner_kind === 'tour-hero' && row.owner_tenant)
		return `marketplace/tenants/${row.owner_tenant}/tours/${row.owner_id}/hero/${name}`;
	if (row.owner_kind === 'tour-gallery' && row.owner_tenant)
		return `marketplace/tenants/${row.owner_tenant}/tours/${row.owner_id}/gallery/${name}`;
	if (row.owner_kind === 'itinerary' && row.owner_tenant)
		return `marketplace/tenants/${row.owner_tenant}/tours/${row.owner_tour}/itinerary/${row.owner_id}/${name}`;

	return `marketplace/imported/${name}`;
}

type MediaRow = {
	id: string;
	object_key: string;
	url: string;
	mime_type: string | null;
	size: number | null;
	owner_kind: string | null;
	owner_id: string | null;
	owner_tenant: string | null;
	owner_tour: string | null;
};

/**
 * Every media row, with whatever owns it.
 *
 * The owner is only used to shape a key, so a row claimed by two things (a
 * picture used as both a tour hero and a gallery image) is served fine by
 * whichever the join reaches first — DISTINCT ON keeps it to one.
 */
const rows = (await sql`
	SELECT DISTINCT ON (m.id)
		m.id, m.object_key, m.url, m.mime_type, m.size,
		o.kind AS owner_kind, o.owner_id, o.owner_tenant, o.owner_tour
	FROM media m
	LEFT JOIN (
		SELECT 'country'      AS kind, id AS owner_id, NULL::uuid AS owner_tenant, NULL::uuid AS owner_tour, hero_media_id AS mid FROM countries        WHERE hero_media_id IS NOT NULL
		UNION ALL SELECT 'destination',  id, NULL::uuid, NULL::uuid, hero_media_id FROM destinations     WHERE hero_media_id IS NOT NULL
		UNION ALL SELECT 'category',     id, NULL::uuid, NULL::uuid, hero_media_id FROM tour_categories  WHERE hero_media_id IS NOT NULL
		UNION ALL SELECT 'style',        id, NULL::uuid, NULL::uuid, hero_media_id FROM travel_styles    WHERE hero_media_id IS NOT NULL
		UNION ALL SELECT 'operator',     id, tenant_id,  NULL::uuid, logo_media_id  FROM operator_profiles WHERE logo_media_id IS NOT NULL
		UNION ALL SELECT 'operator',     id, tenant_id,  NULL::uuid, cover_media_id FROM operator_profiles WHERE cover_media_id IS NOT NULL
		UNION ALL SELECT 'tour-hero',    id, tenant_id,  NULL::uuid, hero_media_id  FROM tours            WHERE hero_media_id IS NOT NULL
		UNION ALL SELECT 'tour-gallery', tm.tour_id, t2.tenant_id, NULL::uuid, tm.media_id FROM tour_media tm JOIN tours t2 ON t2.id = tm.tour_id
		UNION ALL SELECT 'itinerary',    d.id, t.tenant_id, t.id,   d.media_id      FROM tour_itinerary_days d JOIN tours t ON t.id = d.tour_id WHERE d.media_id IS NOT NULL
	) o ON o.mid = m.id
	ORDER BY m.id, o.kind
`) as unknown as MediaRow[];

console.log(`${rows.length} media rows\n`);

let moved = 0;
let skipped = 0;
let left = 0;
const failures: { id: string; url: string; why: string }[] = [];

for (const row of rows) {
	if (moved + skipped >= LIMIT) break;

	// Already home. This is what makes the script resumable.
	if (row.url.startsWith(`${PUBLIC}/`)) {
		skipped++;
		continue;
	}

	// Left alone on purpose. Not read, not copied, row not touched.
	if (SKIP_HOSTS.includes(hostOf(row.url))) {
		left++;
		continue;
	}

	const key = targetKey(row);

	if (!APPLY) {
		console.log(`would move  ${row.url.slice(0, 68)}\n         ->  ${key}`);
		moved++;
		continue;
	}

	try {
		const res = await fetch(row.url);
		if (!res.ok) throw new Error(`source ${res.status}`);
		const type = res.headers.get('content-type')?.split(';')[0] ?? row.mime_type ?? '';
		const body = Buffer.from(await res.arrayBuffer());
		if (!body.length) throw new Error('source returned 0 bytes');

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: key,
				Body: body,
				ContentType: type || 'application/octet-stream',
				// A year, immutable: these keys carry a UUID, so the bytes behind one
				// never change. This is the header media.ts sets on its own uploads.
				CacheControl: 'public, max-age=31536000, immutable'
			})
		);

		// Prove it is READABLE over the public URL before trusting it. A PUT that
		// succeeded against a bucket with no public access still leaves every page
		// on the site showing a broken image.
		const check = await fetch(`${PUBLIC}/${key}`, { method: 'GET' });
		if (!check.ok) throw new Error(`public url ${check.status} after upload`);
		const got = Number(check.headers.get('content-length') ?? 0);
		if (got && got !== body.length) throw new Error(`size mismatch ${got} != ${body.length}`);

		await sql`
			UPDATE media
			SET object_key = ${key}, url = ${`${PUBLIC}/${key}`},
			    storage_provider = 'R2', size = ${body.length},
			    mime_type = ${type || row.mime_type}, updated_at = now()
			WHERE id = ${row.id}`;

		moved++;
		if (moved % 10 === 0) console.log(`  ${moved} moved…`);
	} catch (err) {
		failures.push({ id: row.id, url: row.url, why: err instanceof Error ? err.message : String(err) });
	}
}

console.log('');
console.log(`moved    ${moved}`);
console.log(`skipped  ${skipped} (already on ${PUBLIC})`);
console.log(`left     ${left} untouched on ${SKIP_HOSTS.join(', ')}`);
console.log(`failed   ${failures.length}`);
for (const f of failures) console.log(`  ${f.id}  ${f.why}\n    ${f.url}`);

await sql.end();
if (failures.length) process.exit(1);
