import { redirect, type Actions } from '@sveltejs/kit';
import { audit } from '$lib/server/audit';
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '$lib/server/auth/session';

export const actions: Actions = {
	default: async (event) => {
		const userId = event.locals.user?.id ?? null;
		await destroySession(event.cookies.get(SESSION_COOKIE));
		clearSessionCookie(event.cookies);
		if (userId) await audit(null, 'user.logout', { type: 'user', userId, requestId: event.locals.requestId });
		redirect(303, '/login');
	}
};
