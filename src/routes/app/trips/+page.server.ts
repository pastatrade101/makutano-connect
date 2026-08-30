import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { blockedTripCount, listTripsWithReadiness, scopeFor } from '$lib/server/trips';
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

	const scope = await scopeFor(tenantId, { userId: locals.user?.id, role: locals.role });
	const filters = {
		status: [...TABS[tab]] as Trip['status'][],
		operationsUserId: mine ? locals.user?.id : undefined,
		scope
	};
	// tripStats was fetched here and rendered nowhere — a full-history aggregate
	// on every page load for a value nothing read.
	const [{ rows, total }, counts] = await Promise.all([
		listTripsWithReadiness(tenantId, filters, pagination),
		blockedTripCount(tenantId, filters)
	]);

	// Grouped by WHEN, because that is how an operations day is ordered — not by
	// when a trip happened to be created. The buckets are computed on the server so
	// the phone can reuse exactly these when it gets a Trips screen.
	const day = 86_400_000;
	const now = new Date();
	const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const daysOut = (d: Date | null) =>
		d ? Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - midnight) / day) : null;

	const withTiming = rows.map((r) => ({ ...r, daysToDeparture: daysOut(r.trip.startDate) }));
	const bucketOf = (n: number | null) => {
		if (n === null) return 'undated';
		if (n < 0) return 'under_way';
		if (n <= 7) return 'this_week';
		if (n <= 30) return 'this_month';
		return 'later';
	};
	const ORDER = ['under_way', 'this_week', 'this_month', 'later', 'undated'] as const;
	const LABEL: Record<string, string> = {
		under_way: 'Under way',
		this_week: 'Departing this week',
		this_month: 'Next 30 days',
		later: 'Later',
		undated: 'No dates yet'
	};
	const groups = ORDER.map((key) => ({
		key,
		label: LABEL[key],
		rows: withTiming.filter((r) => bucketOf(r.daysToDeparture) === key)
	})).filter((g) => g.rows.length);

	// Counted across the whole tenant, not the rows on screen. Deriving it from
	// the page made the header understate the problem the moment there was a
	// second page — and understate it in the reassuring direction.
	return { workspaceRelevant, groups, total, pagination, tab, mine, ...counts };
};
