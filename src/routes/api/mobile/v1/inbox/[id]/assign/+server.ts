// Take a thread, or hand it to someone else — the quick action that matters most
// when a notification arrives and somebody needs to own the reply.
import type { RequestHandler } from '@sveltejs/kit';
import { updateConversationAccess } from '$lib/server/conversations';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import { parseUuid } from '$lib/server/http';

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'conversations:assign');
		const id = parseUuid(event.params.id ?? '', 'conversation id');
		const body = (await event.request.json().catch(() => ({}))) as { assignedToUserId?: string | null };
		const updated = await updateConversationAccess(
			viewer.tenantId,
			id,
			{ assignedToUserId: body.assignedToUserId === undefined ? viewer.userId : body.assignedToUserId },
			{ userId: viewer.userId }
		);
		return ok({ assignedToUserId: updated.assignedToUserId });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
