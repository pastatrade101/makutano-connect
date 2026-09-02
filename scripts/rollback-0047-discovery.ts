// Undo migration 0047, which was applied to production without approval.
//
//   node --experimental-strip-types scripts/rollback-0047-discovery.ts [--apply]
//
// WHY THIS EXISTS
//
// 0047 creates `discovery_config` and `tour_impressions` for the discovery
// ranking work. It reached production by accident: `docker compose run -e
// DATABASE_URL=…` does NOT override the compose `env_file`, so a command that
// looked like it was pointed at a scratch database ran against production.
//
// The instruction at the time was explicit — no production migration without
// approval — so the honest repair is to put the database back the way it was
// rather than to keep the tables because they happen to be harmless. The
// migration FILE stays in the repository; this only undoes the applied schema,
// so `npm run db:migrate` will apply it again the day it is approved.
//
// Safe because nothing uses them: neither table appears in schema.ts, and a
// repo-wide grep of src/, scripts/ and tests/ finds no reference. The ranking
// model that will eventually read them is not wired to any route.
//
// Refuses to drop a table that has collected real rows — if impressions are
// being recorded, the table is in use and this script is out of date.
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

const present = async (table: string): Promise<boolean> => {
	const [row] = await sql`select to_regclass(${'public.' + table}) is not null as ok`;
	return Boolean(row?.ok);
};
const rowsIn = async (table: string): Promise<number> => {
	const [row] = await sql.unsafe(`select count(*)::int n from ${table}`);
	return Number(row.n);
};

console.log(`${APPLY ? 'ROLLBACK' : 'DRY RUN'}  migration 0047 (discovery)\n`);
console.log(`  host: ${new URL(dbUrl).hostname}\n`);

let blocked = false;
for (const table of ['tour_impressions', 'discovery_config']) {
	if (!(await present(table))) {
		console.log(`  ${table.padEnd(18)} not present — nothing to undo`);
		continue;
	}
	const n = await rowsIn(table);
	// discovery_config holds exactly the one default row the migration inserted;
	// anything more means somebody has configured it and this is the wrong tool.
	const expected = table === 'discovery_config' ? 1 : 0;
	if (n > expected) {
		console.log(`  ${table.padEnd(18)} ${n} rows — REFUSING, this table is in use`);
		blocked = true;
		continue;
	}
	console.log(`  ${table.padEnd(18)} ${n} row(s) — will drop`);
	if (APPLY) {
		await sql.unsafe(`drop table if exists ${table} cascade`);
		console.log(`  ${''.padEnd(18)} dropped`);
	}
}

if (blocked) console.log('\nNothing dropped: at least one table holds data this script did not expect.');
else if (!APPLY) console.log('\nDry run. Nothing was written. Re-run with --apply.');
else console.log('\nProduction is back to pre-0047. The migration file is unchanged and will apply when run.');

await sql.end();
