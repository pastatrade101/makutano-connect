// Issue a password-reset link for a locked-out account, out of band.
//
//   node --experimental-strip-types scripts/issue-admin-reset.ts <email>
//
// WHY THIS EXISTS
//
// The reset email is the normal route and it stays the normal route. This is for the
// case where the account is a super admin, the mail did not arrive, and there is
// nobody else who can let them back in — a platform with one locked-out owner has no
// other door.
//
// It does NOT set a password and never handles one. It mints exactly what the email
// would have contained: a single-use token the owner spends themselves on
// /reset-password, where THEY choose the password. Nobody but them ever sees it.
//
// Mirrors issueToken() in src/lib/server/auth/verification.ts, including the part that
// matters for safety: every older unconsumed reset for this account is consumed first,
// so a link sitting in an inbox somewhere stops working the moment this one is made.
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';

const email = process.argv[2];
if (!email) {
	console.error('usage: issue-admin-reset.ts <email>');
	process.exit(1);
}

const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.');
	process.exit(1);
}
/*
 * The base URL, with localhost refused.
 *
 * This script is run from a developer machine whose .env points PUBLIC_APP_URL at a
 * dev server, which would produce a link to a port only that machine can reach — a
 * recovery link nobody can use. Pass --url to override; otherwise production.
 */
const urlArg = process.argv.indexOf('--url');
const envUrl = process.env.PUBLIC_APP_URL ?? '';
const appUrl = (
	urlArg > -1 ? process.argv[urlArg + 1]
	: /localhost|127\.0\.0\.1/.test(envUrl) || !envUrl ? 'https://connect.makutano.co.tz'
	: envUrl
).replace(/\/+$/, '');

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

const [user] = await sql`
	select id, email, is_active, is_super_admin from users where lower(email) = lower(${email})
`;
if (!user) {
	console.error(`No user with the email ${email}.`);
	await sql.end();
	process.exit(1);
}
if (!user.is_active) {
	// Worth refusing rather than silently helping: an inactive account being reset is
	// either a mistake or somebody's idea of a way in.
	console.error('That account is not active. Reactivate it deliberately before issuing a reset.');
	await sql.end();
	process.exit(1);
}

// Same shape as randomToken(32) / sha256() in src/lib/server/encryption.ts.
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
// PASSWORD_RESET TTL in verification.ts is one hour.
const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

const invalidated = await sql`
	update verification_tokens set consumed_at = now()
	where user_id = ${user.id} and purpose = 'PASSWORD_RESET' and consumed_at is null
	returning id
`;

await sql`
	insert into verification_tokens (user_id, purpose, token_hash, expires_at)
	values (${user.id}, 'PASSWORD_RESET', ${tokenHash}, ${expiresAt.toISOString()}::timestamptz)
`;

console.log(`\nReset link for ${user.email}${user.is_super_admin ? ' (super admin)' : ''}:\n`);
console.log(`  ${appUrl}/reset-password?token=${encodeURIComponent(token)}\n`);
console.log(`  Valid for one hour, until ${expiresAt.toISOString()}.`);
console.log(`  Single use. ${invalidated.length} earlier unused reset link(s) were cancelled.`);
console.log(`  You choose the new password on that page — it is never typed or stored here.\n`);

await sql.end();
