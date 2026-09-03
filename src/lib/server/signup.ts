// Public self-signup: account creation, stage resolution and abuse controls.
//
// Nothing here can create a super admin or reach across tenants. Signup produces a
// user; provisioning (provisioning.ts) turns that user into the OWNER of exactly one
// tenant, and every capability that tenant gets comes from its plan row.
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from './audit';
import { hashPassword } from './auth/password';
import { db, schema } from './db';
import { env } from './env';
import { AppError } from './errors';
import { log } from './logger';
import { enforce } from './rate-limit';

/** Bump when the published Terms or Privacy Policy change materially. */
export const TERMS_VERSION = '2026-08-23';

/* ------------------------------------------------------------ passwords ---- */

/** Deliberately short list — the obvious ones, not a 100k-entry dictionary. */
const WEAK = new Set([
	'password', 'password1', 'password123', '12345678', '123456789', 'qwertyui', 'qwerty123',
	'iloveyou', 'letmein1', 'welcome1', 'admin123', 'changeme', 'makutano', 'connect1'
]);

export type PasswordVerdict = { ok: boolean; message?: string; score: number };

export function checkPassword(password: string, email = ''): PasswordVerdict {
	const value = password ?? '';
	if (value.length < 10) return { ok: false, score: 0, message: 'Use at least 10 characters.' };
	if (value.length > 200) return { ok: false, score: 0, message: 'That password is too long.' };
	if (WEAK.has(value.toLowerCase())) return { ok: false, score: 0, message: 'That password is too common.' };
	const local = email.split('@')[0]?.toLowerCase();
	if (local && local.length >= 4 && value.toLowerCase().includes(local)) {
		return { ok: false, score: 1, message: 'Do not use your email address in your password.' };
	}
	let score = 0;
	if (/[a-z]/.test(value)) score++;
	if (/[A-Z]/.test(value)) score++;
	if (/[0-9]/.test(value)) score++;
	if (/[^A-Za-z0-9]/.test(value)) score++;
	if (value.length >= 16) score++;
	if (score < 2) return { ok: false, score, message: 'Mix letters with numbers or symbols.' };
	return { ok: true, score };
}

/* ------------------------------------------------------------ turnstile ---- */

/**
 * Cloudflare Turnstile. Wired but inert until TURNSTILE_SECRET_KEY is set, so the
 * challenge can be switched on in production without another deploy.
 */
export function turnstileEnabled(): boolean {
	const e = env();
	return !!(e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY);
}

export function turnstileSiteKey(): string {
	return env().TURNSTILE_SITE_KEY;
}

export async function verifyTurnstile(token: string | null, ip?: string | null): Promise<boolean> {
	if (!turnstileEnabled()) return true;
	if (!token) return false;
	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ secret: env().TURNSTILE_SECRET_KEY, response: token, remoteip: ip ?? undefined })
		});
		const body = (await res.json()) as { success?: boolean };
		return body.success === true;
	} catch (err) {
		log.warn('turnstile_verify_failed', { error: (err as Error)?.message });
		return false;
	}
}

/* ----------------------------------------------------------- rate limits ---- */

/** Per-IP signup attempts, and a second, tighter budget on verification resends. */
export async function limitSignupAttempts(ipHash: string | null): Promise<void> {
	await enforce(`signup:${ipHash ?? 'unknown'}`, 5, 3600);
}

export async function limitResend(key: string): Promise<void> {
	await enforce(`verify-resend:${key}`, 5, 3600);
}

export async function limitPasswordReset(ipHash: string | null): Promise<void> {
	await enforce(`pwreset:${ipHash ?? 'unknown'}`, 5, 3600);
}

/* ---------------------------------------------------------------- stages ---- */

export type SignupStage =
	/** Account exists, address not proven yet. */
	| 'VERIFY_EMAIL'
	/** Verified, but no tenant — the business form has not been completed. */
	| 'BUSINESS'
	/** Owner of a tenant: the portal is theirs. */
	| 'READY';

/**
 * Where a user belongs right now, derived purely from stored state. Refreshing,
 * bookmarking or coming back a week later therefore always lands on the right screen.
 *
 * Verification only gates users who do not yet belong to a tenant: members provisioned
 * by Platform Admin were vouched for by the admin who added them, and must never be
 * locked out of an account they already use.
 */
