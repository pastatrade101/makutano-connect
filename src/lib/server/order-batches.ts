// Order Batches — the fish-seller workflow (§7-§11 of the commerce brief).
//
// One batch = one selling round ("Saturday Fish Delivery — 4 July: Fresh Fish, KG,
// TZS 14,000"). Orders created inside it inherit the item, unit, price, currency and
// delivery date, so recording a customer's WhatsApp order is two fields: who, how many.
//
// This is deliberately NOT inventory or e-commerce. Nothing is stocked, reserved or
// forecast; the batch only carries defaults and adds them up.
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { audit } from './audit';
import { db, schema } from './db';
import { assertFeature } from './entitlements';
import { AppError } from './errors';
import { createOrder, type OrderActor } from './orders';
import type { Pagination } from './http';

/** Suggested units for the picker. Free text is always allowed — never an enum. */
export const COMMON_UNITS = ['KG', 'Piece', 'Pack', 'Box', 'Bag', 'Bottle', 'Tray', 'Dozen'] as const;

export type BatchInput = {
	name: string;
	description?: string | null;
	fulfilmentDate?: Date | null;
	defaultItemTitle: string;
	defaultUnit?: string | null;
	defaultUnitPrice?: string;
	currency?: string;
	defaultDeliveryMethod?: schema.OrderBatch['defaultDeliveryMethod'];
};

export async function createBatch(
	tenantId: string,
	input: BatchInput,
	actor: OrderActor = {}
): Promise<schema.OrderBatch> {
	// Batches are part of Orders: same feature gate, enforced server-side (§21).
	await assertFeature(tenantId, 'orders.enabled');
	const name = input.name.trim();
	const item = input.defaultItemTitle.trim();
	if (!name) throw new AppError('VALIDATION_ERROR', 'Give the batch a name, e.g. "Saturday Fish Delivery".');
	if (!item) throw new AppError('VALIDATION_ERROR', 'What is being sold? e.g. "Fresh Fish".');

	const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];

	const [batch] = await db()
		.insert(schema.orderBatches)
		.values({
			tenantId,
			name,
			description: input.description?.trim() || null,
			fulfilmentDate: input.fulfilmentDate ?? null,
			defaultItemTitle: item,
			defaultUnit: input.defaultUnit?.trim() || null,
			defaultUnitPrice: input.defaultUnitPrice ?? '0',
			currency: (input.currency ?? tenant?.currency ?? 'USD').toUpperCase().slice(0, 3),
			defaultDeliveryMethod: input.defaultDeliveryMethod ?? null,
			createdByUserId: actor.userId ?? null
		})
		.returning();

	await audit(tenantId, 'order_batch.created', { type: 'user', userId: actor.userId }, { type: 'order_batch', id: batch.id }, {
		name,
		item,
		unitPrice: batch.defaultUnitPrice,
		currency: batch.currency
	});
	return batch;
}

