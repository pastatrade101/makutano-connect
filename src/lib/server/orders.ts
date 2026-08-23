// Orders — the commerce twin of bookings.
//
// Same architecture rules as every other domain: tenant-scoped queries only, money
// computed server-side from items, every status change written to an auditable
// history, and payment status kept INDEPENDENT of fulfilment status — a confirmed
// order may be entirely unpaid.
//
// Reuses: customers, conversations, leads, payments, events, notifications, the
// reference counter. Creates nothing that duplicates them.
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { emit } from './events';
import { AppError } from './errors';
import { notify } from './notifications';
import { getTenantById } from './tenants';
import { sendEventTemplate, type NotifyEvent } from './whatsapp/template-engine';
import type { Pagination } from './http';

const dec = (v: string | number | null | undefined): number => Number(v ?? 0);
const fixed = (n: number): string => n.toFixed(2);

export type OrderActor = { userId?: string | null; apiKeyId?: string | null };

export type OrderItemInput = {
	catalogItemId?: string | null;
	title: string;
	variant?: string | null;
	sku?: string | null;
	quantity?: number;
	unitPrice?: string | null;
	discount?: string | null;
	externalReference?: string | null;
	externalSource?: string | null;
	metadata?: Record<string, unknown>;
};

export type CreateOrderInput = {
	customerId?: string | null;
	conversationId?: string | null;
	leadId?: string | null;
	status?: 'DRAFT' | 'PENDING_CONFIRMATION';
	source?: schema.Order['source'];
	currency?: string;
	discount?: string;
	deliveryFee?: string;
	deliveryMethod?: schema.Order['deliveryMethod'];
	deliveryLocation?: string | null;
	notes?: string | null;
	externalReference?: string | null;
	externalSource?: string | null;
	metadata?: Record<string, unknown>;
	items: OrderItemInput[];
};

/** Totals derive from items — a caller cannot post a $0 total for a real cart. */
export function computeOrderTotals(
	items: Array<{ quantity?: number; unitPrice?: string | null; discount?: string | null }>,
	orderDiscount = '0',
	deliveryFee = '0'
) {
	const subtotal = items.reduce((sum, item) => {
		const line = dec(item.unitPrice) * (item.quantity ?? 1) - dec(item.discount);
		return sum + Math.max(0, line);
	}, 0);
	const total = Math.max(0, subtotal - dec(orderDiscount) + dec(deliveryFee));
	return { subtotal: fixed(subtotal), total: fixed(total) };
}

async function insertItems(tenantId: string, orderId: string, items: OrderItemInput[]) {
	await db().insert(schema.orderItems).values(
		items.map((item) => ({
			tenantId,
			orderId,
			catalogItemId: item.catalogItemId ?? null,
			title: item.title,
			variant: item.variant ?? null,
			sku: item.sku ?? null,
			quantity: item.quantity ?? 1,
			unitPrice: item.unitPrice ?? '0',
			discount: item.discount ?? '0',
			total: fixed(Math.max(0, dec(item.unitPrice) * (item.quantity ?? 1) - dec(item.discount))),
			externalReference: item.externalReference ?? null,
			externalSource: item.externalSource ?? null,
			metadata: item.metadata ?? {}
		}))
	);
}

