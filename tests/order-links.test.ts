// Order Links — the brief's acceptance scenarios (§36 fish seller, §37 no website)
// plus the boundary rails: server-priced totals, capacity, deadline, idempotency and
// tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liftLimits, provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	links: typeof import('../src/lib/server/order-links');
	batches: typeof import('../src/lib/server/order-batches');
	orders: typeof import('../src/lib/server/orders');
};

let ctx: Ctx;
let tenantId: string;
let otherTenantId: string;
const stamp = Date.now();
let token = 0;
const nextToken = () => `oltest${stamp}${token++}`;

suite('order links', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			links: await import('../src/lib/server/order-links'),
			batches: await import('../src/lib/server/order-batches'),
			orders: await import('../src/lib/server/orders')
		};
		tenantId = (await provisionTestTenant({ name: 'Mama Samaki', slug: `test-ol-${stamp}` })).id;
		otherTenantId = (await provisionTestTenant({ name: 'Other Shop', slug: `test-ol-${stamp}-b` })).id;
		await liftLimits(tenantId);
		await liftLimits(otherTenantId);
	}, 120_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		await db()
			.delete(schema.tenants)
			.where(inArray(schema.tenants.id, [tenantId, otherTenantId]));
		await ctx.db.closeDb();
	});

	it('§36 fish seller: link + batch → customer, order, line, source, awaiting confirmation', async () => {
		const batch = await ctx.batches.createBatch(tenantId, {
			name: 'Saturday Fish Delivery',
			defaultItemTitle: 'Fresh Fish',
			defaultUnit: 'KG',
			defaultUnitPrice: '14000',
			currency: 'TZS'
		});

		const link = await ctx.links.createOrderLink(tenantId, {
			title: 'Fresh Fish',
			description: 'Fresh fish available for Saturday delivery.',
			unit: 'KG',
			unitPrice: '14000',
			currency: 'TZS',
			minQuantity: 1,
			batchId: batch.id,
			shareTags: [{ key: 'wa-group-a', label: 'WhatsApp Group A' }]
		});
		expect(link.publicId).toMatch(/^ol_/);
		expect(link.status).toBe('DRAFT');

		// A DRAFT link is publicly invisible — unknown and draft ids fail identically.
		expect(await ctx.links.getPublicOrderLink(link.publicId)).toBeNull();
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');

		const pub = await ctx.links.getPublicOrderLink(link.publicId);
		expect(pub?.state).toBe('OPEN');
		expect(pub?.business.name).toBe('Mama Samaki');
		// §25: the public projection carries no tenant or database ids.
		expect(JSON.stringify(pub)).not.toContain(tenantId);
		expect(JSON.stringify(pub)).not.toContain(link.id);

		const receipt = await ctx.links.submitOrderLink(
			link.publicId,
			{
				name: 'Asha Mrisho',
				whatsappPhone: '+255700111222',
				quantity: 4,
				deliveryMethod: 'DELIVERY',
				deliveryLocation: 'Mbezi',
				submissionToken: nextToken(),
				sourceTag: 'wa-group-a'
			},
			{ ipHash: 'test-ip-1' }
		);
		// §8: totals are computed server-side from the LINK's price.
		expect(Number(receipt.total)).toBe(4 * 14000);

		const { items } = await ctx.orders.listOrders(
			tenantId,
			{ page: 1, limit: 10, order: 'desc' },
			{ orderLinkId: link.id }
		);
		expect(items).toHaveLength(1);
		const order = items[0].order;
		expect(order.status).toBe('PENDING_CONFIRMATION'); // §10 awaiting confirmation
		expect(order.source).toBe('ORDER_LINK');
		expect(order.batchId).toBe(batch.id); // §14 batch integration
		expect(order.deliveryLocation).toBe('Mbezi');
		expect((order.metadata as Record<string, { tag?: string }>).orderLink?.tag).toBe('wa-group-a'); // §13
		expect(items[0].customer?.whatsappPhone).toContain('255700111222');

		const stats = await ctx.links.listOrderLinks(tenantId);
		const mine = stats.find((s) => s.link.id === link.id);
		expect(mine?.stats).toMatchObject({ orders: 1, quantity: 4, expected: 56000 });

		const breakdown = await ctx.links.orderLinkSourceBreakdown(tenantId, link.id);
		expect(breakdown).toEqual([{ tag: 'wa-group-a', orders: 1, quantity: 4 }]);
	}, 120_000);

	it('§37 no catalog, no website — a link alone accepts structured orders', async () => {
		const link = await ctx.links.createOrderLink(tenantId, { title: 'Mandazi Box', unit: 'Box', unitPrice: '5000' });
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');
		const receipt = await ctx.links.submitOrderLink(
			link.publicId,
			{
				name: 'Neema',
				whatsappPhone: '+255700111333',
				quantity: 2,
				deliveryMethod: 'PICKUP',
				submissionToken: nextToken()
			},
			{ ipHash: 'test-ip-2' }
		);
		expect(Number(receipt.total)).toBe(10000);
		expect(receipt.orderNumber).toBeTruthy();
	}, 60_000);

	it('§21 idempotency: concurrent use of the same submission token creates one order', async () => {
		const link = await ctx.links.createOrderLink(tenantId, { title: 'Eggs', unit: 'Tray', unitPrice: '12000' });
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');
		const tok = nextToken();
		const submission = {
			name: 'Juma',
			whatsappPhone: '+255700111444',
			quantity: 3,
			deliveryMethod: 'PICKUP' as const,
			submissionToken: tok
		};
		const [first, second] = await Promise.all([
			ctx.links.submitOrderLink(link.publicId, submission, { ipHash: 'test-ip-3a' }),
			ctx.links.submitOrderLink(link.publicId, submission, { ipHash: 'test-ip-3b' })
		]);
		expect(second.orderNumber).toBe(first.orderNumber);
		const { items } = await ctx.orders.listOrders(
			tenantId,
			{ page: 1, limit: 10, order: 'desc' },
			{ orderLinkId: link.id }
		);
		expect(items).toHaveLength(1);
	}, 60_000);

	it('revoking the Order Link entitlement closes public reads and submissions immediately', async () => {
		const link = await ctx.links.createOrderLink(tenantId, {
			title: 'Revoked Offer',
			unit: 'Piece',
			unitPrice: '1000'
		});
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const { invalidateEntitlements } = await import('../src/lib/server/entitlements');
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'orders.enabled': true, 'orders.maxPerMonth': 0, 'orderLinks.enabled': false } })
			.where(eq(schema.tenants.id, tenantId));
		invalidateEntitlements(tenantId);

		expect(await ctx.links.getPublicOrderLink(link.publicId)).toBeNull();
		await expect(
			ctx.links.submitOrderLink(
				link.publicId,
				{
					name: 'Asha',
					whatsappPhone: '+255700112001',
					quantity: 1,
					deliveryMethod: 'PICKUP',
					submissionToken: nextToken()
				},
				{ ipHash: 'test-ip-revoked' }
			)
		).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });
		await liftLimits(tenantId);
	}, 60_000);

	it('§19/§20 deadline and capacity close the link with friendly refusals', async () => {
		const past = await ctx.links.createOrderLink(tenantId, {
			title: 'Closed Offer',
			unit: 'KG',
			unitPrice: '1000',
			deadline: new Date(Date.now() - 60_000)
		});
		await ctx.links.setOrderLinkStatus(tenantId, past.id, 'ACTIVE');
		expect((await ctx.links.getPublicOrderLink(past.publicId))?.state).toBe('CLOSED');
		await expect(
			ctx.links.submitOrderLink(
				past.publicId,
				{
					name: 'X',
					whatsappPhone: '+255700111555',
					quantity: 1,
					deliveryMethod: 'PICKUP',
					submissionToken: nextToken()
				},
				{ ipHash: 'test-ip-4' }
			)
		).rejects.toMatchObject({ message: 'Ordering for this offer has closed.' });

		const capped = await ctx.links.createOrderLink(tenantId, {
			title: 'Limited',
			unit: 'KG',
			unitPrice: '1000',
			capacityTotal: 5
		});
		await ctx.links.setOrderLinkStatus(tenantId, capped.id, 'ACTIVE');
		await ctx.links.submitOrderLink(
			capped.publicId,
			{
				name: 'A',
				whatsappPhone: '+255700111666',
				quantity: 4,
				deliveryMethod: 'PICKUP',
				submissionToken: nextToken()
			},
			{ ipHash: 'test-ip-5' }
		);
		await expect(
			ctx.links.submitOrderLink(
				capped.publicId,
				{
					name: 'B',
					whatsappPhone: '+255700111777',
					quantity: 4,
					deliveryMethod: 'PICKUP',
					submissionToken: nextToken()
				},
				{ ipHash: 'test-ip-6' }
			)
		).rejects.toMatchObject({ code: 'CONFLICT' });
		// Remaining capacity (1) is below the minimum → publicly SOLD_OUT.
		await ctx.links.submitOrderLink(
			capped.publicId,
			{
				name: 'C',
				whatsappPhone: '+255700111888',
				quantity: 1,
				deliveryMethod: 'PICKUP',
				submissionToken: nextToken()
			},
			{ ipHash: 'test-ip-7' }
		);
		expect((await ctx.links.getPublicOrderLink(capped.publicId))?.state).toBe('SOLD_OUT');
	}, 120_000);

	it('quantity bounds and paused links are enforced server-side', async () => {
		const link = await ctx.links.createOrderLink(tenantId, {
			title: 'Rice',
			unit: 'Bag',
			unitPrice: '90000',
			minQuantity: 2,
			maxQuantity: 10
		});
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');
		const base = { name: 'Z', whatsappPhone: '+255700111999', deliveryMethod: 'PICKUP' as const };
		await expect(
			ctx.links.submitOrderLink(
				link.publicId,
				{ ...base, quantity: 1, submissionToken: nextToken() },
				{ ipHash: 'test-ip-8' }
			)
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await expect(
			ctx.links.submitOrderLink(
				link.publicId,
				{ ...base, quantity: 11, submissionToken: nextToken() },
				{ ipHash: 'test-ip-8' }
			)
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'PAUSED');
		await expect(
			ctx.links.submitOrderLink(
				link.publicId,
				{ ...base, quantity: 2, submissionToken: nextToken() },
				{ ipHash: 'test-ip-8' }
			)
		).rejects.toMatchObject({ message: 'Ordering for this offer has closed.' });
	}, 60_000);

	it('review fixes: refunded orders free capacity, replay echoes the stored order, tags count orders', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const link = await ctx.links.createOrderLink(tenantId, {
			title: 'Review Fixes',
			unit: 'KG',
			unitPrice: '1000',
			capacityTotal: 4,
			shareTags: [{ key: 'status', label: 'Status' }]
		});
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');

		const tok = nextToken();
		const first = await ctx.links.submitOrderLink(
			link.publicId,
			{
				name: 'Rita',
				whatsappPhone: '+255700113001',
				quantity: 4,
				deliveryMethod: 'PICKUP',
				submissionToken: tok,
				sourceTag: 'status'
			},
			{ ipHash: 'test-ip-fix-1' }
		);
		// A replay describes the order that EXISTS, not the numbers the caller resent.
		const replay = await ctx.links.submitOrderLink(
			link.publicId,
			{ name: 'Rita', whatsappPhone: '+255700113001', quantity: 99, deliveryMethod: 'PICKUP', submissionToken: tok },
			{ ipHash: 'test-ip-fix-1' }
		);
		expect(replay.orderNumber).toBe(first.orderNumber);
		expect(replay.quantity).toBe(4);
		expect(replay.total).toBe(first.total);

		// One order with one line counts as ONE order per share tag, not one per line.
		expect(await ctx.links.orderLinkSourceBreakdown(tenantId, link.id)).toEqual([
			{ tag: 'status', orders: 1, quantity: 4 }
		]);

		// Capacity is full…
		expect((await ctx.links.getPublicOrderLink(link.publicId))?.state).toBe('SOLD_OUT');
		// …until the order is refunded, which is not a live sale.
		const { items } = await ctx.orders.listOrders(
			tenantId,
			{ page: 1, limit: 5, order: 'desc' },
			{ orderLinkId: link.id }
		);
		await db().update(schema.orders).set({ status: 'REFUNDED' }).where(eq(schema.orders.id, items[0].order.id));
		expect((await ctx.links.getPublicOrderLink(link.publicId))?.state).toBe('OPEN');
		const stats = (await ctx.links.listOrderLinks(tenantId)).find((r) => r.link.id === link.id);
		expect(stats?.stats).toMatchObject({ orders: 0, quantity: 0, expected: 0 });
	}, 120_000);

	it('§27 tenant isolation: links, stats and management never cross tenants', async () => {
		const link = await ctx.links.createOrderLink(tenantId, { title: 'Isolated', unit: 'Piece', unitPrice: '100' });
		// Tenant B cannot see, edit, or read stats for tenant A's link.
		await expect(ctx.links.setOrderLinkStatus(otherTenantId, link.id, 'ACTIVE')).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
		await expect(ctx.links.orderLinkSourceBreakdown(otherTenantId, link.id)).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
		const otherList = await ctx.links.listOrderLinks(otherTenantId);
		expect(otherList.some((r) => r.link.id === link.id)).toBe(false);
		// Tenant B cannot attach an order to tenant A's link through createOrder either.
		await expect(
			ctx.orders.createOrder(otherTenantId, {
				orderLinkId: link.id,
				items: [{ title: 'X', quantity: 1, unitPrice: '1' }]
			})
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	}, 60_000);

	it('archive is terminal and archived links stop accepting orders', async () => {
		const link = await ctx.links.createOrderLink(tenantId, { title: 'Old Offer', unit: 'Piece', unitPrice: '100' });
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE');
		await ctx.links.setOrderLinkStatus(tenantId, link.id, 'ARCHIVED');
		await expect(ctx.links.setOrderLinkStatus(tenantId, link.id, 'ACTIVE')).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(
			ctx.links.updateOrderLink(tenantId, link.id, { title: 'New', unit: 'Piece', unitPrice: '100' })
		).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		await expect(
			ctx.links.submitOrderLink(
				link.publicId,
				{
					name: 'X',
					whatsappPhone: '+255700112000',
					quantity: 1,
					deliveryMethod: 'PICKUP',
					submissionToken: nextToken()
				},
				{ ipHash: 'test-ip-9' }
			)
		).rejects.toMatchObject({ message: 'Ordering for this offer has closed.' });
	}, 60_000);
});
