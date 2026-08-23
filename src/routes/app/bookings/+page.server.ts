import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { bookingStats, listBookings } from '$lib/server/bookings';
import { paginationFrom } from '$lib/server/http';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'bookings'
	);
	requireTenantPermission(locals, 'bookings:read');
	const pagination = paginationFrom(url);
	const [{ items, total }, stats] = await Promise.all([
		listBookings(requireTenant(locals).id, pagination, {
			status: (url.searchParams.get('status') || undefined) as never,
			unpaid: url.searchParams.get('payment') === 'unpaid'
		}),
		bookingStats(requireTenant(locals).id)
	]);
	return {
		workspaceRelevant, items, total, pagination, stats };
};
