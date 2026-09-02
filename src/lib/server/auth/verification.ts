// Email verification and password-reset tokens.
//
// Same discipline as sessions: the emailed token is random, and only its sha-256 is
// stored. Consumption is a single conditional UPDATE, which makes a replayed link a
// no-op rather than a race — two simultaneous clicks cannot both verify.
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../encryption';
import { enqueue } from '../jobs/queue';
import { existingAccountEmail, passwordResetEmail, verificationEmail } from '../email';
import { env } from '../env';
import { log } from '../logger';

const TTL_MS: Record<schema.VerificationPurpose, number> = {
	EMAIL_VERIFICATION: 1000 * 60 * 60 * 24, // 24 hours
	PASSWORD_RESET: 1000 * 60 * 60, // 1 hour
	TEAM_INVITE: 1000 * 60 * 60 * 24 * 7 // 7 days — office invites get read slowly
};

export function ttlHours(purpose: schema.VerificationPurpose): number {
	return Math.round(TTL_MS[purpose] / (1000 * 60 * 60));
}

/**
 * Mint a token. Any earlier unconsumed token for the same user and purpose is retired
 * first, so the most recent email in someone's inbox is always the only one that works.
 */
export async function issueToken(
	userId: string,
	purpose: schema.VerificationPurpose,
	ipHash?: string | null,
	tenantId?: string | null
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + TTL_MS[purpose]);

	await db()
		.update(schema.verificationTokens)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(schema.verificationTokens.userId, userId),
				eq(schema.verificationTokens.purpose, purpose),
				isNull(schema.verificationTokens.consumedAt)
			)
		);

	await db().insert(schema.verificationTokens).values({
		userId,
		purpose,
		tenantId: tenantId ?? null,
		tokenHash: sha256(token),
		expiresAt,
		ipHash: ipHash ?? null
	});

	return { token, expiresAt };
}

/**
 * Spend a token. Returns the user it belonged to, or null when it is unknown, expired
 * or already used — the caller must not distinguish those cases to the visitor.
 */
export async function consumeToken(
	token: string,
	purpose: schema.VerificationPurpose
): Promise<schema.User | null> {
	if (!token) return null;
	const rows = (await db().execute<{ user_id: string }>(sql`
		update verification_tokens
		set consumed_at = now()
		where token_hash = ${sha256(token)}
			and purpose = ${purpose}
			and consumed_at is null
			and expires_at > now()
		returning user_id
	`)) as unknown as Array<{ user_id: string }>;

	const userId = rows[0]?.user_id;
	if (!userId) return null;

	const users = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
	return users[0] ?? null;
}

/** Like consumeToken, but also returns the tenant an invite is bound to. */
export async function consumeInviteToken(
	token: string
): Promise<{ user: schema.User; tenantId: string } | null> {
	if (!token) return null;
	const rows = (await db().execute<{ user_id: string; tenant_id: string | null }>(sql`
		update verification_tokens
		set consumed_at = now()
		where token_hash = ${sha256(token)}
			and purpose = 'TEAM_INVITE'
			and consumed_at is null
			and expires_at > now()
		returning user_id, tenant_id
	`)) as unknown as Array<{ user_id: string; tenant_id: string | null }>;
	const row = rows[0];
	if (!row?.tenant_id) return null;
	const users = await db().select().from(schema.users).where(eq(schema.users.id, row.user_id)).limit(1);
	return users[0] ? { user: users[0], tenantId: row.tenant_id } : null;
}

/**
 * Who a TEAM_INVITE token belongs to, alive or dead — WITHOUT spending it.
 *
 * consumeInviteToken deliberately matches only tokens that are unspent and
 * unexpired, which is right for acceptance and useless for the case that
 * actually strands people: a link that has expired. Somebody holding a real but
 * dead token has still PROVED they were invited, and the token names the exact
 * user and tenant, so a new link can be issued to them without anyone having to
 * type an address. The new link goes to the invited address, never to whoever
 * presented the token — so a stale link that leaks gains an attacker nothing.
 *
 * Read-only on purpose: an email scanner prefetching the page must not burn the
 * invitation, which is why the acceptance path spends the token on submit only.
 */
export async function inviteTokenOwner(
	token: string
): Promise<{ user: schema.User; tenantId: string; expiresAt: Date; consumedAt: Date | null } | null> {
	if (!token) return null;
	const [row] = await db()
		.select()
		.from(schema.verificationTokens)
		.where(
			and(
				eq(schema.verificationTokens.tokenHash, sha256(token)),
				eq(schema.verificationTokens.purpose, 'TEAM_INVITE')
			)
		)
		.limit(1);
	if (!row?.tenantId) return null;
	const users = await db().select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
	return users[0]
		? { user: users[0], tenantId: row.tenantId, expiresAt: row.expiresAt, consumedAt: row.consumedAt }
		: null;
}

function appUrl(): string {
	return env().PUBLIC_APP_URL.replace(/\/+$/, '');
}

/** Queue the verification email. Delivery itself is the job queue's problem. */
export async function sendVerificationEmail(user: schema.User, ipHash?: string | null): Promise<void> {
	const { token } = await issueToken(user.id, 'EMAIL_VERIFICATION', ipHash);
	const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
	const body = verificationEmail(link, ttlHours('EMAIL_VERIFICATION'));
	await enqueue('email.send', { to: user.email, ...body });
	log.info('verification_email_queued', { userId: user.id });
}

/**
 * Tell the owner of an existing address that someone tried to sign up as them. No token
 * is issued: there is nothing here to verify.
 */
export async function sendExistingAccountNotice(email: string): Promise<void> {
	const body = existingAccountEmail(`${appUrl()}/login`, `${appUrl()}/forgot-password`);
	await enqueue('email.send', { to: email, ...body });
	log.info('existing_account_notice_queued', {});
}

export async function sendPasswordResetEmail(user: schema.User, ipHash?: string | null): Promise<void> {
	const { token } = await issueToken(user.id, 'PASSWORD_RESET', ipHash);
	const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
	const body = passwordResetEmail(link, ttlHours('PASSWORD_RESET'));
	await enqueue('email.send', { to: user.email, ...body });
	log.info('password_reset_email_queued', { userId: user.id });
}

/** Housekeeping — expired rows carry no value once they can no longer be spent. */
export async function purgeExpiredTokens(): Promise<number> {
	const deleted = await db()
		.delete(schema.verificationTokens)
		.where(lt(schema.verificationTokens.expiresAt, new Date(Date.now() - 1000 * 60 * 60 * 24 * 7)))
		.returning({ id: schema.verificationTokens.id });
	return deleted.length;
}
