// Orders + catalog + forms + template engine — same standards as the booking suite:
// tenant isolation is mandatory, money is computed server-side, lifecycles audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

describe('template variable engine (pure)', () => {
	it('converts named variables to positional and back-fills values', async () => {
		const { toPositional, resolveVariables } = await import('../src/lib/server/whatsapp/template-engine');
		const { text, variables } = toPositional(
			'Hello {{customer.first_name}}, order {{order.number}} total {{order.total}}. Thanks {{customer.first_name}}!'
		);
		expect(text).toBe('Hello {{1}}, order {{2}} total {{3}}. Thanks {{1}}!'); // repeat reuses index
		expect(variables).toEqual(['customer.first_name', 'order.number', 'order.total']);

		const values = resolveVariables(variables, {
			customer: { firstName: 'Amina' },
			order: { number: 'MKD-OR-2026-00001', total: '250.00', currency: 'USD' }
		});
		expect(values).toEqual(['Amina', 'MKD-OR-2026-00001', 'USD 250.00']);
	});

	it('rejects unknown variables at authoring time', async () => {
		const { toPositional } = await import('../src/lib/server/whatsapp/template-engine');
		expect(() => toPositional('Hi {{customer.shoe_size}}')).toThrowError(/Unknown template variable/);
	});
});

describe('order totals (pure)', () => {
	it('derives totals from items with line discounts, order discount and delivery', async () => {
		const { computeOrderTotals } = await import('../src/lib/server/orders');
		const { subtotal, total } = computeOrderTotals(
			[
				{ quantity: 2, unitPrice: '100.00', discount: '10.00' }, // 190
				{ quantity: 1, unitPrice: '50.00' } // 50
			],
			'20.00',
			'15.00'
		);
		expect(subtotal).toBe('240.00');
		expect(total).toBe('235.00');
	});
});


/** Test tenants exercise behaviour, not plan limits — lift the caps explicitly. */
async function liftLimits(tenantId: string): Promise<void> {
	const { db, schema } = await import('../src/lib/server/db');
	const { eq } = await import('drizzle-orm');
	const { invalidateEntitlements } = await import('../src/lib/server/entitlements');
	await db()
		.update(schema.tenants)
		.set({
			entitlementOverrides: {
				'whatsapp.maxNumbers': 0,
				'forms.maxForms': 0,
				'orders.maxPerMonth': 0,
				'bookings.maxRequestsPerMonth': 0,
				'quotations.maxPerMonth': 0,
				'whatsapp.maxOutboundPerMonth': 0,
				'webhooks.enabled': true,
				'payments.enabled': true
			}
		})
		.where(eq(schema.tenants.id, tenantId));
	invalidateEntitlements(tenantId);
}

