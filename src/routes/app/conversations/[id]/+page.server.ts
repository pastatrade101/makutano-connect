import { error, fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { and, eq, sql } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import {
	getConversation,
	listMessages,
	markConversationRead,
	updateConversationAccess
} from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { aiConfigured } from '$lib/server/ai/client';
import { suggestOrderFromMessage } from '$lib/server/ai/extract-order';
import { enquiryNotes, suggestEnquiry } from '$lib/server/ai/extract-enquiry';
import { suggestReply, summarizeConversation } from '$lib/server/ai/assist';
import { recordAiOutcome } from '$lib/server/ai/usage';
import { aiActionsFor } from '$lib/server/ai/actions';
import { createBookingRequest } from '$lib/server/booking-requests';
import { normalizeWorkspace } from '$lib/workspace';
import { effectiveEntitlements } from '$lib/server/entitlements';
import { parseUuid } from '$lib/server/http';
import { log } from '$lib/server/logger';
import { createOrder } from '$lib/server/orders';
import { createBatchOrder } from '$lib/server/order-batches';
import { requestForConversationCustomer } from '$lib/server/payment-requests';
import { queueMessage } from '$lib/server/whatsapp/messages';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'conversation id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'conversations:read');
	const tenantId = requireTenant(locals).id;
	try {
		const id = idOf(params);
		const viewer = { userId: locals.user!.id, permissions: locals.permissions };
		const conversation = await getConversation(tenantId, id, viewer);
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
		const openBatch =
			(
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

		const paymentRequest = await requestForConversationCustomer(tenantId, conversation.customerId);

		// Assignment picker — only loaded for people who can actually assign.
		const canAssign = locals.permissions.includes('conversations:assign');
		const teamMembers = canAssign
			? await db()
					.select({ userId: schema.users.id, fullName: schema.users.fullName, email: schema.users.email })
					.from(schema.tenantMemberships)
					.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
					.where(
						and(eq(schema.tenantMemberships.tenantId, tenantId), sql`${schema.tenantMemberships.disabledAt} is null`)
					)
			: [];

		await markConversationRead(tenantId, id);
		// AI assist appears only when the deployment has a key, the plan includes it,
		// and this user may create orders — a button that cannot work is worse than none.
		const aiEntitled =
			aiConfigured() && (await effectiveEntitlements(tenantId)).resolved['ai.enabled']?.effective === true;
		const aiActions = aiEntitled
			? aiActionsFor(normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities), {
					orders: locals.permissions.includes('orders:write'),
					enquiries: locals.permissions.includes('booking_requests:write')
				})
			: [];
		const aiReady = aiActions.length > 0;

		return {
			conversation,
			messages: items,
			customer,
			context,
			outstanding: outstanding.toFixed(2),
			openBatch,
			paymentRequest,
			teamMembers,
			aiReady,
			aiActions
		};
	} catch {
		error(404, 'Conversation not found');
	}
};

