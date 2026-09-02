// Find — and optionally close — accounts left behind when a business was deleted.
//
//   npm run users:orphans              # dry run: reports, changes nothing
//   npm run users:orphans -- --apply   # deactivates them and ends their sessions
//
// WHY THIS EXISTS
//
// Deleting a tenant is a SOFT delete: the row survives for audit, so nothing
// cascades and the people simply stayed. When this was written production held
// four such accounts — and three of them had signed in that same day, weeks
// after their business was gone. They landed nowhere useful, but the password
// still worked.
//
// deleteTenant now closes these at the moment of deletion. This script is for
// the ones already stranded, and as a standing check afterwards.
//
// WHAT COUNTS AS ORPHANED
//
// A user is not owned by a tenant — the same person can be on two — so the test
// is NO remaining membership in a LIVE tenant. A platform admin is never
// included: super admins have no tenant membership by design, and closing them
// would lock the operator out of their own control plane.
//
// WHAT --apply DOES, AND DOES NOT
//
// It sets is_active = false and deletes the sessions. It does NOT delete the
// row. is_active is checked at login AND when a session is resolved, so access
// ends immediately; whereas 30 columns reference users.id with ON DELETE SET
// NULL, and a hard delete would quietly blank that person out of audit rows,
// conversations and quotations that record who did what. Deactivating mirrors
// what the tenant delete itself does.
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

/*
 * Accounts to leave open even though they look orphaned.
 *
 * meta-reviewer@ is the login Meta's App Review team uses to check the product.
 * Its tenant was deleted, which makes it look exactly like an abandoned account
 * — and closing it would mean the next review, or the annual renewal of the
 * WhatsApp permissions, meets a password that no longer works. That failure
 * would arrive months later as a rejection with no obvious cause.
 */
const KEEP = new Set(
	process.argv
		.filter((a, i) => process.argv[i - 1] === '--keep')
		.flatMap((a) => a.split(','))
		.map((a) => a.trim().toLowerCase())
);

if (!process.env.DATABASE_URL) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });

type Row = {
	id: string;
	email: string;
	full_name: string | null;
	is_active: boolean;
	created_at: Date;
	last_login_at: Date | null;
	memberships: number;
	dead_tenants: string | null;
};

const rows = (await sql`
	SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.last_login_at,
		(SELECT count(*)::int FROM tenant_memberships m WHERE m.user_id = u.id) AS memberships,
		(SELECT string_agg(t.slug, ', ')
		   FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
		  WHERE m.user_id = u.id AND t.deleted_at IS NOT NULL) AS dead_tenants
	FROM users u
	WHERE u.is_super_admin = false
	  AND NOT EXISTS (
		SELECT 1 FROM tenant_memberships m
		JOIN tenants t ON t.id = m.tenant_id
		WHERE m.user_id = u.id AND t.deleted_at IS NULL)
	ORDER BY u.created_at
`) as unknown as Row[];

const kept = rows.filter((r) => KEEP.has(r.email.toLowerCase()));
const open = rows.filter((r) => r.is_active && !KEEP.has(r.email.toLowerCase()));

console.log(APPLY ? 'mode     APPLY — accounts will be closed' : 'mode     DRY RUN — nothing will change');
console.log(`orphaned ${rows.length}  (to close: ${open.length}${kept.length ? `, kept by name: ${kept.length}` : ''})\n`);

for (const r of rows) {
	const where = r.memberships === 0 ? 'never joined a tenant' : `deleted tenant: ${r.dead_tenants ?? '?'}`;
	const seen = r.last_login_at ? r.last_login_at.toISOString().slice(0, 10) : 'never';
	const mark = KEEP.has(r.email.toLowerCase()) ? 'KEEP  ' : r.is_active ? 'OPEN  ' : 'closed';
	console.log(`  ${mark} ${r.email.padEnd(32)} last login ${seen}   ${where}`);
}

if (!APPLY) {
	if (open.length) console.log(`\n${open.length} account(s) can still sign in. Re-run with --apply to close them.`);
	await sql.end();
	process.exit(0);
}

let closed = 0;
for (const r of open) {
	await sql`UPDATE users SET is_active = false, updated_at = now() WHERE id = ${r.id}`;
	await sql`DELETE FROM sessions WHERE user_id = ${r.id}`;
	closed++;
}
console.log(`\nclosed ${closed} account(s); their sessions are gone too.`);
console.log('Nothing was deleted — reactivate any of them with is_active = true if this was wrong.');
await sql.end();
