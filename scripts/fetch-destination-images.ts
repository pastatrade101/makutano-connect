// Give every Tanzania destination a real photograph.
//
// Source is Wikimedia Commons: no API key, and — the part that matters — images
// are categorised BY SUBJECT. A stock-photo id tells you nothing about what it
// depicts; the last set of those turned out to include a Canadian lake and a
// European castle on Tanzanian destinations.
//
// LICENSING IS THE POINT OF HALF THIS FILE. Commons images are free to use but
// almost all carry CC BY or CC BY-SA, where attribution is a CONDITION of use.
// So licences we cannot honour cleanly are SKIPPED, and the credit, licence and
// source page are stored on the media row for the page to render. A destination
// with no image is better than one with an uncredited image.
//
// Self-contained, like migrate.ts and seed.ts: it opens its own connection and
// imports only schema.ts. The app's server lib uses extensionless imports that
// Vite resolves and plain Node does not, so importing it here would only work
// inside the dev server.
//
//   node --experimental-strip-types scripts/fetch-destination-images.ts [--dry] [--limit N]
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as schema from '../src/lib/server/db/schema.ts';

const UA = 'MakutanoJourneys/1.0 (https://journeys.makutano.co.tz; pastory56@gmail.com)';

/**
 * Licences we will publish under, with the credit shown.
 *
 * GFDL is deliberately absent: it requires the full licence text to travel with
 * the work, which a destination hero cannot honestly do.
 */
const ACCEPTED = /^(cc0|public domain|cc[- ]by[- ]sa [234]\.\d|cc[- ]by [234]\.\d|cc[- ]by|cc[- ]by[- ]sa)$/i;

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.'); process.exit(1); }

const needed = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
const missing = needed.filter((k) => !process.env[k]);
const dry = process.argv.includes('--dry');
if (missing.length && !dry) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1); }

const sql = postgres(url, { max: 2, onnotice: () => {} });
const db = drizzle(sql, { schema });

const r2 = new S3Client({
	region: 'auto',
	endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ''
	}
});

const strip = (html?: string): string =>
	(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

type Candidate = { title: string; url: string; page: string; license: string; artist: string; width: number };

async function search(query: string): Promise<Candidate[]> {
	const params = new URLSearchParams({
		action: 'query', format: 'json', generator: 'search',
		gsrsearch: `${query} Tanzania`, gsrnamespace: '6', gsrlimit: '15',
		prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1600'
	});
	const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'user-agent': UA } });
	if (!res.ok) return [];
	const body = (await res.json()) as { query?: { pages?: Record<string, Record<string, unknown>> } };
	return Object.values(body.query?.pages ?? {})
		.map((p) => {
			const ii = (p.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
			if (!ii) return null;
			const em = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
			return {
				title: String(p.title ?? ''),
				url: String(ii.thumburl ?? ii.url ?? ''),
				page: String(ii.descriptionurl ?? ''),
				license: strip(em.LicenseShortName?.value) || 'unknown',
				artist: strip(em.Artist?.value) || 'Wikimedia Commons contributor',
				width: Number(ii.thumbwidth ?? ii.width ?? 0)
			} as Candidate;
		})
		.filter((c): c is Candidate => Boolean(c?.url));
}

// Maps, flags and diagrams are correctly tagged for the place and useless as a hero.
const usable = (c: Candidate): boolean =>
	ACCEPTED.test(c.license.trim()) &&
	c.width >= 900 &&
	!/\b(map|flag|logo|coat of arms|diagram|chart|seal|locator|sign|signboard|board|notice|gate|entrance|poster|relief|topograph\w*|satellite|3d|model|render|sketch|drawing|stamp|banknote|coin|graph|plot|profile)\b/i.test(c.title) &&
	/\.(jpe?g|png|webp)$/i.test(c.title);

/** Fetch one specific Commons file, bypassing search ranking entirely. */
async function byTitle(title: string): Promise<Candidate[]> {
	const params = new URLSearchParams({
		action: 'query', format: 'json', titles: title,
		prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1600'
	});
	const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'user-agent': UA } });
	if (!res.ok) return [];
	const body = (await res.json()) as { query?: { pages?: Record<string, Record<string, unknown>> } };
	return Object.values(body.query?.pages ?? {})
		.map((p) => {
			const ii = (p.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
			if (!ii) return null;
			const em = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
			return {
				title: String(p.title ?? ''),
				url: String(ii.thumburl ?? ii.url ?? ''),
				page: String(ii.descriptionurl ?? ''),
				license: strip(em.LicenseShortName?.value) || 'unknown',
				artist: strip(em.Artist?.value) || 'Wikimedia Commons contributor',
				width: Number(ii.thumbwidth ?? ii.width ?? 0)
			} as Candidate;
		})
		.filter((c): c is Candidate => Boolean(c?.url));
}

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) || Infinity : Infinity;

