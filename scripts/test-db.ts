// Build a LOCAL test database from nothing: schema, then plans.
//
// Run with: npm run db:test-setup   (DIRECT_DATABASE_URL must be local)
//
// This exists because `npm run db:migrate` CANNOT build a fresh database, and
// the way it fails sends you looking in the wrong place. Drizzle's migrator
// wraps every pending migration in ONE transaction; migration 0035 adds
// 'MARKETPLACE' to the `source` enum and a later one uses it, and Postgres
// refuses to see a new enum label inside the transaction that added it:
//
//     unsafe use of new value "MARKETPLACE" of enum type source
//
// Production never hit this — those files were applied months apart, each in
// its own transaction. Only a from-scratch replay does. So replay the way
// production actually got there: one statement at a time, in autocommit.
import fs from 'node:fs';
import postgres from 'postgres';

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
	console.error('Set DIRECT_DATABASE_URL to a local, throwaway database.');
	process.exit(1);
}
// The suites drop and recreate tenants, and this file's whole job is to make
// that safe. Refuse anything that is not plainly local — the same seatbelt
// tests/pin-database.ts wears, for the same reason.
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) {
	console.error(`Refusing: ${url.replace(/:[^:@/]*@/, ':***@')} is not a local database.`);
	process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
	entries: Array<{ tag: string }>;
};

let applied = 0;
for (const entry of journal.entries) {
	const file = `drizzle/${entry.tag}.sql`;
	if (!fs.existsSync(file)) {
		console.error(`Missing ${file}, listed in the journal.`);
		await sql.end();
		process.exit(1);
	}
	for (const raw of fs.readFileSync(file, 'utf8').split('--> statement-breakpoint')) {
		const statement = raw.trim();
		if (!statement) continue;
		try {
			await sql.unsafe(statement);
			applied++;
		} catch (err) {
			// A fresh database should hit none of these; tolerating them keeps a
			// re-run cheap without hiding a genuine failure.
			if (/already exists|duplicate/i.test((err as Error).message)) continue;
			console.error(`\n${entry.tag}:\n  ${(err as Error).message}\n  ${statement.slice(0, 240)}`);
			await sql.end();
			process.exit(1);
		}
	}
}
await sql.end();
console.log(`Schema: ${applied} statements from ${journal.entries.length} migrations.`);

// Plans are not optional — entitlements resolve against the plan row, so a
// suite run without them fails in a dozen places that have nothing to do with
// whatever you were changing.
await import('./seed.ts');