export async function createOrder(tenantId: string, input: CreateOrderInput, actor: OrderActor = {}): Promise<schema.Order> {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');
	if (!input.items?.length) throw new AppError('VALIDATION_ERROR', 'An order needs at least one item.');

	// A conversation id is a link, not authorization — verify it belongs to this tenant.
	if (input.conversationId) {
		const rows = await db()
			.select({ id: schema.conversations.id, customerId: schema.conversations.customerId })
			.from(schema.conversations)
			.where(and(eq(schema.conversations.id, input.conversationId), eq(schema.conversations.tenantId, tenantId)))
			.limit(1);
		if (!rows[0]) throw new AppError('CONVERSATION_NOT_FOUND', 'Conversation could not be found.');
		if (!input.customerId && rows[0].customerId) input.customerId = rows[0].customerId;
	}
	if (input.customerId) {
		const rows = await db()
			.select({ id: schema.customers.id })
			.from(schema.customers)
			.where(and(eq(schema.customers.id, input.customerId), eq(schema.customers.tenantId, tenantId)))
			.limit(1);
		if (!rows[0]) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer could not be found.');
	}

	const { subtotal, total } = computeOrderTotals(input.items, input.discount, input.deliveryFee);
	const orderNumber = await nextReference(db(), tenantId, 'OR', tenant.bookingReferencePrefix);
	const status = input.status ?? 'DRAFT';

	const [order] = await db()
		.insert(schema.orders)
		.values({
			tenantId,
			orderNumber,
			customerId: input.customerId ?? null,
			conversationId: input.conversationId ?? null,
			leadId: input.leadId ?? null,
			status,
			paymentStatus: 'UNPAID',
			source: input.source ?? 'MANUAL',
			currency: input.currency ?? tenant.currency,
			subtotal,
			discount: input.discount ?? '0',
			deliveryFee: input.deliveryFee ?? '0',
			total,
			deliveryMethod: input.deliveryMethod ?? null,
			deliveryLocation: input.deliveryLocation ?? null,
			notes: input.notes ?? null,
			externalReference: input.externalReference ?? null,
			externalSource: input.externalSource ?? null,
			metadata: input.metadata ?? {},
			createdByUserId: actor.userId ?? null
		})
		.returning();

	await insertItems(tenantId, order.id, input.items);
	await db().insert(schema.orderStatusHistory).values({
		tenantId,
		orderId: order.id,
		fromStatus: null,
		toStatus: status,
		reason: 'Order created',
		changedByUserId: actor.userId ?? null,
		changedByApiKeyId: actor.apiKeyId ?? null
	});

	await emit(tenantId, 'order.created', {
		id: order.id,
		orderNumber: order.orderNumber,
		status: order.status,
		total: order.total,
		currency: order.currency,
		customerId: order.customerId,
		conversationId: order.conversationId,
		externalReference: order.externalReference
	});
	if (status === 'PENDING_CONFIRMATION') {
		void orderTemplateContext(tenantId, order)
			.then(({ to, ctx }) => sendEventTemplate(tenantId, 'ORDER_RECEIVED', to, ctx, `order-ORDER_RECEIVED:${order.id}`))
			.catch(() => undefined);
	}
	await notify({
		tenantId,
		channel: 'IN_APP',
		event: 'order.created',
		title: `New order ${order.orderNumber}`,
		body: `${input.items.length} item(s) · ${order.currency} ${order.total}`,
		entityType: 'order',
		entityId: order.id
	});

	return order;
}

export async function getOrder(tenantId: string, id: string): Promise<schema.Order> {
	const rows = await db()
		.select()
		.from(schema.orders)
		.where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Order could not be found.');
	return rows[0];
}

export async function getOrderDetail(tenantId: string, id: string) {
	const order = await getOrder(tenantId, id);
	const [items, history, paymentRows, customer, conversation] = await Promise.all([
		db().select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id)).orderBy(schema.orderItems.createdAt),
		db()
			.select()
			.from(schema.orderStatusHistory)
			.where(eq(schema.orderStatusHistory.orderId, id))
			.orderBy(desc(schema.orderStatusHistory.createdAt)),
		db().select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(desc(schema.payments.createdAt)),
		order.customerId
			? db().select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1)
			: Promise.resolve([]),
		order.conversationId
			? db().select().from(schema.conversations).where(eq(schema.conversations.id, order.conversationId)).limit(1)
			: Promise.resolve([])
	]);
	return { order, items, history, payments: paymentRows, customer: customer[0] ?? null, conversation: conversation[0] ?? null };
}

export type OrderFilters = {
	status?: schema.Order['status'] | schema.Order['status'][];
	paymentStatus?: schema.Order['paymentStatus'];
	source?: schema.Order['source'];
	customerId?: string;
	conversationId?: string;
};

