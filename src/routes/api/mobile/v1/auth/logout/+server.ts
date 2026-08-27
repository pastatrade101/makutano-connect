import { json, type RequestHandler } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth/session';

/** Signing out on the phone ends the session everywhere it is used. */
export const POST: RequestHandler = async ({ request }) => {
	const bearer = request.headers.get('authorization') ?? '';
	if (bearer.toLowerCase().startsWith('bearer ')) await destroySession(bearer.slice(7).trim());
	return json({ success: true, data: { signedOut: true } });
};
