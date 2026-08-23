import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { listCatalogItems } from '$lib/server/catalog';
import { getConversation } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { createOrder } from '$lib/server/orders';
import { eq, and, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'orders:write');
	const tenantId = locals.tenant!.id;

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
				customerName: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conv.externalId ?? ''}`,
				phone: customer?.whatsappPhone ?? conv.externalId
			};
		} catch {
			conversation = null;
		}
	}

	const [{ items: catalog }, recentCustomers] = await Promise.all([
		listCatalogItems(tenantId, { page: 1, limit: 100, order: 'desc' }, { activeOnly: true }),
		db()
			.select({ id: schema.customers.id, firstName: schema.customers.firstName, lastName: schema.customers.lastName, whatsappPhone: schema.customers.whatsappPhone })
			.from(schema.customers)
			.where(and(eq(schema.customers.tenantId, tenantId)))
			.orderBy(desc(schema.customers.createdAt))
			.limit(50)
	]);

	return {
		conversation,
		catalog: catalog.map((c) => ({ id: c.id, name: c.name, price: c.price, currency: c.currency, variants: c.variants })),
		customers: recentCustomers
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const data = await request.formData();
		let items: Array<Record<string, unknown>>;
		try {
			items = JSON.parse(String(data.get('items') ?? '[]'));
		} catch {
			return fail(400, { message: 'Order items are malformed.' });
		}
		if (!Array.isArray(items) || items.length === 0) return fail(400, { message: 'Add at least one item.' });

		let orderId: string;
		try {
			const order = await createOrder(
				locals.tenant!.id,
				{
					customerId: String(data.get('customerId') ?? '') || null,
					conversationId: String(data.get('conversationId') ?? '') || null,
					status: String(data.get('saveAs') ?? 'DRAFT') === 'PENDING_CONFIRMATION' ? 'PENDING_CONFIRMATION' : 'DRAFT',
					source: (String(data.get('source') ?? '') || 'MANUAL') as never,
					discount: String(data.get('discount') ?? '') || undefined,
					deliveryFee: String(data.get('deliveryFee') ?? '') || undefined,
					deliveryMethod: (String(data.get('deliveryMethod') ?? '') || null) as never,
					deliveryLocation: String(data.get('deliveryLocation') ?? '') || null,
					notes: String(data.get('notes') ?? '') || null,
					items: items.map((i) => ({
						catalogItemId: (i.catalogItemId as string) || null,
						title: String(i.title ?? '').slice(0, 300),
						variant: String(i.variant ?? '').slice(0, 200) || null,
						quantity: Math.max(1, Number(i.quantity ?? 1) || 1),
						unitPrice: /^\d+(\.\d{1,2})?$/.test(String(i.unitPrice ?? '')) ? String(i.unitPrice) : '0'
					}))
				},
				{ userId: locals.user!.id }
			);
			orderId = order.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, `/app/orders/${orderId}`);
	}
};