export async function listOrders(tenantId: string, p: Pagination, filters: OrderFilters = {}) {
	const conditions: SQL[] = [eq(schema.orders.tenantId, tenantId)];
	if (filters.status) {
		conditions.push(
			Array.isArray(filters.status) ? inArray(schema.orders.status, filters.status) : eq(schema.orders.status, filters.status)
		);
	}
	if (filters.paymentStatus) conditions.push(eq(schema.orders.paymentStatus, filters.paymentStatus));
	if (filters.source) conditions.push(eq(schema.orders.source, filters.source));
	if (filters.customerId) conditions.push(eq(schema.orders.customerId, filters.customerId));
	if (filters.conversationId) conditions.push(eq(schema.orders.conversationId, filters.conversationId));
	if (p.q) {
		const term = `%${p.q}%`;
		conditions.push(
			sql`(${schema.orders.orderNumber} ilike ${term}
				or ${schema.orders.externalReference} ilike ${term}
				or exists (select 1 from customers c where c.id = ${schema.orders.customerId}
					and (c.first_name ilike ${term} or c.last_name ilike ${term} or c.whatsapp_phone ilike ${term}))
				or exists (select 1 from order_items i where i.order_id = ${schema.orders.id} and i.title ilike ${term}))`
		);
	}
	const where = and(...conditions);
	const [rows, [{ value: total }]] = await Promise.all([
		db()
			.select({
				order: schema.orders,
				customer: schema.customers,
				itemsSummary: sql<string>`(
					select string_agg(concat(i.quantity, '× ', i.title), ', ' order by i.created_at)
					from order_items i where i.order_id = ${schema.orders.id}
				)`
			})
			.from(schema.orders)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
			.where(where)
			.orderBy(desc(schema.orders.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.orders).where(where)
	]);
	return { items: rows, total: Number(total) };
}

/**
 * Replace a draft's contents. Only DRAFT and PENDING_CONFIRMATION orders are
 * editable — once confirmed, the record is commercial history and changes go through
 * status transitions or new orders.
 */
export async function updateDraftOrder(
	tenantId: string,
	id: string,
	input: Partial<CreateOrderInput>,
	actor: OrderActor = {}
): Promise<schema.Order> {
	const order = await getOrder(tenantId, id);
	if (order.status !== 'DRAFT' && order.status !== 'PENDING_CONFIRMATION') {
		throw new AppError('CONFLICT', `A ${order.status} order can no longer be edited.`);
	}
	void actor;

	const items = input.items;
	const { subtotal, total } = items?.length
		? computeOrderTotals(items, input.discount ?? order.discount, input.deliveryFee ?? order.deliveryFee)
		: computeOrderTotals(
				await db().select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id)),
				input.discount ?? order.discount,
				input.deliveryFee ?? order.deliveryFee
			);

	const [updated] = await db()
		.update(schema.orders)
		.set({
			...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
			...(input.source !== undefined ? { source: input.source } : {}),
			...(input.discount !== undefined ? { discount: input.discount } : {}),
			...(input.deliveryFee !== undefined ? { deliveryFee: input.deliveryFee } : {}),
			...(input.deliveryMethod !== undefined ? { deliveryMethod: input.deliveryMethod } : {}),
			...(input.deliveryLocation !== undefined ? { deliveryLocation: input.deliveryLocation } : {}),
			...(input.notes !== undefined ? { notes: input.notes } : {}),
			...(input.externalReference !== undefined ? { externalReference: input.externalReference } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
			subtotal,
			total,
			updatedAt: new Date()
		})
		.where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, tenantId)))
		.returning();

	if (items?.length) {
		await db().delete(schema.orderItems).where(and(eq(schema.orderItems.orderId, id), eq(schema.orderItems.tenantId, tenantId)));
		await insertItems(tenantId, id, items);
	}
	return updated;
}

/** Legal fulfilment transitions — enforced server-side, auditable, deliberately simple. */
const TRANSITIONS: Record<schema.Order['status'], schema.Order['status'][]> = {
	DRAFT: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
	PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
	CONFIRMED: ['PROCESSING', 'READY', 'DISPATCHED', 'CANCELLED'],
	PROCESSING: ['READY', 'DISPATCHED', 'CANCELLED'],
	READY: ['DISPATCHED', 'DELIVERED', 'CANCELLED'],
	DISPATCHED: ['DELIVERED', 'CANCELLED'],
	DELIVERED: ['REFUNDED'],
	CANCELLED: ['REFUNDED'],
	REFUNDED: []
};

/** Customer-facing WhatsApp template events per fulfilment status (Template Center). */
const STATUS_NOTIFY: Partial<Record<schema.Order['status'], NotifyEvent>> = {
	CONFIRMED: 'ORDER_CONFIRMED',
	READY: 'ORDER_READY',
	DISPATCHED: 'ORDER_DISPATCHED',
	DELIVERED: 'ORDER_DELIVERED'
};

async function orderTemplateContext(tenantId: string, order: schema.Order) {
	const [customer] = order.customerId
		? await db().select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1)
		: [];
	const tenant = await getTenantById(tenantId);
	const items = await db().select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
	return {
		to: customer?.whatsappPhone ?? null,
		ctx: {
			customer: { firstName: customer?.firstName, lastName: customer?.lastName },
			business: { name: tenant?.name },
			order: {
				number: order.orderNumber,
				total: order.total,
				currency: order.currency,
				itemsSummary: items.map((i) => `${i.quantity}× ${i.title}`).join(', '),
				deliveryLocation: order.deliveryLocation
			}
		}
	};
}

const STATUS_EVENT: Partial<Record<schema.Order['status'], Parameters<typeof emit>[1]>> = {
	CONFIRMED: 'order.confirmed',
	PROCESSING: 'order.processing',
	READY: 'order.ready',
	DISPATCHED: 'order.dispatched',
	DELIVERED: 'order.delivered',
	CANCELLED: 'order.cancelled',
	REFUNDED: 'order.refunded'
};

