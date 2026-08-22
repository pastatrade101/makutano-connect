import { error, fail, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { getConversation, listMessages, markConversationRead } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { queueMessage } from '$lib/server/whatsapp/messages';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'conversation id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requirePermission(locals.permissions, 'conversations:read');
	const tenantId = locals.tenant!.id;
	try {
		const id = idOf(params);
		const conversation = await getConversation(tenantId, id);
		const { items } = await listMessages(tenantId, id, { page: 1, limit: 100, order: 'desc' });
		const customer = conversation.customerId
			? (await db().select().from(schema.customers).where(eq(schema.customers.id, conversation.customerId)).limit(1))[0]
			: null;
		await markConversationRead(tenantId, id);
		return { conversation, messages: items, customer };
	} catch {
		error(404, 'Conversation not found');
	}
};

export const actions: Actions = {
	send: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'whatsapp:send');
		const data = await request.formData();
		const text = String(data.get('text') ?? '').trim();
		if (!text) return fail(400, { message: 'Write a message first.' });

		const conversation = await getConversation(locals.tenant!.id, idOf(params));
		if (!conversation.externalId) return fail(400, { message: 'This conversation has no WhatsApp number.' });

		try {
			await queueMessage({
				tenantId: locals.tenant!.id,
				to: conversation.externalId,
				content: { type: 'text', text },
				conversationId: conversation.id,
				customerId: conversation.customerId,
				sentByUserId: locals.user!.id
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
