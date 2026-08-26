// Order Batches: one selling round, many customers (§7). List + create.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { COMMON_UNITS, createBatch, listBatches } from '$lib/server/order-batches';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'orders'
	);
	requireTenantPermission(locals, 'orders:read');
	const tenantId = requireTenant(locals).id;
	const status = url.searchParams.get('status');
	const { items, total } = await listBatches(tenantId, paginationFrom(url), {
		status: (status === 'OPEN' || status === 'CLOSED' ? status : undefined) as never
	});
	const canWrite = locals.permissions?.includes('orders:write') ?? false;
	return {
		canWrite,
		workspaceRelevant,
		batches: items.map((r) => ({ ...r.batch, orders: r.orders, revenue: r.revenue })),
		total,
		status: status ?? '',
		units: COMMON_UNITS
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const data = await request.formData();
		const price = String(data.get('unitPrice') ?? '').replace(/[, ]/g, '');
		if (price && !/^\d+(\.\d{1,2})?$/.test(price)) return fail(400, { message: 'Enter a valid unit price.' });
		const dateRaw = String(data.get('fulfilmentDate') ?? '');

		let batchId: string;
		try {
			const batch = await createBatch(
				requireTenant(locals).id,
				{
					name: String(data.get('name') ?? ''),
					description: String(data.get('description') ?? '') || null,
					fulfilmentDate: dateRaw ? new Date(`${dateRaw}T12:00:00Z`) : null,
					defaultItemTitle: String(data.get('itemTitle') ?? ''),
					defaultUnit: String(data.get('unit') ?? '') || null,
					defaultUnitPrice: price || '0',
					defaultDeliveryMethod: (String(data.get('deliveryMethod') ?? '') || null) as never
				},
				{ userId: locals.user!.id }
			);
			batchId = batch.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, `/app/orders/batches/${batchId}`);
	}
};