// --only <slug,slug> redoes specific destinations, including ones that already
// have an image — used when a picked photo turns out to be wrong for the place.
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean) : [];

// A hand-written query hint, for places whose name alone returns the wrong thing.
/**
 * An exact Commons file, for the handful of places where search keeps returning
 * something correctly tagged and visually useless.
 *
 * Kilimanjaro earned its entry: search gave a 3D relief model, then a park
 * notice board. Both are genuinely "Kilimanjaro" images and neither is a
 * mountain. Naming the file is more honest than tuning keywords until the
 * ranking happens to cooperate.
 */
const FILE_OVERRIDE: Record<string, string> = {
	'mount-kilimanjaro': 'File:Kilimanjaro from Amboseli.jpg'
};

const QUERY_HINT: Record<string, string> = {
	zanzibar: 'Zanzibar beach coast',
	'mount-kilimanjaro': 'Kilimanjaro mountain summit photograph',
	'tarangire-national-park': 'Tarangire baobab elephants'
};

const rows = await db
	.select({ id: schema.destinations.id, name: schema.destinations.name, slug: schema.destinations.slug })
	.from(schema.destinations)
	.where(
		only.length
			? and(inArray(schema.destinations.slug, only), eq(schema.destinations.status, 'PUBLISHED'))
			: and(isNull(schema.destinations.heroMediaId), eq(schema.destinations.status, 'PUBLISHED'))
	);

console.log(`${rows.length} destinations without a hero image${dry ? '  (dry run — nothing will be written)' : ''}\n`);

let done = 0, skipped = 0;
for (const d of rows.slice(0, Number.isFinite(limit) ? limit : undefined)) {
	try {
		const named = FILE_OVERRIDE[d.slug];
		const picks = named ? await byTitle(named) : (await search(QUERY_HINT[d.slug] ?? d.name)).filter(usable);
		if (!picks.length) { console.log(`SKIP  ${d.slug} — nothing usably licensed`); skipped++; continue; }

		const pick = picks[0];
		const credit = `${pick.artist} · ${pick.license} · Wikimedia Commons`;
		if (dry) {
			console.log(`OK    ${d.slug}\n        ${pick.title.replace(/^File:/, '').slice(0, 70)}\n        ${credit.slice(0, 90)}`);
			done++; continue;
		}

		const img = await fetch(pick.url, { headers: { 'user-agent': UA } });
		if (!img.ok) { console.log(`SKIP  ${d.slug} — download ${img.status}`); skipped++; continue; }
		const bytes = new Uint8Array(await img.arrayBuffer());
		const contentType = (img.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
		const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

		// Same key shape the app generates: platform assets live under the platform
		// prefix and carry no tenant.
		const objectKey = `marketplace/platform/destinations/${d.id}/${randomUUID()}.${ext}`;
		await r2.send(new PutObjectCommand({
			Bucket: process.env.R2_BUCKET_NAME, Key: objectKey, Body: bytes,
			ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable'
		}));

		const [media] = await db.insert(schema.media).values({
			tenantId: null, // platform-owned
			objectKey,
			url: `${(process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '')}/${objectKey}`,
			mimeType: contentType, size: bytes.byteLength, altText: d.name,
			attribution: credit, license: pick.license, sourceUrl: pick.page
		}).returning();

		await db.update(schema.destinations)
			.set({ heroMediaId: media.id, updatedAt: new Date() })
			.where(eq(schema.destinations.id, d.id));

		console.log(`SET   ${d.slug} — ${credit.slice(0, 80)}`);
		done++;
	} catch (err) {
		console.log(`FAIL  ${d.slug} — ${(err as Error).message}`);
		skipped++;
	}
	// Commons asks for courteous request rates, and this is a bulk backfill.
	await new Promise((r) => setTimeout(r, 350));
}

console.log(`\n${done} set, ${skipped} skipped.`);
await sql.end();
process.exit(0);
