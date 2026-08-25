// Verify the migration folder against a database. Run with: npm run db:check
// (load your .env first, e.g. `set -a; . ./.env`).
//
// Catches the two failures Drizzle cannot: a migration edited after it was applied
// (the change silently never reaches that database) and an applied migration whose
// journal timestamp moved (Drizzle re-runs it and every later migration is blocked).
import crypto from 'node:crypto';
import fs from 'node:fs';
import postgres from 'postgres';
import {
	auditMigrations,
	type AppliedMigration,
	type MigrationFile
} from '../src/lib/server/db/migration-integrity.ts';

const FOLDER = './drizzle';
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL.');
	process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(`${FOLDER}/meta/_journal.json`, 'utf8')) as {
	entries: Array<{ idx: number; when: number; tag: string }>;
};

const files: MigrationFile[] = journal.entries.map((entry) => {
	const path = `${FOLDER}/${entry.tag}.sql`;
	if (!fs.existsSync(path)) {
		console.error(`✗ ${entry.tag}: listed in the journal but ${path} is missing.`);
		process.exit(1);
	}
	const content = fs.readFileSync(path, 'utf8');
	return { tag: entry.tag, when: entry.when, hash: crypto.createHash('sha256').update(content).digest('hex') };
});

// A .sql file nobody references never runs — worth saying out loud.
const known = new Set(journal.entries.map((e) => `${e.tag}.sql`));
for (const name of fs.readdirSync(FOLDER).filter((n) => n.endsWith('.sql'))) {
	if (!known.has(name)) console.warn(`⚠ ${name} is not listed in meta/_journal.json — it will never be applied.`);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
	const rows = (await sql`
		select hash, created_at from drizzle.__drizzle_migrations order by created_at
	`.catch(() => [])) as Array<{ hash: string; created_at: string | number }>;

	const applied: AppliedMigration[] = rows.map((r) => ({ hash: String(r.hash), createdAt: Number(r.created_at) }));
	const problems = auditMigrations(files, applied);

	if (!problems.length) {
		const pending = files.length - applied.length;
		console.log(
			`✓ ${files.length} migrations, ${applied.length} applied${pending > 0 ? `, ${pending} pending` : ''} — folder and database agree.`
		);
	} else {
		for (const p of problems) {
			console.error(`\n✗ ${p.tag} ${p.problem}\n  → ${p.remedy}`);
		}
		console.error(`\n${problems.length} migration problem(s).`);
		process.exitCode = 1;
	}
} finally {
	await sql.end({ timeout: 5 });
}
