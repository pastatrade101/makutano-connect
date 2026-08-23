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
	PASSWORD_RESET: 1000 * 60 * 60 // 1 hour
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
	ipHash?: string | null
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
