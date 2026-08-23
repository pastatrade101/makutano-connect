import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listOrders, orderStats } from '$lib/server/orders';
import { paginationFrom } from '$lib/server/http';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'orders'
	);
	requireTenantPermission(locals, 'orders:read');
	const pagination = paginationFrom(url);
	const status = url.searchParams.get('status');
	const payment = url.searchParams.get('payment');
	const source = url.searchParams.get('source');
	const [{ items, total }, stats] = await Promise.all([
		listOrders(requireTenant(locals).id, pagination, {
			status: (status || undefined) as never,
			paymentStatus: payment === 'unpaid' ? undefined : ((payment || undefined) as never),
			source: (source || undefined) as never
		}),
		orderStats(requireTenant(locals).id)
	]);
	const filtered = payment === 'unpaid' ? items.filter((r) => r.order.paymentStatus === 'UNPAID' || r.order.paymentStatus === 'PARTIALLY_PAID') : items;
	return {
		workspaceRelevant, items: filtered, total, pagination, stats };
};
