// Replace an oversized platform image with a smaller one, in place.
//
//   node --experimental-strip-types scripts/replace-media-file.ts <dir> [--apply]
//
// <dir> holds files named <mediaId>.webp — resize and encode them wherever you
// have the tooling, then point this at the results. It uploads each to R2 and
// repoints the media row.
//
// Written for the destination heroes, which fetch-destination-images.ts pulled
// down at whatever resolution the source happened to be: seventy of them, 36 MB,
// rendered into a 720px tile. One was 1,958 KB.
//
// A NEW object key, never an overwrite. Pages already served carry the old URL
// and the objects are stored immutable for a year, so replacing the bytes under
// a live key would leave caches serving the old file against the new metadata.
// Both objects exist; the old one simply stops being referenced.
//
// Never writes a file that is not smaller than the one it replaces.
import { readdirSync, readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import postgres from 'postgres';

const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/app/tmp-opt';
const APPLY = process.argv.includes('--apply');

/** Fail on the missing variable, not on a request signed with `undefined`. */
function need(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Set ${name}.`);
		process.exit(1);
	}
	return value;
}

const sql = postgres(need('DATABASE_URL'), { prepare: false });
const r2 = new S3Client({
	region: 'auto',
	endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
	credentials: { accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') }
});
const BUCKET = need('R2_BUCKET_NAME');
const base = need('R2_PUBLIC_URL').replace(/\/+$/, '');

const files = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
console.log(`${APPLY ? 'REPLACE' : 'DRY RUN'}  ${files.length} destination heroes`);
let done = 0, saved = 0, skipped = 0;

for (const file of files) {
  const id = file.replace(/\.webp$/, '');
  const [row] = await sql`select id, object_key, size, url from media where id = ${id}`;
  if (!row) { skipped++; continue; }
  const bytes = readFileSync(`${DIR}/${file}`);
  if (row.size && bytes.length >= row.size) { skipped++; continue; }  // never make one bigger
  const key = row.object_key.replace(/\.[a-z0-9]+$/i, '') + '-opt.webp';
  if (APPLY) {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: bytes,
      ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable'
    }));
    await sql`update media set object_key = ${key}, url = ${`${base}/${key}`},
              mime_type = 'image/webp', size = ${bytes.length}, updated_at = now() where id = ${id}`;
  }
  saved += (row.size ?? 0) - bytes.length;
  done++;
}
console.log(`  replaced ${done}`);
console.log(`  skipped  ${skipped} (missing row, or the optimised file was not smaller)`);
console.log(`  saved    ${(saved / 1024 / 1024).toFixed(1)} MB`);
if (!APPLY) console.log('\nDry run. Nothing written. Re-run with --apply.');
await sql.end();
