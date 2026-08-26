import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { bookingRequestStats, listBookingRequests } from '$lib/server/booking-requests';
import { paginationFrom } from '$lib/server/http';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'enquiries'
	);
	requireTenantPermission(locals, 'booking_requests:read');
	const tenantId = requireTenant(locals).id;
	const pagination = paginationFrom(url);

	const status = url.searchParams.get('status');
	const source = url.searchParams.get('source');
	const assignee = url.searchParams.get('assignee');

	const [{ items, total }, stats] = await Promise.all([
		listBookingRequests(tenantId, pagination, {
			status: (status || undefined) as never,
			source: (source || undefined) as never,
			assigneeUserId: assignee || undefined
		}),
		bookingRequestStats(tenantId)
	]);

	return {
		workspaceRelevant,
		items,
		total,
		pagination,
		stats
	};
};
