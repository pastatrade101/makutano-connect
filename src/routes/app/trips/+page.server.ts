import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listTripsWithReadiness, tripStats } from '$lib/server/trips';
import { paginationFrom } from '$lib/server/http';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { PageServerLoad } from './$types';
import type { Trip } from '$lib/server/db/schema';

const TABS = {
	upcoming: ['PREPARING', 'READY'],
	in_progress: ['IN_PROGRESS'],
	completed: ['COMPLETED', 'CANCELLED']
} as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'trips'
	);
	requireTenantPermission(locals, 'trips:read');
	const tenantId = requireTenant(locals).id;
	const pagination = paginationFrom(url);

	const tabKey = (url.searchParams.get('tab') ?? 'upcoming') as keyof typeof TABS;
	const tab = TABS[tabKey] ? tabKey : 'upcoming';

	// "Mine" is the operations person's default view of their own day. It is a
	// filter rather than a separate page because the same list, differently
	// scoped, is exactly what both an owner and an ops person need.
	const mine = url.searchParams.get('mine') === '1';

	const [{ rows, total }, stats] = await Promise.all([
		listTripsWithReadiness(
			tenantId,
			{
				status: [...TABS[tab]] as Trip['status'][],
				operationsUserId: mine ? locals.user?.id : undefined
			},
			pagination
		),
		tripStats(tenantId)
	]);

	return { workspaceRelevant, rows, total, pagination, stats, tab, mine };
};
