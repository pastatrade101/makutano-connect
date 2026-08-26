import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { listCatalogItems } from '$lib/server/catalog';
import { COMMON_UNITS, listBatches } from '$lib/server/order-batches';
import { createCustomer } from '$lib/server/customers';
import { getConversation } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { createOrder } from '$lib/server/orders';
import { eq, and, desc } from 'drizzle-orm';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// A page load that throws a domain error renders a 500; someone simply lacking
	// permission deserves a plain 403 instead.
	try {
		requireTenantPermission(locals, 'orders:write');
	} catch {
		error(403, 'You do not have permission to create orders.');
	}
	const tenantId = requireTenant(locals).id;

	// Conversation → Order: prefill customer + linkage from the thread the staff
	// member came from. The id is verified tenant-scoped, never trusted.
	let conversation: { id: string; customerName: string; phone: string | null } | null = null;
	const conversationId = url.searchParams.get('conversation');
	if (conversationId) {
		try {
			const conv = await getConversation(tenantId, conversationId);
			const customer = conv.customerId
				? (await db().select().from(schema.customers).where(eq(schema.customers.id, conv.customerId)).limit(1))[0]
				: null;
			conversation = {
				id: conv.id,
				customerName:
					[customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conv.externalId ?? ''}`,
				phone: customer?.whatsappPhone ?? conv.externalId
			};
		} catch {
			conversation = null;
		}
	}

	const [{ items: catalog }, recentCustomers, { items: openBatches }] = await Promise.all([
		listCatalogItems(tenantId, { page: 1, limit: 100, order: 'desc' }, { activeOnly: true }),
		db()
			.select({
				id: schema.customers.id,
				firstName: schema.customers.firstName,
				lastName: schema.customers.lastName,
				whatsappPhone: schema.customers.whatsappPhone
			})
			.from(schema.customers)
			.where(and(eq(schema.customers.tenantId, tenantId)))
			.orderBy(desc(schema.customers.createdAt))
			.limit(50),
		listBatches(tenantId, { page: 1, limit: 20, order: 'desc' }, { status: 'OPEN' })
	]);

	return {
		workspaceRelevant: moduleRelevant(
			normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
			'orders'
		),
		conversation,
		catalog: catalog.map((c) => ({
			id: c.id,
			name: c.name,
			price: c.price,
			currency: c.currency,
			variants: c.variants
		})),
		customers: recentCustomers,
		units: COMMON_UNITS,
		batches: openBatches.map((b) => ({
			id: b.batch.id,
			name: b.batch.name,
			itemTitle: b.batch.defaultItemTitle,
			unit: b.batch.defaultUnit,
			unitPrice: b.batch.defaultUnitPrice,
			currency: b.batch.currency,
			fulfilmentDate: b.batch.fulfilmentDate,
			deliveryMethod: b.batch.defaultDeliveryMethod
		}))
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requireTenantPermission(locals, 'orders:write');
		const data = await request.formData();
		let items: Array<Record<string, unknown>>;
		try {
			items = JSON.parse(String(data.get('items') ?? '[]'));
		} catch {
			return fail(400, { message: 'Order items are malformed.', field: '' });
		}
		if (!Array.isArray(items) || items.length === 0) return fail(400, { message: 'Add at least one item.', field: '' });

		// Quick customer creation: a name is enough; phone is optional (§1).
		let customerId = String(data.get('customerId') ?? '') || null;
		const newName = String(data.get('newCustomerName') ?? '').trim();
		if (!customerId && newName) {
			const tenant = requireTenant(locals);
			const [firstName, ...rest] = newName.split(/\s+/);
			const phone = String(data.get('newCustomerPhone') ?? '').trim() || undefined;
			const created = await createCustomer(
				tenant.id,
				{ firstName, lastName: rest.join(' '), phone, whatsappPhone: phone, source: 'ADMIN' },
				tenant.country
			);
			customerId = created.id;
		}

		// Money typed by hand, checked before it reaches the totals — "12,000" or a
		// stray word used to sail through and land as NaN in the order total. The
		// field name travels back so the form can open the section holding it.
		const MONEY = /^\d+(\.\d{1,2})?$/;
		const discount = String(data.get('discount') ?? '').trim();
		const deliveryFee = String(data.get('deliveryFee') ?? '').trim();
		if (discount && !MONEY.test(discount)) {
			return fail(400, { message: 'Enter the discount as a plain number, like 500 or 500.50.', field: 'discount' });
		}
		if (deliveryFee && !MONEY.test(deliveryFee)) {
			return fail(400, { message: 'Enter the delivery fee as a plain number, like 2000.', field: 'deliveryFee' });
		}

		const deliveryDateRaw = String(data.get('deliveryDate') ?? '');

		let orderId: string;
		try {
			const order = await createOrder(
				requireTenant(locals).id,
				{
					customerId,
					conversationId: String(data.get('conversationId') ?? '') || null,
					status: String(data.get('saveAs') ?? 'DRAFT') === 'PENDING_CONFIRMATION' ? 'PENDING_CONFIRMATION' : 'DRAFT',
					source: (String(data.get('source') ?? '') || 'MANUAL') as never,
					discount: discount || undefined,
					deliveryFee: deliveryFee || undefined,
					deliveryMethod: (String(data.get('deliveryMethod') ?? '') || null) as never,
					deliveryLocation: String(data.get('deliveryLocation') ?? '') || null,
					batchId: String(data.get('batchId') ?? '') || null,
					deliveryDate: deliveryDateRaw ? new Date(`${deliveryDateRaw}T12:00:00Z`) : null,
					paymentMethod: String(data.get('paymentMethod') ?? '') || null,
					notes: String(data.get('notes') ?? '') || null,
					items: items.map((i) => ({
						catalogItemId: (i.catalogItemId as string) || null,
						title: String(i.title ?? '').slice(0, 300),
						variant: String(i.variant ?? '').slice(0, 200) || null,
						quantity: Math.max(1, Number(i.quantity ?? 1) || 1),
						unit: String(i.unit ?? '').slice(0, 40) || null,
						unitPrice: /^\d+(\.\d{1,2})?$/.test(String(i.unitPrice ?? '')) ? String(i.unitPrice) : '0'
					}))
				},
				{ userId: locals.user!.id }
			);
			orderId = order.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message, field: '' });
		}
		redirect(303, `/app/orders/${orderId}?created=1`);
	}
};
