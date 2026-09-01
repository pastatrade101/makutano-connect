import { redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { audit } from '$lib/server/audit';
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '$lib/server/auth/session';

/**
 * A GET here is not a sign-out, it is a mistake — a typed URL, a bookmark, a
 * link prefetch. The route only declared actions and had no page, so every one
 * of those was answered with a 500. Signing out has to stay a POST (a GET that
 * destroys a session can be triggered by any image tag on any page), so the
 * honest answer to a GET is to send them where they were going.
 */
export const load: ServerLoad = ({ locals }) => {
	redirect(303, locals.user ? '/app' : '/login');
};

export const actions: Actions = {
	default: async (event) => {
		const userId = event.locals.user?.id ?? null;
		await destroySession(event.cookies.get(SESSION_COOKIE));
		clearSessionCookie(event.cookies);
		if (userId) await audit(null, 'user.logout', { type: 'user', userId, requestId: event.locals.requestId });
		redirect(303, '/login');
	}
};
