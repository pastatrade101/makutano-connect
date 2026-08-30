// Trips for the phone, already grouped and already scored.
//
// The grouping and the readiness verdict are computed HERE, exactly as the portal
// computes them, so the two surfaces cannot disagree about whether a trip can
// leave — and so the app never reimplements a business rule it would then have to
// keep in step through an app-store release.
import type { RequestHandler } from './$types';
import { listTripsWithReadiness } from '$lib/server/trips';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import { nextForTrip } from '$lib/next-action';
import { statusLabel } from '$lib/labels';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import type { Trip } from '$lib/server/db/schema';

const TABS = {
	upcoming: ['PREPARING', 'READY'],
	in_progress: ['IN_PROGRESS'],
	completed: ['COMPLETED', 'CANCELLED']
} as const;

const GROUPS = [
	{ key: 'under_way', label: 'Under way' },
	{ key: 'this_week', label: 'Departing this week' },
	{ key: 'this_month', label: 'Next 30 days' },
	{ key: 'later', label: 'Later' },
	{ key: 'undated', label: 'No dates yet' }
] as const;

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'trips:read');
		const workspace = normalizeWorkspace((event.locals.tenant?.settings as Record<string, unknown>)?.capabilities);
		if (!moduleRelevant(workspace, 'trips')) return ok({ workspace, groups: [], total: 0 });

		const tabKey = (event.url.searchParams.get('tab') ?? 'upcoming') as keyof typeof TABS;
		const tab = TABS[tabKey] ? tabKey : 'upcoming';
		const mine = event.url.searchParams.get('mine') === '1';

		const { rows, total } = await listTripsWithReadiness(
			viewer.tenantId,
			{ status: [...TABS[tab]] as Trip['status'][], operationsUserId: mine ? viewer.userId : undefined },
			{ limit: 50, page: 1, order: 'asc' }
		);

		const ability = {
			trips: true,
			tripsWrite: viewer.permissions.includes('trips:write')
		};

		const day = 86_400_000;
		const now = new Date();
		const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
		const daysOut = (d: Date | null) =>
			d ? Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - midnight) / day) : null;

		const items = rows.map((r) => {
			const days = daysOut(r.trip.startDate);
			const missingCritical = r.readiness?.missing.filter((c) => c.critical).length ?? 0;
			const next = nextForTrip(
				{ id: r.trip.id, status: r.trip.status, missingCritical, daysToDeparture: days },
				ability
			);
			return {
				id: r.trip.id,
				reference: r.trip.tripReference,
				title: r.trip.title,
				status: r.trip.status,
				statusLabel: statusLabel(r.trip.status),
				customer: r.customerName,
				bookingReference: r.bookingReference,
				startDate: r.trip.startDate?.toISOString() ?? null,
				endDate: r.trip.endDate?.toISOString() ?? null,
				guests: r.trip.adults + r.trip.children,
				driver: r.trip.driver,
				vehicle: r.trip.vehicle,
				daysToDeparture: days,
				percent: r.readiness?.percent ?? null,
				canBeReady: r.readiness?.canBeReady ?? null,
				// Worded as what is MISSING, not as the state the check asserts —
				// "still needs driver", never "still needs Driver assigned".
				blocking: r.readiness?.missing.filter((c) => c.critical).map((c) => c.key) ?? [],
				blockingLabels: r.readiness?.missing.filter((c) => c.critical).map((c) => c.label) ?? [],
				// The balance is operational — it decides whether to chase a traveller
				// before they leave. The pricing behind it is not here at all.
				balanceDue: r.money?.balanceDue ?? null,
				currency: r.money?.currency ?? null,
				next: next ? { key: next.key, label: next.label, hint: next.hint ?? null } : null
			};
		});

		const bucket = (n: number | null) => {
			if (n === null) return 'undated';
			if (n < 0) return 'under_way';
			if (n <= 7) return 'this_week';
			if (n <= 30) return 'this_month';
			return 'later';
		};
		const groups = GROUPS.map((g) => ({
			key: g.key,
			label: g.label,
			items: items.filter((i) => bucket(i.daysToDeparture) === g.key)
		})).filter((g) => g.items.length);

		return ok({
			workspace,
			tab,
			mine,
			total,
			groups,
			// The one line the Trips screen leads with, decided server-side so the
			// phone and the portal say the same thing.
			blocked: items.filter((i) => i.canBeReady === false).length,
			leavingSoon: items.filter((i) => i.daysToDeparture !== null && i.daysToDeparture >= 0 && i.daysToDeparture <= 7)
				.length
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
