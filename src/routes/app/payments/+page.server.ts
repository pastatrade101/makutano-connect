import { requirePermission } from '$lib/server/auth/permissions';
import { listPayments, paymentStats } from '$lib/server/payments';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'payments:read');
	const pagination = paginationFrom(url);
	const [{ items, total }, stats] = await Promise.all([
		listPayments(locals.tenant!.id, pagination, { status: (url.searchParams.get('status') || undefined) as never }),
		paymentStats(locals.tenant!.id)
	]);
	return { items, total, pagination, stats };
};
