// Password reset, step 1. The response is identical whether or not the address exists —
// a reset form must not double as a way to enumerate customers.
import { fail, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { sendPasswordResetEmail } from '$lib/server/auth/verification';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { limitPasswordReset } from '$lib/server/signup';

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '').trim().toLowerCase();
		if (!email) return fail(400, { message: 'Enter your email address.' });

		try {
			await limitPasswordReset(event.locals.ipHash);
		} catch (err) {
			if (toAppError(err).code === 'RATE_LIMITED') {
				return fail(429, { message: 'Too many requests. Please wait a few minutes.' });
			}
			log.error('reset_rate_limit_failed', { requestId: event.locals.requestId });
			return fail(500, { message: 'Password reset is temporarily unavailable.' });
		}

		const user = (await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
		if (user?.isActive) await sendPasswordResetEmail(user, event.locals.ipHash);

		return { sent: true };
	}
};