suite('commerce integration', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		tenants: typeof import('../src/lib/server/tenants');
		orders: typeof import('../src/lib/server/orders');
		catalog: typeof import('../src/lib/server/catalog');
		customers: typeof import('../src/lib/server/customers');
		payments: typeof import('../src/lib/server/payments');
		forms: typeof import('../src/lib/server/forms');
	};
	let tenantA: { id: string };
	let tenantB: { id: string };
	const stamp = `${Date.now()}-com`;

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			tenants: await import('../src/lib/server/tenants'),
			orders: await import('../src/lib/server/orders'),
			catalog: await import('../src/lib/server/catalog'),
			customers: await import('../src/lib/server/customers'),
			payments: await import('../src/lib/server/payments'),
			forms: await import('../src/lib/server/forms')
		};
		tenantA = await provisionTestTenant({ name: 'Shop A', slug: `shop-a-${stamp}`, bookingReferencePrefix: 'SHA' });
		tenantB = await provisionTestTenant({ name: 'Shop B', slug: `shop-b-${stamp}`, bookingReferencePrefix: 'SHB' });
		await liftLimits(tenantA.id);
		await liftLimits(tenantB.id);
	}, 60_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(inArray(schema.tenants.id, [tenantA.id, tenantB.id]));
		await ctx.db.closeDb();
	});

	it('runs the WhatsApp-seller lifecycle: draft → confirm → dispatch → deliver, paid along the way', async () => {
		const customer = await ctx.customers.findOrCreateCustomer(tenantA.id, {
			firstName: 'Neema',
			whatsappPhone: `2557${stamp.replace(/\D/g, '').slice(-8)}`
		});

		const order = await ctx.orders.createOrder(tenantA.id, {
			customerId: customer.id,
			source: 'WHATSAPP_DIRECT',
			deliveryFee: '5.00',
			deliveryMethod: 'DELIVERY',
			deliveryLocation: 'Kariakoo, Dar es Salaam',
			items: [
				{ title: 'Nike Air Max', variant: 'Black / 43', quantity: 2, unitPrice: '120.00' },
				{ title: 'Socks', quantity: 3, unitPrice: '5.00' }
			]
		});
		expect(order.orderNumber).toMatch(/^SHA-OR-\d{4}-\d{5}$/);
		expect(order.status).toBe('DRAFT');
		expect(order.paymentStatus).toBe('UNPAID');
		expect(order.subtotal).toBe('255.00');
		expect(order.total).toBe('260.00');

		// Confirmed while still unpaid — the two statuses are independent.
		const confirmed = await ctx.orders.changeOrderStatus(tenantA.id, order.id, 'CONFIRMED');
		expect(confirmed.status).toBe('CONFIRMED');
		expect(confirmed.paymentStatus).toBe('UNPAID');

		await ctx.payments.createPayment(tenantA.id, { orderId: order.id, amount: '100.00', provider: 'MANUAL' });
		let refreshed = await ctx.orders.getOrder(tenantA.id, order.id);
		expect(refreshed.paymentStatus).toBe('PARTIALLY_PAID');

		await ctx.payments.createPayment(tenantA.id, { orderId: order.id, amount: '160.00', provider: 'MANUAL' });
		refreshed = await ctx.orders.getOrder(tenantA.id, order.id);
		expect(refreshed.paymentStatus).toBe('PAID');
		expect(refreshed.amountPaid).toBe('260.00');
		expect(refreshed.status).toBe('CONFIRMED'); // payment never advances fulfilment

		await ctx.orders.changeOrderStatus(tenantA.id, order.id, 'DISPATCHED');
		const delivered = await ctx.orders.changeOrderStatus(tenantA.id, order.id, 'DELIVERED');
		expect(delivered.status).toBe('DELIVERED');

		const detail = await ctx.orders.getOrderDetail(tenantA.id, order.id);
		expect(detail.history.map((h) => h.toStatus)).toEqual(['DELIVERED', 'DISPATCHED', 'CONFIRMED', 'DRAFT']);
	}, 90_000);

	it('refuses illegal transitions and edits after confirmation', async () => {
		const order = await ctx.orders.createOrder(tenantA.id, { items: [{ title: 'Item', unitPrice: '10.00' }] });
		await expect(ctx.orders.changeOrderStatus(tenantA.id, order.id, 'DELIVERED')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await ctx.orders.changeOrderStatus(tenantA.id, order.id, 'CONFIRMED');
		await expect(ctx.orders.updateDraftOrder(tenantA.id, order.id, { notes: 'nope' })).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('keeps orders tenant-isolated', async () => {
		const order = await ctx.orders.createOrder(tenantA.id, { items: [{ title: 'Private', unitPrice: '9.99' }] });
		await expect(ctx.orders.getOrder(tenantB.id, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(ctx.orders.changeOrderStatus(tenantB.id, order.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'NOT_FOUND' });
		// B cannot attach a payment to A's order either.
		await expect(ctx.payments.createPayment(tenantB.id, { orderId: order.id, amount: '1.00' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('refuses a cross-tenant customer on the order UPDATE path (BOLA regression)', async () => {
		// createOrder always verified ownership; updateDraftOrder did not, letting a
		// tenant point its own draft at a foreign customer and read the PII back.
		const foreign = await ctx.customers.findOrCreateCustomer(tenantB.id, {
			firstName: 'Private',
			lastName: 'Person',
			email: `private-${stamp}@example.com`
		});
		const draft = await ctx.orders.createOrder(tenantA.id, { items: [{ title: 'Thing', unitPrice: '5.00' }] });

		await expect(ctx.orders.updateDraftOrder(tenantA.id, draft.id, { customerId: foreign.id })).rejects.toMatchObject({
			code: 'CUSTOMER_NOT_FOUND'
		});
		// And creation rejects it too, as it always did.
		await expect(
			ctx.orders.createOrder(tenantA.id, { customerId: foreign.id, items: [{ title: 'X', unitPrice: '1.00' }] })
		).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });

		// Detail never surfaces a foreign customer even if one were somehow stored.
		const detail = await ctx.orders.getOrderDetail(tenantA.id, draft.id);
		expect(detail.customer).toBeNull();
	});

	it('clearing the customer with null still works', async () => {
		const mine = await ctx.customers.findOrCreateCustomer(tenantA.id, { firstName: 'Mine', email: `mine-${stamp}@example.com` });
		const draft = await ctx.orders.createOrder(tenantA.id, { customerId: mine.id, items: [{ title: 'Thing', unitPrice: '5.00' }] });
		const cleared = await ctx.orders.updateDraftOrder(tenantA.id, draft.id, { customerId: null });
		expect(cleared.customerId).toBeNull();
	});

	it('keeps catalog tenant-isolated and batch fetch scoped', async () => {
		const item = await ctx.catalog.createCatalogItem(tenantA.id, { name: 'Secret product', price: '10.00' });
		await expect(ctx.catalog.getCatalogItem(tenantB.id, item.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(await ctx.catalog.getCatalogItemsByIds(tenantB.id, [item.id])).toEqual([]);
	});

	it('conversation links on orders cannot cross tenants', async () => {
		const conversations = await import('../src/lib/server/conversations');
		const conv = await conversations.findOrCreateConversation({
			tenantId: tenantB.id,
			channel: 'WHATSAPP',
			externalId: `2559${stamp.replace(/\D/g, '').slice(-8)}`
		});
		await expect(
			ctx.orders.createOrder(tenantA.id, { conversationId: conv.id, items: [{ title: 'X', unitPrice: '1.00' }] })
		).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
	});

	/* ------------------------------------------------------ hosted forms --- */

	it('creates a form with an opaque public id and resolves its tenant server-side', async () => {
		const form = await ctx.forms.createForm(tenantA.id, { type: 'ORDER', name: 'Order form' });
		expect(form.publicId).toMatch(/^wf_/);
		const resolved = await ctx.forms.resolvePublicForm(form.publicId);
		expect(resolved.tenant.id).toBe(tenantA.id);

		const config = await ctx.forms.publicFormConfig(form.publicId);
		const json = JSON.stringify(config);
		expect(json).not.toContain(tenantA.id); // no tenant id leaks through the public config
		expect(config.businessName).toBe('Shop A');
	});

	it('a disabled form stops resolving; a regenerated id kills the old one', async () => {
		const form = await ctx.forms.createForm(tenantA.id, { type: 'LEAD', name: 'Contact' });
		await ctx.forms.updateForm(tenantA.id, form.id, { isActive: false });
		await expect(ctx.forms.resolvePublicForm(form.publicId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

		await ctx.forms.updateForm(tenantA.id, form.id, { isActive: true });
		const regenerated = await ctx.forms.regeneratePublicId(tenantA.id, form.id);
		await expect(ctx.forms.resolvePublicForm(form.publicId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(ctx.forms.resolvePublicForm(regenerated.publicId)).resolves.toBeTruthy();
	});

	it('enforces the origin allow-list, including subdomains', async () => {
		const form = await ctx.forms.createForm(tenantA.id, { type: 'BOOKING', name: 'Embed' });
		const restricted = await ctx.forms.updateForm(tenantA.id, form.id, { allowedOrigins: ['example.com'] });
		expect(ctx.forms.originAllowed(restricted, 'https://example.com')).toBe(true);
		expect(ctx.forms.originAllowed(restricted, 'https://www.example.com')).toBe(true);
		expect(ctx.forms.originAllowed(restricted, 'https://evil.com')).toBe(false);
		expect(ctx.forms.originAllowed(restricted, null)).toBe(false);
		const open = await ctx.forms.updateForm(tenantA.id, form.id, { allowedOrigins: [] });
		expect(ctx.forms.originAllowed(open, null)).toBe(true);
	});

	it('strips unknown field keys from form configuration', async () => {
		const form = await ctx.forms.createForm(tenantA.id, { type: 'LEAD', name: 'Strict' });
		const updated = await ctx.forms.updateForm(tenantA.id, form.id, {
			fields: { firstName: { enabled: true, required: true }, evil_injected: { enabled: true, required: true } } as never
		});
		expect(Object.keys(updated.fields)).not.toContain('evil_injected');
	});

	it('forms are tenant-isolated for management', async () => {
		const form = await ctx.forms.createForm(tenantA.id, { type: 'LEAD', name: 'Mine' });
		await expect(ctx.forms.getForm(tenantB.id, form.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(ctx.forms.regeneratePublicId(tenantB.id, form.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});
});
