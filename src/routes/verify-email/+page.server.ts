// Two jobs in one route: spend a token arriving from an email link, and act as the
// "check your inbox" holding page (with a resend button) for a signed-in, unverified user.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { consumeToken, sendVerificationEmail, ttlHours } from '$lib/server/auth/verification';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { emailReady } from '$lib/server/env';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { limitResend, markEmailVerified, pathForStage, stageForUser } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

/** Show only enough of an address to recognise it: a****@example.com. */
function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!domain) return email;
	const head = local.slice(0, 1);
	return `${head}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token');

	if (token) {
		const user = await consumeToken(token, 'EMAIL_VERIFICATION');
		if (!user) {
			// Unknown, expired or already spent — all the same to the visitor.
			return { state: 'invalid' as const, email: null, sent: false, emailConfigured: emailReady(), ttlHours: ttlHours('EMAIL_VERIFICATION') };
		}
		await markEmailVerified(user, event.locals.ipHash);

		// The link may well be opened in a different browser from the one that signed up,
		// so establish a session here rather than sending them back to the login form.
		if (!event.locals.user || event.locals.user.id !== user.id) {
			const session = await createSession(user.id, {
				userAgent: event.request.headers.get('user-agent'),
				ipHash: event.locals.ipHash
			});
			setSessionCookie(event.cookies, session.token, session.expiresAt);
		}
		await db().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));

		const fresh = (await db().select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1))[0];
		redirect(303, pathForStage(await stageForUser(fresh)));
	}

	if (!event.locals.user) redirect(303, '/login');
	const stage = await stageForUser(event.locals.user);
	if (stage !== 'VERIFY_EMAIL') redirect(303, pathForStage(stage));

	return {
		state: 'pending' as const,
		email: maskEmail(event.locals.user.email),
		sent: event.url.searchParams.get('sent') === '1',
		emailConfigured: emailReady(),
		ttlHours: ttlHours('EMAIL_VERIFICATION')
	};
};

export const actions: Actions = {
	resend: async (event) => {
		if (!event.locals.user) redirect(303, '/login');
		if (event.locals.user.emailVerifiedAt) redirect(303, '/onboarding');

		try {
			// Two budgets: one per account, one per network, so neither a single address
			// nor a single host can be used to pump mail at people.
			await limitResend(event.locals.user.id);
			await limitResend(event.locals.ipHash ?? 'unknown');
		} catch (err) {
			if (toAppError(err).code === 'RATE_LIMITED') {
				return fail(429, { message: 'You have requested several emails already. Please wait a while before trying again.' });
			}
			log.error('resend_rate_limit_failed', { requestId: event.locals.requestId });
			return fail(500, { message: 'Could not resend right now.' });
		}

		await sendVerificationEmail(event.locals.user, event.locals.ipHash);
		return { resent: true };
	}
};
