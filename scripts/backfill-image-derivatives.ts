/**
 * Make the smaller copies for images already in the bucket.
 *
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     --env-file-if-exists=.env scripts/backfill-image-derivatives.ts [--apply] [--limit N]
 *
 * Dry run by default; --apply writes.
 *
 * WHAT AND WHY. Uploads generate derivatives from now on (media.ts), but the
 * bucket already holds 291 media rows and 459 accommodation images — 73MB of
 * camera originals, one of them 7360x4912 — and every one is served at full
 * resolution into boxes as small as 42px. This walks both tables, measures each
 * original, writes the widths that are actually smaller, and records them.
 *
 * SAFE TO RE-RUN AND SAFE TO STOP. Derivative keys are derived from the
 * original's key, so a second pass overwrites its own output rather than
 * littering the bucket. Rows that already carry variants are skipped unless
 * --force. Nothing is ever deleted and no original is touched: the worst a
 * failed run can do is leave some rows unimproved.
 */
import postgres from 'postgres';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { deriveImages, derivativeKey } from '../src/lib/server/media-derivatives';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
	const i = process.argv.indexOf('--limit');
	return i === -1 ? null : Number(process.argv[i + 1]);
})();

const need = (name: string): string => {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set.`);
	return v;
};

const BUCKET = need('R2_BUCKET_NAME');
const r2 = new S3Client({
	region: 'auto',
	endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
	credentials: { accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') }
});

/*
 * Where a derivative goes.
 *
 * The originals are scattered: 163 media rows sit in the configured bucket, 48
 * in a second R2 bucket, 52 still in Supabase storage and two on Unsplash. That
 * does not have to be untangled to fix the weight — every original is publicly
 * fetchable, and the DERIVATIVES all go into the one bucket this deployment
 * owns, which is also the bucket publicUrl() resolves against. So the source can
 * live anywhere and the copies are always somewhere we control.
 *
 * A media row brings its own object_key. An accommodation image has none — the
 * import wrote a URL — so its key is built from that URL's path under a prefix
 * of its own, which keeps derived objects out of the namespace uploads use.
 */
function baseKeyFor(row: Row): string | null {
	if (row.objectKey) return row.objectKey;
	try {
		const path = new URL(row.url).pathname.replace(/^\/+/, '');
		return path ? `marketplace/derived/accommodations/${path}` : null;
	} catch {
		return null;
	}
}

const kb = (n: number) => Math.round(n / 1024);

type Row = { id: string; url: string; objectKey: string | null; mimeType: string | null };

async function processRow(row: Row): Promise<{
	width: number | null;
	height: number | null;
	variants: { w: number; key: string; bytes: number }[];
	originalBytes: number;
	savedFor640: number;
} | null> {
	const key = baseKeyFor(row);
	if (!key) return null;

	const res = await fetch(row.url);
	if (!res.ok) throw new Error(`GET ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	// The stored mime is what the derivative keeps; fall back to the response's.
	const contentType = row.mimeType ?? res.headers.get('content-type') ?? 'image/jpeg';

	const derived = await deriveImages(bytes, contentType);
	const variants: { w: number; key: string; bytes: number }[] = [];
	for (const d of derived.derivatives) {
		const dKey = derivativeKey(key, d.w);
		if (APPLY) {
			await r2.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: dKey,
					Body: d.bytes,
					ContentType: d.contentType,
					// A derivative is immutable: its key encodes the width and the
					// original it came from, so it can be cached for a year.
					CacheControl: 'public, max-age=31536000, immutable'
				})
			);
		}
		variants.push({ w: d.w, key: dKey, bytes: d.bytes.byteLength });
	}
	const at640 = variants.find((v) => v.w === 640) ?? variants[variants.length - 1];
	return {
		width: derived.width,
		height: derived.height,
		variants,
		originalBytes: bytes.byteLength,
		savedFor640: at640 ? bytes.byteLength - at640.bytes : 0
	};
}

async function main() {
	const sql = postgres(need('DIRECT_DATABASE_URL'), { max: 1, onnotice: () => {} });
	console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}${FORCE ? ' (force)' : ''}\n`);

	// jsonb_array_length throws on anything that is not an array, so the type is
	// checked first — a row written wrongly must be re-doable, not a crash.
	const where = FORCE
		? sql``
		: sql`and (variants is null or jsonb_typeof(variants) <> 'array' or jsonb_array_length(variants) = 0)`;
	const media = await sql<Row[]>`
		select id, url, object_key as "objectKey", mime_type as "mimeType"
		  from media where true ${where} order by size desc nulls last ${LIMIT ? sql`limit ${LIMIT}` : sql``}`;
	const stays = await sql<Row[]>`
		select id, url, null as "objectKey", null as "mimeType"
		  from accommodation_images where true ${where} order by id ${LIMIT ? sql`limit ${LIMIT}` : sql``}`;

	console.log(`media: ${media.length} to do   accommodation_images: ${stays.length} to do\n`);

	let done = 0;
	let failed = 0;
	let originalTotal = 0;
	let savedTotal = 0;
	let madeTotal = 0;

	const run = async (rows: Row[], table: 'media' | 'accommodation_images') => {
		for (const row of rows) {
			try {
				const out = await processRow(row);
				if (!out) {
					console.log(`  SKIP (no usable key)  ${row.url.slice(0, 70)}`);
					continue;
				}
				originalTotal += out.originalBytes;
				savedTotal += out.savedFor640;
				madeTotal += out.variants.length;
				if (APPLY) {
					/*
					 * sql.json, not JSON.stringify.
					 *
					 * postgres.js already serialises a JS value for a jsonb parameter, so
					 * handing it a string stores the STRING — jsonb_typeof comes back
					 * 'string' and jsonb_array_length throws on it. Every reader then
					 * sees a value that is present, is not an array, and iterates as
					 * characters.
					 */
					const variants = sql.json(out.variants);
					if (table === 'media') {
						await sql`update media set variants = ${variants}, width = coalesce(${out.width}, width),
						                 height = coalesce(${out.height}, height), updated_at = now() where id = ${row.id}`;
					} else {
						await sql`update accommodation_images set variants = ${variants},
						                 width = coalesce(${out.width}, width), height = coalesce(${out.height}, height)
						           where id = ${row.id}`;
					}
				}
				done++;
				if (done % 25 === 0 || out.originalBytes > 700 * 1024) {
					console.log(
						`  ${String(done).padStart(4)}  ${String(out.width ?? '?').padStart(5)}px  ` +
							`${String(kb(out.originalBytes)).padStart(5)}KB -> ${out.variants.map((v) => `${v.w}:${kb(v.bytes)}KB`).join(' ')}`
					);
				}
			} catch (error) {
				failed++;
				console.log(`  FAIL ${row.id}  ${(error as Error).message}`);
			}
		}
	};

	await run(media, 'media');
	await run(stays, 'accommodation_images');

	console.log('');
	console.log(`  processed        : ${done}   failed: ${failed}`);
	console.log(`  derivatives made : ${madeTotal}`);
	console.log(`  originals        : ${kb(originalTotal)} KB`);
	console.log(
		`  saved per view at the 640px rung: ${kb(savedTotal)} KB (${Math.round((savedTotal / Math.max(1, originalTotal)) * 100)}% lighter)`
	);
	if (!APPLY) console.log('\nDry run — nothing written to R2 or the database. Re-run with --apply.');
	await sql.end();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
