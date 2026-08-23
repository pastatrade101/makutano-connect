import { error, fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { and, eq, sql } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { getConversation, listMessages, markConversationRead } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { log } from '$lib/server/logger';
import { createBatchOrder } from '$lib/server/order-batches';
import { queueMessage } from '$lib/server/whatsapp/messages';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'conversation id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'conversations:read');
	const tenantId = requireTenant(locals).id;
	try {
		const id = idOf(params);
		const conversation = await getConversation(tenantId, id);
		const { items } = await listMessages(tenantId, id, { page: 1, limit: 100, order: 'desc' });
		const customer = conversation.customerId
			? (await db().select().from(schema.customers).where(eq(schema.customers.id, conversation.customerId)).limit(1))[0]
			: null;

		// §7-§8: everything this thread (and this customer) already has going on, so the
		// operator never leaves the chat to answer "what did they order, have they paid?"
		const context = (await db().execute(sql`
			select * from (
				select 'order' as kind, o.id::text, o.order_number as reference, o.status::text, o.total::text,
					o.amount_paid::text, o.currency, o.created_at,
					(o.conversation_id = ${id}::uuid) as this_thread
				from orders o
				where o.tenant_id = ${tenantId}::uuid
					and (o.conversation_id = ${id}::uuid or (o.customer_id is not null and o.customer_id = ${conversation.customerId ?? null}::uuid))
				union all
				select 'booking', b.id::text, b.booking_reference, b.status::text, b.total::text, b.amount_paid::text, b.currency, b.created_at,
					false
				from bookings b
				where b.tenant_id = ${tenantId}::uuid and b.customer_id is not null and b.customer_id = ${conversation.customerId ?? null}::uuid
				union all
				select 'quotation', q.id::text, q.reference, q.status::text, q.total::text, '0', q.currency, q.created_at,
					(q.conversation_id = ${id}::uuid)
				from quotations q
				where q.tenant_id = ${tenantId}::uuid
					and (q.conversation_id = ${id}::uuid or (q.customer_id is not null and q.customer_id = ${conversation.customerId ?? null}::uuid))
			) t
			order by this_thread desc, created_at desc
			limit 6
		`)) as unknown as Array<{
			kind: 'order' | 'booking' | 'quotation';
			id: string;
			reference: string;
			status: string;
			total: string;
			amount_paid: string;
			currency: string;
			this_thread: boolean;
		}>;

		const outstanding = context
			.filter((t) => t.kind !== 'quotation' && !['CANCELLED', 'REFUNDED', 'DECLINED', 'EXPIRED'].includes(t.status))
			.reduce((sum, t) => sum + Math.max(0, Number(t.total) - Number(t.amount_paid)), 0);

		// The seller's most common move: a customer writes "nataka kilo 4" and the
		// operator records it against today's batch without leaving the chat.
		const openBatch = (
			await db()
				.select({
					id: schema.orderBatches.id,
					name: schema.orderBatches.name,
					unit: schema.orderBatches.defaultUnit,
					unitPrice: schema.orderBatches.defaultUnitPrice,
					currency: schema.orderBatches.currency
				})
				.from(schema.orderBatches)
				.where(and(eq(schema.orderBatches.tenantId, tenantId), eq(schema.orderBatches.status, 'OPEN')))
				.orderBy(sql`fulfilment_date asc nulls last, created_at desc`)
				.limit(1)
		)[0] ?? null;

		await markConversationRead(tenantId, id);
		return { conversation, messages: items, customer, context, outstanding: outstanding.toFixed(2), openBatch };
	} catch {
		error(404, 'Conversation not found');
	}
};

export const actions: Actions = {
	/** One-tap order from the chat: quantity only; batch + customer supply the rest. */
	addToBatch: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const quantity = Number(data.get('quantity'));
		const batchId = parseUuid(String(data.get('batchId') ?? ''), 'batch id');
		if (!Number.isFinite(quantity) || quantity < 1) return fail(400, { message: 'Enter a quantity of at least 1.' });

		const conversation = await getConversation(tenantId, idOf(params));
		if (!conversation.customerId) {
			return fail(400, { message: 'This conversation has no customer yet — create the order from the full form instead.' });
		}
		try {
			const order = await createBatchOrder(
				tenantId,
				batchId,
				{
					customerId: conversation.customerId,
					quantity,
					source: 'WHATSAPP_DIRECT',
					conversationId: conversation.id
				},
				{ userId: locals.user!.id }
			);
			return { added: { orderNumber: order.orderNumber, total: order.total, currency: order.currency } };
		} catch (err) {
			log.error('add_to_batch_failed', { message: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n')[1] });
			return fail(400, { message: toAppError(err).message });
		}
	},

	send: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'whatsapp:send');
		const data = await request.formData();
		const text = String(data.get('text') ?? '').trim();
		if (!text) return fail(400, { message: 'Write a message first.' });

		const conversation = await getConversation(requireTenant(locals).id, idOf(params));
		if (!conversation.externalId) return fail(400, { message: 'This conversation has no WhatsApp number.' });

		try {
			await queueMessage({
				tenantId: requireTenant(locals).id,
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