export async function stageForUser(user: schema.User): Promise<SignupStage> {
	const memberships = await db()
		.select({ id: schema.tenantMemberships.id })
		.from(schema.tenantMemberships)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
		.where(and(eq(schema.tenantMemberships.userId, user.id), isNull(schema.tenants.deletedAt)))
		.limit(1);
	if (memberships.length > 0) return 'READY';
	if (!user.emailVerifiedAt) return 'VERIFY_EMAIL';
	return 'BUSINESS';
}

/**
 * Where this user belongs after signing in, resetting a password, or landing on
 * the site already authenticated.
 *
 * A SUPER ADMIN has no tenant membership — that is the whole point of the role —
 * so stageForUser() reads "no workspace yet" and sends them to the onboarding
 * wizard to set up a business they will never have. /login had a special case for
 * this and six other entry points did not, so resetting a password dropped the
 * platform owner into "Set up your operation".
 *
 * The rule now lives in one function instead of at each call site, because the
 * evidence is that call sites forget it.
 */
export async function landingPathFor(user: schema.User): Promise<string> {
	if (user.isSuperAdmin) return '/admin';
	return pathForStage(await stageForUser(user));
}

/** The path a user in a given stage should be looking at. */
export function pathForStage(stage: SignupStage): string {
	if (stage === 'VERIFY_EMAIL') return '/verify-email';
	if (stage === 'BUSINESS') return '/onboarding';
	return '/app';
}

/* ------------------------------------------------------------- accounts ---- */

export type CreateAccountInput = {
	email: string;
	fullName: string;
	password: string;
	ipHash?: string | null;
	requestId?: string | null;
	/** Recorded on the signup.started audit row — this is the acceptance record. */
	termsAcceptedAt?: Date;
};

export type CreateAccountResult = {
	user: schema.User;
	/** False when the address was already registered — the caller must not reveal this. */
	created: boolean;
};

/**
 * Create the account, or recognise an unfinished one.
 *
 * A returning visitor who never verified gets their existing account back (with the
 * password they just typed applied), which is what "resume signup" means in practice.
 * An address that already belongs to a usable account is reported as `created: false`
 * and the caller shows the same neutral "check your inbox" screen either way — the
 * signup form must not become an account-existence oracle.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
	const email = input.email.trim().toLowerCase();
	const fullName = input.fullName.trim().slice(0, 120);

	const existing = (await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];

	if (existing) {
		if (existing.emailVerifiedAt || !existing.isActive) {
			return { user: existing, created: false };
		}
		// Unverified and unfinished: the address is not yet proven to belong to anyone,
		// so letting the current visitor re-set the password is safe and is the only way
		// an abandoned signup can be picked up again.
		const [updated] = await db()
			.update(schema.users)
			.set({ passwordHash: await hashPassword(input.password), fullName: fullName || existing.fullName, updatedAt: new Date() })
			.where(eq(schema.users.id, existing.id))
			.returning();
		return { user: updated, created: true };
	}

	const [user] = await db()
		.insert(schema.users)
		.values({
			email,
			fullName,
			passwordHash: await hashPassword(input.password),
			// isSuperAdmin is intentionally absent: it defaults to false and no public
			// code path may ever set it.
			isActive: true
		})
		.returning();

	// The audit row IS the record of consent: who accepted, from which network, when.
	await audit(
		null,
		'signup.started',
		{ type: 'user', userId: user.id, ipHash: input.ipHash, requestId: input.requestId },
		{ type: 'user', id: user.id },
		{
			termsAccepted: true,
			termsAcceptedAt: (input.termsAcceptedAt ?? new Date()).toISOString(),
			termsVersion: TERMS_VERSION
		}
	);
	log.info('signup_account_created', { userId: user.id });
	return { user, created: true };
}

export async function markEmailVerified(user: schema.User, actorIpHash?: string | null): Promise<schema.User> {
	if (user.emailVerifiedAt) return user;
	const [updated] = await db()
		.update(schema.users)
		.set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
		.where(eq(schema.users.id, user.id))
		.returning();
	await audit(null, 'email.verified', { type: 'user', userId: user.id, ipHash: actorIpHash });
	return updated;
}

/** Terms acceptance is recorded on the user's first tenant, not invented per-page. */
export function assertTermsAccepted(accepted: boolean): void {
	if (!accepted) {
		throw new AppError('VALIDATION_ERROR', 'Please accept the Terms of Service and Privacy Policy to continue.');
	}
}
