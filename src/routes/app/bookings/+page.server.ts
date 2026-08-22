import { requirePermission } from '$lib/server/auth/permissions';
import { bookingStats, listBookings } from '$lib/server/bookings';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'bookings:read');
	const pagination = paginationFrom(url);
	const [{ items, total }, stats] = await Promise.all([
		listBookings(locals.tenant!.id, pagination, {
			status: (url.searchParams.get('status') || undefined) as never,
			unpaid: url.searchParams.get('payment') === 'unpaid'
		}),
		bookingStats(locals.tenant!.id)
	]);
	return { items, total, pagination, stats };
};