export const actions: Actions = {
	/** Assign / change visibility — conversations:assign holders only (§8). */
	access: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'conversations:assign');
		const data = await request.formData();
		try {
			const patch: Parameters<typeof updateConversationAccess>[2] = {};
			if (data.has('assignedToUserId')) patch.assignedToUserId = String(data.get('assignedToUserId') ?? '') || null;
			if (data.has('visibility')) {
				const v = String(data.get('visibility'));
				if (!['TEAM', 'ASSIGNED', 'PRIVATE'].includes(v)) return fail(400, { message: 'Invalid visibility.' });
				patch.visibility = v as never;
			}
			await updateConversationAccess(requireTenant(locals).id, idOf(params), patch, { userId: locals.user!.id });
			return { success: true, notice: patch.visibility !== undefined ? 'Visibility updated' : 'Assignment updated' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Read one customer message and suggest an order. Returns a DRAFT only — nothing
	 * is written, nothing is sent. The staff member edits it and presses create.
	 */
	suggestOrder: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const messageId = parseUuid(String(data.get('messageId') ?? ''), 'message id');
		try {
			const suggestion = await suggestOrderFromMessage(tenantId, idOf(params), messageId, {
				userId: locals.user!.id,
				permissions: locals.permissions
			});
			return { suggestion };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Create the order a human just approved. The suggestion is NOT trusted: every
	 * value is re-read from the submitted form (which the staff member could edit) and
	 * priced through the same createOrder the manual form uses. The assistant never
	 * gets a private path into the ledger.
	 */
	createSuggested: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const conversation = await getConversation(tenantId, idOf(params), {
			userId: locals.user!.id,
			permissions: locals.permissions
		});
		if (!conversation.customerId) {
			return fail(400, {
				message: 'This conversation has no customer yet — create the order from the full form instead.'
			});
		}

		const titles = data.getAll('itemTitle').map((v) => String(v).trim());
		const quantities = data.getAll('itemQuantity').map((v) => Number(v));
		const units = data.getAll('itemUnit').map((v) => String(v).trim());
		const prices = data.getAll('itemPrice').map((v) => String(v).trim());
		const items = titles
			.map((title, i) => ({
				title,
				quantity: Number.isFinite(quantities[i]) && quantities[i] > 0 ? Math.round(quantities[i]) : 1,
				unit: units[i] || null,
				unitPrice: /^\d+(\.\d{1,2})?$/.test(prices[i] ?? '') ? prices[i] : '0'
			}))
			.filter((i) => i.title);
		if (!items.length) return fail(400, { message: 'Add at least one item before creating the order.' });

		const method = String(data.get('deliveryMethod') ?? '');
		try {
			const order = await createOrder(
				tenantId,
				{
					customerId: conversation.customerId,
					conversationId: conversation.id,
					status: 'PENDING_CONFIRMATION',
					source: 'WHATSAPP_DIRECT',
					currency: String(data.get('currency') ?? '') || undefined,
					deliveryMethod: method === 'DELIVERY' || method === 'PICKUP' ? method : undefined,
					deliveryLocation: String(data.get('deliveryLocation') ?? '').trim() || null,
					batchId: String(data.get('batchId') ?? '') || null,
					notes: String(data.get('notes') ?? '').trim() || null,
					items
				},
				{ userId: locals.user!.id }
			);
			return { added: { orderNumber: order.orderNumber, total: order.total, currency: order.currency } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Read the customer's trip requirements out of one message or the recent thread.
	 * Returns a DRAFT — no enquiry exists until a human presses Create enquiry (§38).
	 */
	suggestEnquiry: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'booking_requests:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const rawMessageId = String(data.get('messageId') ?? '');
		try {
			const enquiry = await suggestEnquiry(
				tenantId,
				idOf(params),
				{ userId: locals.user!.id, permissions: locals.permissions },
				{
					messageId: rawMessageId ? parseUuid(rawMessageId, 'message id') : null,
					scope: String(data.get('scope') ?? '') === 'conversation' ? 'conversation' : 'message'
				}
			);
			return { enquiry: { ...enquiry, notes: enquiryNotes(enquiry.extraction, enquiry.externalTour) } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Create the enquiry a consultant approved. The suggestion is not trusted: every
	 * value is re-read from the submitted form and written through the SAME
	 * createBookingRequest the website API uses, so limits, leads, acknowledgements
	 * and audit all behave identically (§39).
	 */
	createEnquiry: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'booking_requests:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const conversation = await getConversation(tenant.id, idOf(params), {
			userId: locals.user!.id,
			permissions: locals.permissions
		});

		const int = (name: string, max: number) => {
			const n = Number(String(data.get(name) ?? '').trim());
			return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null;
		};
		const text = (name: string, max: number) =>
			String(data.get(name) ?? '')
				.trim()
				.slice(0, max) || null;
		const startDate = text('startDate', 10);

		// Customer identity is Connect's, never the model's (§5). With no customer on
		// the thread we still have the WhatsApp number the conversation belongs to.
		const [existing] = conversation.customerId
			? await db()
					.select({
						firstName: schema.customers.firstName,
						lastName: schema.customers.lastName,
						whatsappPhone: schema.customers.whatsappPhone,
						email: schema.customers.email,
						country: schema.customers.country
					})
					.from(schema.customers)
					.where(and(eq(schema.customers.id, conversation.customerId), eq(schema.customers.tenantId, tenant.id)))
					.limit(1)
			: [];

		try {
			const { request: created } = await createBookingRequest(tenant.id, {
				customer: {
					firstName: existing?.firstName ?? 'WhatsApp',
					lastName: existing?.lastName ?? 'Customer',
					whatsappPhone: existing?.whatsappPhone ?? conversation.externalId,
					email: existing?.email ?? null,
					country: existing?.country ?? null
				},
				source: 'WHATSAPP',
				startDate,
				adults: int('adults', 400) ?? 1,
				children: int('children', 400) ?? 0,
				// estimatedTotal is deliberately NOT set from the customer's budget: a
				// budget is what they hope to spend, not what the trip costs (§7).
				notes: text('notes', 4000),
				externalReference: text('externalReference', 200),
				externalSource: text('externalSource', 100),
				metadata: {
					ai: { extracted: true, usageId: text('usageId', 60) },
					budget: {
						amount: int('budgetAmount', 10_000_000),
						currency: text('budgetCurrency', 3),
						basis: text('budgetBasis', 20)
					},
					destinations: text('destinations', 500),
					accommodation: text('accommodation', 40),
					whenText: text('whenText', 200)
				}
			});

			// Attribution for the "did this save work?" metric (§30) — the consultant
			// edited the draft or took it as-is.
			const usageId = text('usageId', 60);
			if (usageId)
				await recordAiOutcome(tenant.id, usageId, String(data.get('edited') ?? '') === '1' ? 'EDITED' : 'ACCEPTED');

			return { enquiryCreated: { reference: created.reference } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Draft a reply. Text in a box — sending still goes through ?/send and the
	 *  existing WhatsApp compliance layer (§37). */
	suggestReply: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'conversations:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		try {
			const draft = await suggestReply(
				tenantId,
				idOf(params),
				{ userId: locals.user!.id, permissions: locals.permissions },
				String(data.get('instruction') ?? '') || null
			);
			return { replyDraft: draft };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Catch-up summary for whoever picks the thread up next (§18, §19). */
	summarize: async ({ locals, params }) => {
		requirePermission(locals.permissions, 'conversations:read');
		const tenantId = requireTenant(locals).id;
		try {
			const summary = await summarizeConversation(tenantId, idOf(params), {
				userId: locals.user!.id,
				permissions: locals.permissions
			});
			return { summary };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** The consultant threw a suggestion away — worth knowing, never worth blocking. */
	discardSuggestion: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'conversations:read');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const usageId = String(data.get('usageId') ?? '');
		if (usageId) await recordAiOutcome(tenantId, usageId, 'DISCARDED');
		return { discarded: true };
	},

	/** One-tap order from the chat: quantity only; batch + customer supply the rest. */
	addToBatch: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const quantity = Number(data.get('quantity'));
		const batchId = parseUuid(String(data.get('batchId') ?? ''), 'batch id');
		if (!Number.isFinite(quantity) || quantity < 1) return fail(400, { message: 'Enter a quantity of at least 1.' });

		const conversation = await getConversation(tenantId, idOf(params), {
			userId: locals.user!.id,
			permissions: locals.permissions
		});
		if (!conversation.customerId) {
			return fail(400, {
				message: 'This conversation has no customer yet — create the order from the full form instead.'
			});
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
			log.error('add_to_batch_failed', {
				message: (err as Error)?.message,
				stack: (err as Error)?.stack?.split('\n')[1]
			});
			return fail(400, { message: toAppError(err).message });
		}
	},

	send: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'whatsapp:send');
		const data = await request.formData();
		const text = String(data.get('text') ?? '').trim();
		if (!text) return fail(400, { message: 'Write a message first.' });

		const conversation = await getConversation(requireTenant(locals).id, idOf(params), {
			userId: locals.user!.id,
			permissions: locals.permissions
		});
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