export async function getBatch(tenantId: string, id: string): Promise<schema.OrderBatch> {
	const rows = await db()
		.select()
		.from(schema.orderBatches)
		.where(and(eq(schema.orderBatches.id, id), eq(schema.orderBatches.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Batch could not be found.');
	return rows[0];
}

export async function updateBatch(
	tenantId: string,
	id: string,
	patch: Partial<BatchInput> & { status?: schema.OrderBatch['status'] },
	actor: OrderActor = {}
): Promise<schema.OrderBatch> {
	const before = await getBatch(tenantId, id);
	const [after] = await db()
		.update(schema.orderBatches)
		.set({
			...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
			...(patch.fulfilmentDate !== undefined ? { fulfilmentDate: patch.fulfilmentDate } : {}),
			...(patch.defaultItemTitle !== undefined ? { defaultItemTitle: patch.defaultItemTitle.trim() } : {}),
			...(patch.defaultUnit !== undefined ? { defaultUnit: patch.defaultUnit?.trim() || null } : {}),
			...(patch.defaultUnitPrice !== undefined ? { defaultUnitPrice: patch.defaultUnitPrice } : {}),
			...(patch.defaultDeliveryMethod !== undefined ? { defaultDeliveryMethod: patch.defaultDeliveryMethod } : {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.orderBatches.id, id), eq(schema.orderBatches.tenantId, tenantId)))
		.returning();

	// Price and status changes matter operationally — record what changed, not every keystroke.
	const changes: Record<string, unknown> = {};
	if (patch.defaultUnitPrice !== undefined && patch.defaultUnitPrice !== before.defaultUnitPrice) {
		changes.price = { from: before.defaultUnitPrice, to: patch.defaultUnitPrice };
	}
	if (patch.status !== undefined && patch.status !== before.status) {
		changes.status = { from: before.status, to: patch.status };
	}
	if (Object.keys(changes).length) {
		await audit(tenantId, 'order_batch.updated', { type: 'user', userId: actor.userId }, { type: 'order_batch', id }, changes);
	}
	return after;
}

/* ---------------------------------------------------------------- summary ---- */

export type BatchSummary = {
	customers: number;
	orders: number;
	totalQuantity: number;
	expectedRevenue: string;
	paid: string;
	outstanding: string;
	statusCounts: Record<string, number>;
};

/**
 * The numbers the seller keeps in their head (or in a pinned WhatsApp message):
 * how many people, how many KG, how much money, who has paid. Cancelled and refunded
 * orders are excluded from the money and quantity — they are shown only as counts.
 */
export async function batchSummary(tenantId: string, batchId: string): Promise<BatchSummary> {
	const rows = (await db().execute(sql`
		select
			count(*)::int as orders,
			count(distinct o.customer_id)::int as customers,
			coalesce(sum(case when o.status not in ('CANCELLED','REFUNDED')
				then (select coalesce(sum(i.quantity), 0) from order_items i where i.order_id = o.id) end), 0)::int as total_quantity,
			coalesce(sum(case when o.status not in ('CANCELLED','REFUNDED') then o.total end), 0)::numeric(14,2) as expected_revenue,
			coalesce(sum(case when o.status not in ('CANCELLED','REFUNDED') then o.amount_paid end), 0)::numeric(14,2) as paid
		from orders o
		where o.tenant_id = ${tenantId}::uuid and o.batch_id = ${batchId}::uuid
	`)) as unknown as Array<{
		orders: number;
		customers: number;
		total_quantity: number;
		expected_revenue: string;
		paid: string;
	}>;

	const statusRows = (await db().execute(sql`
		select status::text as status, count(*)::int as n
		from orders where tenant_id = ${tenantId}::uuid and batch_id = ${batchId}::uuid
		group by status
	`)) as unknown as Array<{ status: string; n: number }>;

	const r = rows[0];
	const outstanding = Math.max(0, Number(r.expected_revenue) - Number(r.paid));
	return {
		customers: r.customers,
		orders: r.orders,
		totalQuantity: r.total_quantity,
		expectedRevenue: Number(r.expected_revenue).toFixed(2),
		paid: Number(r.paid).toFixed(2),
		outstanding: outstanding.toFixed(2),
		statusCounts: Object.fromEntries(statusRows.map((s) => [s.status, s.n]))
	};
}

export async function listBatches(tenantId: string, p: Pagination, filters: { status?: schema.OrderBatch['status'] } = {}) {
	const conditions: SQL[] = [eq(schema.orderBatches.tenantId, tenantId)];
	if (filters.status) conditions.push(eq(schema.orderBatches.status, filters.status));
	const where = and(...conditions);

	const [rows, [{ value: total }]] = await Promise.all([
		db()
			.select({
				batch: schema.orderBatches,
				orders: sql<number>`(select count(*)::int from orders o where o.batch_id = order_batches.id)`,
				revenue: sql<string>`(select coalesce(sum(o.total), 0)::numeric(14,2) from orders o
					where o.batch_id = order_batches.id and o.status not in ('CANCELLED','REFUNDED'))`
			})
			.from(schema.orderBatches)
			.where(where)
			.orderBy(desc(schema.orderBatches.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: sql<number>`count(*)::int` }).from(schema.orderBatches).where(where)
	]);
	return { items: rows, total: Number(total), page: p.page, limit: p.limit };
}

/** The operational table inside a batch: who ordered what, paid or not, one row each. */
export async function batchOrders(tenantId: string, batchId: string) {
	return (await db().execute(sql`
		select o.id, o.order_number, o.status::text as status, o.payment_status::text as payment_status,
			o.total, o.amount_paid, o.currency, o.source::text as source, o.conversation_id, o.created_at,
			c.id as customer_id,
			coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), c.whatsapp_phone, 'Customer') as customer_name,
			coalesce(c.whatsapp_phone, c.phone) as phone,
			(select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as quantity,
			(select i.unit from order_items i where i.order_id = o.id limit 1) as unit
		from orders o
		left join customers c on c.id = o.customer_id
		where o.tenant_id = ${tenantId}::uuid and o.batch_id = ${batchId}::uuid
		order by o.created_at desc
	`)) as unknown as Array<{
		id: string;
		order_number: string;
		status: string;
		payment_status: string;
		total: string;
		amount_paid: string;
		currency: string;
		source: string;
		conversation_id: string | null;
		created_at: string;
		customer_id: string | null;
		customer_name: string;
		phone: string | null;
		quantity: number;
		unit: string | null;
	}>;
}

/* ------------------------------------------------------------ quick entry ---- */

export type BatchOrderInput = {
	customerId: string;
	quantity: number;
	/** Overrides, rarely needed — the batch supplies everything else. */
	unitPrice?: string;
	source?: schema.Order['source'];
	conversationId?: string | null;
	paymentMethod?: string | null;
	notes?: string | null;
};

/**
 * "Mama Daniel → 4" becomes a full order through the one canonical createOrder path —
 * same entitlement checks, same events, same templates. The batch only fills the blanks.
 */
export async function createBatchOrder(
	tenantId: string,
	batchId: string,
	input: BatchOrderInput,
	actor: OrderActor = {}
): Promise<schema.Order> {
	const batch = await getBatch(tenantId, batchId);
	if (batch.status !== 'OPEN') throw new AppError('VALIDATION_ERROR', 'This batch is closed to new orders.');
	const quantity = Math.floor(input.quantity);
	if (!Number.isFinite(quantity) || quantity < 1) {
		throw new AppError('VALIDATION_ERROR', 'Quantity must be at least 1.');
	}

	return createOrder(
		tenantId,
		{
			customerId: input.customerId,
			conversationId: input.conversationId ?? null,
			status: 'PENDING_CONFIRMATION',
			source: input.source ?? 'MANUAL',
			currency: batch.currency,
			batchId: batch.id,
			deliveryDate: batch.fulfilmentDate,
			deliveryMethod: batch.defaultDeliveryMethod,
			paymentMethod: input.paymentMethod ?? null,
			notes: input.notes ?? null,
			items: [
				{
					title: batch.defaultItemTitle,
					quantity,
					unit: batch.defaultUnit,
					unitPrice: input.unitPrice ?? batch.defaultUnitPrice
				}
			]
		},
		actor
	);
}