export async function changeOrderStatus(
	tenantId: string,
	id: string,
	toStatus: schema.Order['status'],
	actor: OrderActor = {},
	reason?: string
): Promise<schema.Order> {
	const order = await getOrder(tenantId, id);
	if (order.status === toStatus) return order;
	if (!TRANSITIONS[order.status].includes(toStatus)) {
		throw new AppError('VALIDATION_ERROR', `An order cannot move from ${order.status} to ${toStatus}.`);
	}

	const now = new Date();
	const [updated] = await db()
		.update(schema.orders)
		.set({
			status: toStatus,
			...(toStatus === 'CONFIRMED' ? { confirmedAt: now } : {}),
			...(toStatus === 'DISPATCHED' ? { dispatchedAt: now } : {}),
			...(toStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
			...(toStatus === 'CANCELLED' ? { cancelledAt: now } : {}),
			updatedAt: now
		})
		.where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, tenantId)))
		.returning();

	await db().insert(schema.orderStatusHistory).values({
		tenantId,
		orderId: id,
		fromStatus: order.status,
		toStatus,
		reason: reason ?? null,
		changedByUserId: actor.userId ?? null,
		changedByApiKeyId: actor.apiKeyId ?? null
	});

	const event = STATUS_EVENT[toStatus];
	if (event) {
		await emit(tenantId, event, {
			id: updated.id,
			orderNumber: updated.orderNumber,
			status: updated.status,
			paymentStatus: updated.paymentStatus,
			total: updated.total,
			currency: updated.currency,
			externalReference: updated.externalReference,
			reason: reason ?? null
		});
	}

	// Customer notification through the Template Center: only when the tenant mapped
	// an approved template to this event. Fire-and-forget — fulfilment never blocks.
	const notifyEvent = STATUS_NOTIFY[toStatus];
	if (notifyEvent) {
		void orderTemplateContext(tenantId, updated)
			.then(({ to, ctx }) => sendEventTemplate(tenantId, notifyEvent, to, ctx, `order-${notifyEvent}:${updated.id}`))
			.catch(() => undefined);
	}
	return updated;
}

/**
 * Recompute amount_paid and the derived payment status from SUCCEEDED payments.
 * Payment status never touches fulfilment status: CONFIRMED ≠ PAID by design.
 */
export async function applyOrderPaymentTotals(tenantId: string, orderId: string): Promise<schema.Order> {
	const order = await getOrder(tenantId, orderId);
	const rows = (await db().execute<{ paid: string; refunded: string; failed: number }>(sql`
		select
			coalesce(sum(amount - amount_refunded) filter (where status in ('SUCCEEDED','PARTIALLY_REFUNDED')), 0)::numeric(14,2) as paid,
			coalesce(sum(amount_refunded), 0)::numeric(14,2) as refunded,
			count(*) filter (where status = 'FAILED')::int as failed
		from payments
		where tenant_id = ${tenantId}::uuid and order_id = ${orderId}::uuid
	`)) as unknown as Array<{ paid: string; refunded: string; failed: number }>;

	const paid = dec(rows[0]?.paid);
	const refunded = dec(rows[0]?.refunded);
	const total = dec(order.total);

	let paymentStatus: schema.Order['paymentStatus'];
	if (paid <= 0 && refunded > 0) paymentStatus = 'REFUNDED';
	else if (paid >= total && total > 0) paymentStatus = 'PAID';
	else if (paid > 0) paymentStatus = 'PARTIALLY_PAID';
	else if (Number(rows[0]?.failed ?? 0) > 0) paymentStatus = 'FAILED';
	else paymentStatus = 'UNPAID';

	const [updated] = await db()
		.update(schema.orders)
		.set({ amountPaid: fixed(paid), paymentStatus, updatedAt: new Date() })
		.where(and(eq(schema.orders.id, orderId), eq(schema.orders.tenantId, tenantId)))
		.returning();
	return updated;
}

export async function orderStats(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			count(*)::int as total,
			count(*) filter (where status in ('DRAFT','PENDING_CONFIRMATION'))::int as pending,
			count(*) filter (where status in ('CONFIRMED','PROCESSING','READY'))::int as in_progress,
			count(*) filter (where status = 'DISPATCHED')::int as dispatched,
			count(*) filter (where status = 'DELIVERED')::int as delivered,
			count(*) filter (where payment_status in ('UNPAID','PARTIALLY_PAID') and status not in ('DRAFT','CANCELLED','REFUNDED'))::int as unpaid,
			coalesce(sum(total) filter (where status not in ('DRAFT','CANCELLED','REFUNDED')), 0)::float as order_value
		from orders where tenant_id = ${tenantId}::uuid
	`)) as unknown as Array<Record<string, number>>;
	const r = rows[0] ?? {};
	return {
		total: Number(r.total ?? 0),
		pending: Number(r.pending ?? 0),
		inProgress: Number(r.in_progress ?? 0),
		dispatched: Number(r.dispatched ?? 0),
		delivered: Number(r.delivered ?? 0),
		unpaid: Number(r.unpaid ?? 0),
		orderValue: Number(r.order_value ?? 0)
	};
}
