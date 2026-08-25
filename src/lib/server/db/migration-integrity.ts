// Guards against the way Drizzle actually replays migrations.
//
// Drizzle decides what to apply by TIMESTAMP — it compares each journal entry's
// `when` against the newest `created_at` in drizzle.__drizzle_migrations — and never
// by file content (see drizzle-orm/pg-core/dialect.cjs: `created_at < folderMillis`).
// Two silent failure modes follow, and both have bitten this repo:
//
//   1. Editing an already-applied .sql file changes nothing on databases that ran
//      it. The DDL looks committed but the column is simply missing in production.
//   2. Bumping an applied entry's `when` makes Drizzle re-run the whole file, which
//      dies on "type ... already exists" and blocks every later migration.
//
// Both are invisible until something breaks at runtime, so this audit makes them
// loud. It is pure: the caller supplies the files and the applied rows.

export type MigrationFile = {
	tag: string;
	/** The journal's `when` for this entry. */
	when: number;
	/** sha256 of the .sql file's current content, exactly as Drizzle computes it. */
	hash: string;
};

export type AppliedMigration = { hash: string; createdAt: number };

export type MigrationProblem = {
	tag: string;
	problem: string;
	remedy: string;
};

/**
 * Compare the migration folder against what a database has actually applied.
 * An empty result means the folder and the database agree.
 */
export function auditMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationProblem[] {
	const problems: MigrationProblem[] = [];
	const byCreatedAt = new Map(applied.map((row) => [row.createdAt, row]));
	const byHash = new Map(applied.map((row) => [row.hash, row]));
	const newestApplied = applied.reduce((max, row) => Math.max(max, row.createdAt), -Infinity);

	const seenWhen = new Map<number, string>();
	for (const file of files) {
		const duplicate = seenWhen.get(file.when);
		if (duplicate) {
			problems.push({
				tag: file.tag,
				problem: `shares its journal timestamp (${file.when}) with ${duplicate}.`,
				remedy: 'Give each migration a distinct `when` — Drizzle uses it to decide what still needs applying.'
			});
		}
		seenWhen.set(file.when, file.tag);

		const sameTime = byCreatedAt.get(file.when);
		if (sameTime) {
			// Applied. The only thing that can be wrong is the content having changed.
			if (sameTime.hash !== file.hash) {
				problems.push({
					tag: file.tag,
					problem:
						'was edited after it had already been applied. Databases that ran the earlier version never received the change — Drizzle replays by timestamp, not by content.',
					remedy:
						'Move the new statements into a fresh migration (use IF NOT EXISTS so databases that already have them are unaffected).'
				});
			}
			continue;
		}

		const sameContent = byHash.get(file.hash);
		if (sameContent) {
			// Same file, different timestamp: the journal was edited after applying.
			problems.push({
				tag: file.tag,
				problem: `has journal timestamp ${file.when} but was applied as ${sameContent.createdAt}. Drizzle will try to run it a second time and fail.`,
				remedy: `Restore this entry's \`when\` to ${sameContent.createdAt} in drizzle/meta/_journal.json.`
			});
			continue;
		}

		// Genuinely pending — but only if it sorts after everything already applied.
		if (applied.length && file.when <= newestApplied) {
			problems.push({
				tag: file.tag,
				problem: `is unapplied but its timestamp (${file.when}) is not newer than the last applied migration (${newestApplied}), so Drizzle will skip it forever.`,
				remedy: 'Give it a `when` greater than every applied migration, then run the migration again.'
			});
		}
	}

	return problems;
}
