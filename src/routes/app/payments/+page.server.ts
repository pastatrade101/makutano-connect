import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listPayments, paymentStats } from '$lib/server/payments';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'payments:read');
	const pagination = paginationFrom(url);
	const [{ items, total }, stats] = await Promise.all([
		listPayments(requireTenant(locals).id, pagination, { status: (url.searchParams.get('status') || undefined) as never }),
		paymentStats(requireTenant(locals).id)
	]);
	return { items, total, pagination, stats };
};
