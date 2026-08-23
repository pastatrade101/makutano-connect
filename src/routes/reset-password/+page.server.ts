// Password reset, step 2. The token is spent atomically by consumeToken(), so a link
// forwarded or replayed after use does nothing.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { hashPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { consumeToken } from '$lib/server/auth/verification';
import { db, schema } from '$lib/server/db';
import { log } from '$lib/server/logger';
import { checkPassword, markEmailVerified, pathForStage, stageForUser } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// The token is only checked for presence here; it is spent on submit so that merely
	// opening the email (or a mail scanner prefetching it) does not burn the link.
	return { hasToken: !!url.searchParams.get('token') };
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const token = String(data.get('token') ?? '');
		const password = String(data.get('password') ?? '');
		const confirm = String(data.get('confirmPassword') ?? '');

		if (password !== confirm) return fail(400, { message: 'Those passwords do not match.' });
		const strength = checkPassword(password);
		if (!strength.ok) return fail(400, { message: strength.message });

		const user = await consumeToken(token, 'PASSWORD_RESET');
		if (!user) return fail(400, { message: 'This reset link has expired or has already been used.' });

		await db()
			.update(schema.users)
			.set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
			.where(eq(schema.users.id, user.id));

		// Every other session is invalidated: if the reset was triggered because someone
		// else had access, this is the moment that access ends.
		await db().delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
		log.info('password_reset_completed', { userId: user.id });

		// Receiving mail at the address proves as much as the verification link does.
		const verified = await markEmailVerified(user, event.locals.ipHash);

		const session = await createSession(user.id, {
			userAgent: event.request.headers.get('user-agent'),
			ipHash: event.locals.ipHash
		});
		setSessionCookie(event.cookies, session.token, session.expiresAt);

		redirect(303, pathForStage(await stageForUser(verified)));
	}
};
