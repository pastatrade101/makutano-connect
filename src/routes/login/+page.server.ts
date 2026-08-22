import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { enforce } from '$lib/server/rate-limit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/app');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(data.get('password') ?? '');
		if (!email || !password) return fail(400, { email, message: 'Enter your email and password.' });

		// Brute-force protection, keyed on the client rather than globally. Only an actual
		// RATE_LIMITED verdict becomes a 429 — swallowing every error here would report
		// "too many attempts" for what is really a database problem.
		try {
			await enforce(`login:${event.locals.ipHash ?? 'unknown'}`, 10, 300);
		} catch (err) {
			if (toAppError(err).code === 'RATE_LIMITED') {
				return fail(429, { email, message: 'Too many attempts. Please wait a few minutes.' });
			}
			log.error('login_rate_limit_failed', { requestId: event.locals.requestId, message: (err as Error)?.message });
			return fail(500, { email, message: 'Sign-in is temporarily unavailable.' });
		}

		const rows = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
		const user = rows[0];
		// One generic message for "no such user" and "wrong password" — a login form
		// should not tell an attacker which emails exist.
		const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
		if (!valid) return fail(401, { email, message: 'Those credentials did not work.' });

		const { token, expiresAt } = await createSession(user.id, {
			userAgent: event.request.headers.get('user-agent'),
			ipHash: event.locals.ipHash
		});
		setSessionCookie(event.cookies, token, expiresAt);
		await db().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
		await audit(null, 'user.login', {
			type: 'user',
			userId: user.id,
			ipHash: event.locals.ipHash,
			requestId: event.locals.requestId
		});

		redirect(303, user.isSuperAdmin ? '/admin' : '/app');
	}
};
