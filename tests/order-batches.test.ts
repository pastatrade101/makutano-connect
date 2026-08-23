// Order Batches — the fish-seller acceptance test, executed literally.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

if (!TEST_DB) {
	console.warn('\n⚠️  TEST_DATABASE_URL is not set — order-batch tests were SKIPPED.\n');
}

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	batches: typeof import('../src/lib/server/order-batches');
	orders: typeof import('../src/lib/server/orders');
	customers: typeof import('../src/lib/server/customers');
	payments: typeof import('../src/lib/server/payments');
	ent: typeof import('../src/lib/server/entitlements');
};

let ctx: Ctx;
let tenantA: { id: string };
let tenantB: { id: string };
const stamp = `${Date.now()}-batch`;

async function liftLimits(tenantId: string): Promise<void> {
	const { db, schema } = ctx.db;
	const { eq } = await import('drizzle-orm');
	await db()
		.update(schema.tenants)
		.set({
			entitlementOverrides: {
				'orders.maxPerMonth': 0,
				'bookings.maxRequestsPerMonth': 0,
				'whatsapp.maxOutboundPerMonth': 0
			}
		})
		.where(eq(schema.tenants.id, tenantId));
	ctx.ent.invalidateEntitlements(tenantId);
}

suite('order batches', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			batches: await import('../src/lib/server/order-batches'),
			orders: await import('../src/lib/server/orders'),
			customers: await import('../src/lib/server/customers'),
			payments: await import('../src/lib/server/payments'),
			ent: await import('../src/lib/server/entitlements')
		};
		tenantA = await provisionTestTenant({ name: 'Fish A', slug: `fish-a-${stamp}`, bookingReferencePrefix: 'FSA' });
		tenantB = await provisionTestTenant({ name: 'Fish B', slug: `fish-b-${stamp}`, bookingReferencePrefix: 'FSB' });
		await liftLimits(tenantA.id);
		await liftLimits(tenantB.id);
	}, 120_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(inArray(schema.tenants.id, [tenantA.id, tenantB.id]));
		await ctx.db.closeDb();
	});

	let batchId: string;
	let mamaDanielId: string;
	let firstOrderId: string;

	it('creates "Saturday Fish Delivery" with item, unit, price and delivery day', async () => {
		const batch = await ctx.batches.createBatch(tenantA.id, {
			name: 'Saturday Fish Delivery — 4 July',
			fulfilmentDate: new Date('2026-07-04T12:00:00Z'),
			defaultItemTitle: 'Fresh Fish',
			defaultUnit: 'KG',
			defaultUnitPrice: '14000',
			currency: 'TZS'
		});
		batchId = batch.id;
		expect(batch.status).toBe('OPEN');
		expect(batch.defaultUnitPrice).toBe('14000.00');
	});

	it('Mama Daniel with quantity 4 becomes TZS 56,000, inheriting everything from the batch', async () => {
		const customer = await ctx.customers.createCustomer(tenantA.id, { firstName: 'Mama', lastName: 'Daniel' });
		mamaDanielId = customer.id;
		const order = await ctx.batches.createBatchOrder(tenantA.id, batchId, {
			customerId: customer.id,
			quantity: 4,
			source: 'WHATSAPP_GROUP'
		});
		firstOrderId = order.id;
		expect(order.total).toBe('56000.00');
		expect(order.currency).toBe('TZS');
		expect(order.batchId).toBe(batchId);
		expect(order.status).toBe('PENDING_CONFIRMATION');
		expect(order.paymentStatus).toBe('UNPAID'); // §4 — never auto-paid
		expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-07-04');
		expect(order.source).toBe('WHATSAPP_GROUP');

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const items = await db().select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Fresh Fish');
		expect(items[0].unit).toBe('KG');
		expect(items[0].quantity).toBe(4);
	});

	it('rapid entries add up: the summary shows customers, KG, revenue, paid and outstanding', async () => {
		const nasri = await ctx.customers.createCustomer(tenantA.id, { firstName: 'Nasri' });
		const habiba = await ctx.customers.createCustomer(tenantA.id, { firstName: 'Habiba' });
		await ctx.batches.createBatchOrder(tenantA.id, batchId, { customerId: nasri.id, quantity: 3 });
		const habibaOrder = await ctx.batches.createBatchOrder(tenantA.id, batchId, { customerId: habiba.id, quantity: 5 });

		// Nasri pays in full through the existing payment infrastructure (§16).
		const nasriOrder = (
			await ctx.orders.listOrders(tenantA.id, { page: 1, limit: 10, order: 'desc' }, { batchId, customerId: nasri.id })
		).items[0].order;
		await ctx.payments.createPayment(tenantA.id, { orderId: nasriOrder.id, amount: '42000', provider: 'MANUAL' });

		// Habiba pays a 20,000 deposit — partial payment (§17).
		await ctx.payments.createPayment(tenantA.id, { orderId: habibaOrder.id, amount: '20000', provider: 'MANUAL' });

		const summary = await ctx.batches.batchSummary(tenantA.id, batchId);
		expect(summary.customers).toBe(3);
		expect(summary.totalQuantity).toBe(12); // 4 + 3 + 5
		expect(summary.expectedRevenue).toBe('168000.00'); // 12 × 14,000
		expect(summary.paid).toBe('62000.00'); // 42,000 + 20,000
		expect(summary.outstanding).toBe('106000.00');

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const habibaAfter = (await db().select().from(schema.orders).where(eq(schema.orders.id, habibaOrder.id)))[0];
		expect(habibaAfter.paymentStatus).toBe('PARTIALLY_PAID');
		const nasriAfter = (await db().select().from(schema.orders).where(eq(schema.orders.id, nasriOrder.id)))[0];
		expect(nasriAfter.paymentStatus).toBe('PAID');
		expect(nasriAfter.status).toBe('PENDING_CONFIRMATION'); // payment does not confirm (§4)
	});

	it('confirm → ready → delivered walks the existing state machine', async () => {
		await ctx.orders.changeOrderStatus(tenantA.id, firstOrderId, 'CONFIRMED');
		await ctx.orders.changeOrderStatus(tenantA.id, firstOrderId, 'READY');
		const done = await ctx.orders.changeOrderStatus(tenantA.id, firstOrderId, 'DELIVERED');
		expect(done.status).toBe('DELIVERED');
		const summary = await ctx.batches.batchSummary(tenantA.id, batchId);
		expect(summary.statusCounts.DELIVERED).toBe(1);
	});

	it('cancelled orders drop out of the money but stay countable', async () => {
		const bea = await ctx.customers.createCustomer(tenantA.id, { firstName: 'Beatrice' });
		const order = await ctx.batches.createBatchOrder(tenantA.id, batchId, { customerId: bea.id, quantity: 4 });
		await ctx.orders.changeOrderStatus(tenantA.id, order.id, 'CANCELLED');
		const summary = await ctx.batches.batchSummary(tenantA.id, batchId);
		expect(summary.expectedRevenue).toBe('168000.00'); // unchanged
		expect(summary.statusCounts.CANCELLED).toBe(1);
	});

	it('a closed batch refuses new orders but keeps existing ones', async () => {
		await ctx.batches.updateBatch(tenantA.id, batchId, { status: 'CLOSED' });
		await expect(
			ctx.batches.createBatchOrder(tenantA.id, batchId, { customerId: mamaDanielId, quantity: 1 })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await ctx.batches.updateBatch(tenantA.id, batchId, { status: 'OPEN' });
	});

	it('rejects a zero or negative quantity', async () => {
		await expect(
			ctx.batches.createBatchOrder(tenantA.id, batchId, { customerId: mamaDanielId, quantity: 0 })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});

	it('tenant B can neither read nor order into tenant A\'s batch', async () => {
		await expect(ctx.batches.getBatch(tenantB.id, batchId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		const intruder = await ctx.customers.createCustomer(tenantB.id, { firstName: 'Intruder' });
		await expect(
			ctx.batches.createBatchOrder(tenantB.id, batchId, { customerId: intruder.id, quantity: 99 })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		// And a cross-tenant batchId on a direct order is refused too.
		await expect(
			ctx.orders.createOrder(tenantB.id, { batchId, items: [{ title: 'X', quantity: 1, unitPrice: '1.00' }] })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('batch creation is blocked server-side when orders are not in the plan (§21)', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'orders.enabled': false } })
			.where(eq(schema.tenants.id, tenantB.id));
		ctx.ent.invalidateEntitlements(tenantB.id);

		await expect(
			ctx.batches.createBatch(tenantB.id, { name: 'Blocked', defaultItemTitle: 'X' })
		).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });

		await liftLimits(tenantB.id); // restore
	});

	it('batch orders count against the monthly order cap', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'orders.maxPerMonth': 1 } })
			.where(eq(schema.tenants.id, tenantB.id));
		ctx.ent.invalidateEntitlements(tenantB.id);

		const b = await ctx.batches.createBatch(tenantB.id, {
			name: 'Capped',
			defaultItemTitle: 'Fish',
			defaultUnitPrice: '1000'
		});
		const c1 = await ctx.customers.createCustomer(tenantB.id, { firstName: 'One' });
		const c2 = await ctx.customers.createCustomer(tenantB.id, { firstName: 'Two' });
		await ctx.batches.createBatchOrder(tenantB.id, b.id, { customerId: c1.id, quantity: 1 });
		await expect(
			ctx.batches.createBatchOrder(tenantB.id, b.id, { customerId: c2.id, quantity: 1 })
		).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT_REACHED' });

		await liftLimits(tenantB.id);
	});
});
