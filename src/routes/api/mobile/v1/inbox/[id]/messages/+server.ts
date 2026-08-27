// Reply from the phone. Goes through queueMessage, so entitlements, the 24-hour
// window and template rules apply exactly as they do from the browser.
import type { RequestHandler } from '@sveltejs/kit';
import { getConversation } from '$lib/server/conversations';
import { queueMessage } from '$lib/server/whatsapp/messages';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import { parseUuid } from '$lib/server/http';

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'whatsapp:send');
		const id = parseUuid(event.params.id ?? '', 'conversation id');
		const conversation = await getConversation(viewer.tenantId, id, {
			userId: viewer.userId,
			permissions: viewer.permissions
		});
		const body = (await event.request.json().catch(() => ({}))) as { text?: string };
		const text = String(body.text ?? '').trim();
		if (!text) return problem(new Error('Write something to send.'), event.locals.requestId);

		const message = await queueMessage({
			tenantId: viewer.tenantId,
			to: conversation.externalId ?? '',
			conversationId: conversation.id,
			customerId: conversation.customerId,
			sentByUserId: viewer.userId,
			content: { type: 'text', text }
		});
		return ok({ id: message.id, status: message.status, createdAt: message.createdAt });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
