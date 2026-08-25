// Migration integrity: the failure modes Drizzle cannot see, plus a live check that
// this repo's migration folder still agrees with the database.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditMigrations, type AppliedMigration, type MigrationFile } from '../src/lib/server/db/migration-integrity';

const file = (tag: string, when: number, content: string): MigrationFile => ({
	tag,
	when,
	hash: crypto.createHash('sha256').update(content).digest('hex')
});
const appliedFrom = (f: MigrationFile): AppliedMigration => ({ hash: f.hash, createdAt: f.when });

describe('migration integrity', () => {
	it('says nothing when the folder and the database agree', () => {
		const a = file('0001_first', 100, 'create table a();');
		const b = file('0002_second', 200, 'create table b();');
		expect(auditMigrations([a, b], [appliedFrom(a), appliedFrom(b)])).toEqual([]);
	});

	it('catches a migration edited after it was applied — the change never reached the database', () => {
		const original = file('0010_order_links', 100, 'create type x as enum();');
		const edited = file('0010_order_links', 100, 'create type x as enum();\nalter table orders add column y text;');
		const problems = auditMigrations([edited], [appliedFrom(original)]);
		expect(problems).toHaveLength(1);
		expect(problems[0].problem).toContain('edited after it had already been applied');
		expect(problems[0].remedy).toContain('fresh migration');
	});

	it('catches a bumped journal timestamp before Drizzle re-runs the file and fails', () => {
		const applied = file('0010_order_links', 1787604000000, 'create type x as enum();');
		const bumped = { ...applied, when: 1787606212790 };
		const problems = auditMigrations([bumped], [appliedFrom(applied)]);
		expect(problems).toHaveLength(1);
		expect(problems[0].problem).toContain('applied as 1787604000000');
		expect(problems[0].remedy).toContain('1787604000000');
	});

	it('catches a pending migration that sorts before the last applied one, so it would never run', () => {
		const applied = file('0002_second', 200, 'create table b();');
		const stale = file('0003_third', 150, 'create table c();');
		const problems = auditMigrations([applied, stale], [appliedFrom(applied)]);
		expect(problems).toHaveLength(1);
		expect(problems[0].tag).toBe('0003_third');
		expect(problems[0].problem).toContain('skip it forever');
	});

	it('accepts a genuinely pending migration, and flags duplicate timestamps', () => {
		const applied = file('0001_first', 100, 'create table a();');
		const next = file('0002_second', 200, 'create table b();');
		expect(auditMigrations([applied, next], [appliedFrom(applied)])).toEqual([]);

		const clash = file('0003_third', 200, 'create table c();');
		const problems = auditMigrations([applied, next, clash], [appliedFrom(applied)]);
		expect(problems.some((p) => p.problem.includes('shares its journal timestamp'))).toBe(true);
	});

	it('this repo: every journal entry has a file, and timestamps only increase', () => {
		const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
			entries: Array<{ idx: number; when: number; tag: string }>;
		};
		expect(journal.entries.length).toBeGreaterThan(0);
		let previous = -Infinity;
		for (const entry of journal.entries) {
			expect(fs.existsSync(`drizzle/${entry.tag}.sql`), `${entry.tag}.sql is missing`).toBe(true);
			expect(entry.when, `${entry.tag} does not sort after the migration before it`).toBeGreaterThan(previous);
			previous = entry.when;
		}
		// And no stray .sql file that the journal never references.
		const known = new Set(journal.entries.map((e) => `${e.tag}.sql`));
		const strays = fs.readdirSync('drizzle').filter((n) => n.endsWith('.sql') && !known.has(n));
		expect(strays, `unreferenced migration files: ${strays.join(', ')}`).toEqual([]);
	});
});
