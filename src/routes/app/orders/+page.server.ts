import { requirePermission } from '$lib/server/auth/permissions';
import { listOrders, orderStats } from '$lib/server/orders';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'orders:read');
	const pagination = paginationFrom(url);
	const status = url.searchParams.get('status');
	const payment = url.searchParams.get('payment');
	const source = url.searchParams.get('source');
	const [{ items, total }, stats] = await Promise.all([
		listOrders(locals.tenant!.id, pagination, {
			status: (status || undefined) as never,
			paymentStatus: payment === 'unpaid' ? undefined : ((payment || undefined) as never),
			source: (source || undefined) as never
		}),
		orderStats(locals.tenant!.id)
	]);
	const filtered = payment === 'unpaid' ? items.filter((r) => r.order.paymentStatus === 'UNPAID' || r.order.paymentStatus === 'PARTIALLY_PAID') : items;
	return { items: filtered, total, pagination, stats };
};
