// Record how many bytes each image actually is.
//
//   node --experimental-strip-types scripts/backfill-media-size.ts [--apply] [--limit 500]
//
// media.size is filled in by uploadMedia, which knows the byte length because it
// just handled the bytes. Rows that only REFERENCE a file — the imported
// demonstration listings — never had it, so nothing downstream could tell a 86 KB
// photograph from an 859 KB one. The homepage picks its hero out of that range,
// and picking blind meant a ten-fold difference in what the first paint costs.
//
// One HEAD per row, and only for rows missing a size. Safe to re-run.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, isNull, and, isNotNull } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || 1000;

const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL / SUPABASE_DB_URL.');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const rows = await db
	.select({ id: schema.media.id, url: schema.media.url })
	.from(schema.media)
	.where(and(isNull(schema.media.size), isNotNull(schema.media.url)))
	.limit(LIMIT);

console.log(`${APPLY ? 'BACKFILL' : 'DRY RUN'}  ${rows.length} images with no recorded size`);

/** Content-Length, or null when the host will not say. */
async function byteSize(url: string): Promise<number | null> {
	try {
		const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
		const len = head.headers.get('content-length');
		if (head.ok && len) return Number(len);
		// Some object stores refuse HEAD. One ranged GET is still cheap and
		// returns the full length in Content-Range.
		const ranged = await fetch(url, { headers: { range: 'bytes=0-0' }, redirect: 'follow' });
		const range = ranged.headers.get('content-range');
		const total = range?.split('/')[1];
		return total && total !== '*' ? Number(total) : null;
	} catch {
		return null;
	}
}

let done = 0;
let failed = 0;
const sizes: number[] = [];

// In batches: 127 sequential round trips to two different object stores is a
// minute of waiting for something that is entirely I/O.
const BATCH = 12;
for (let i = 0; i < rows.length; i += BATCH) {
	const batch = rows.slice(i, i + BATCH);
	const measured = await Promise.all(batch.map(async (row) => ({ row, size: await byteSize(row.url) })));
	for (const { row, size } of measured) {
		if (!size || size <= 0) {
			failed++;
			continue;
		}
		sizes.push(size);
		if (APPLY) {
			await db.update(schema.media).set({ size, updatedAt: new Date() }).where(eq(schema.media.id, row.id));
		}
		done++;
	}
	process.stdout.write(`\r  measured ${done + failed}/${rows.length}`);
}

console.log('');
console.log(`  sized      ${done}`);
console.log(`  unreadable ${failed}`);
if (sizes.length) {
	const sorted = [...sizes].sort((a, b) => a - b);
	const kb = (n: number) => `${Math.round(n / 1024)} KB`;
	console.log(`  smallest   ${kb(sorted[0])}`);
	console.log(`  median     ${kb(sorted[Math.floor(sorted.length / 2)])}`);
	console.log(`  largest    ${kb(sorted[sorted.length - 1])}`);
	console.log(`  total      ${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024)} MB`);
}
if (!APPLY) console.log('\nDry run. Nothing was written. Re-run with --apply.');

await sql.end();
