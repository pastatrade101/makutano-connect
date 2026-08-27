// One thread: who it is, what was said, and what the app should offer to do next.
import type { RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getConversation, listMessages, markConversationRead } from '$lib/server/conversations';
import { messagePreview } from '$lib/labels';
import { ok, problem, requireViewer } from '$lib/server/mobile';
import { parseUuid } from '$lib/server/http';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const id = parseUuid(event.params.id ?? '', 'conversation id');
		// getConversation applies the visibility rules and 404s rather than 403s.
		const conversation = await getConversation(viewer.tenantId, id, {
			userId: viewer.userId,
			permissions: viewer.permissions
		});
		const { items } = await listMessages(viewer.tenantId, id, { page: 1, limit: 50, order: 'desc' });
		const customer = conversation.customerId
			? (await db().select().from(schema.customers).where(eq(schema.customers.id, conversation.customerId)).limit(1))[0]
			: null;
		await markConversationRead(viewer.tenantId, id);

		return ok({
			conversation: {
				id: conversation.id,
				name:
					[customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conversation.externalId ?? ''}`,
				phone: customer?.whatsappPhone ?? conversation.externalId,
				customerId: conversation.customerId,
				assignedToUserId: conversation.assignedToUserId,
				assignedToMe: conversation.assignedToUserId === viewer.userId,
				visibility: conversation.visibility,
				isOpen: conversation.isOpen,
				bookingRequestId: conversation.bookingRequestId
			},
			messages: items.map((m) => ({
				id: m.id,
				direction: m.direction,
				text: messagePreview(m.body, m.type),
				status: m.status,
				createdAt: m.createdAt
			}))
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
