// Presence heartbeat: the open conversation page POSTs every few seconds and gets
// back who else is looking at (or typing in) the same thread. Session-authenticated
// via hooks like every /app route; the conversation itself is visibility-scoped, so
// presence can never confirm the existence of a thread the caller cannot see.
import { json } from '@sveltejs/kit';
import { getConversation } from '$lib/server/conversations';
import { requireTenant } from '$lib/server/guards';
import { parseUuid } from '$lib/server/http';
import { getPresence, markPresence } from '$lib/server/presence';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const tenantId = requireTenant(locals).id;
	const id = parseUuid(params.id ?? '', 'conversation id');
	// Same scoping as the page: outside the viewer's visibility → 404, no presence.
	await getConversation(tenantId, id, { userId: locals.user!.id, permissions: locals.permissions });

	const body = (await request.json().catch(() => ({}))) as { typing?: boolean };
	markPresence(
		tenantId,
		id,
		{ userId: locals.user!.id, name: locals.user!.fullName || locals.user!.email.split('@')[0] },
		!!body.typing
	);
	return json({ others: getPresence(tenantId, id, locals.user!.id) });
};
