// The platform's moderation queue: every operator's listings in one list.
//
// Deliberately NOT listTours() — that function is tenant-scoped, which is exactly right
// for the vendor's own list and exactly wrong here. A queue that can only see one tenant
// at a time is not a queue, so this reads schema.tours directly and joins the operator on.
//
// The route is super-admin guarded in hooks.server.ts (a layout `load` does not protect
// a form action — SvelteKit runs actions first; see docs/PROJECTS.md).
import { fail } from '@sveltejs/kit';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { offsetOf, paginationFrom } from '$lib/server/http';
import { toAppError } from '$lib/server/errors';
import { platformActionsFor, transitionTour, type TourAction } from '$lib/server/tours';
import type { Actions, PageServerLoad } from './$types';

/**
 * The queue's five views.
 *
 * Pending review holds both SUBMITTED and IN_REVIEW on purpose: a listing somebody
 * started reading is still waiting on the platform, and hiding it in its own tab is how
 * a half-reviewed listing sits there for a week.
 */
const TABS = {
	pending: { label: 'Pending review', status: ['SUBMITTED', 'IN_REVIEW'] },
	changes: { label: 'Changes requested', status: ['CHANGES_REQUESTED'] },
	approved: { label: 'Approved', status: ['APPROVED'] },
	published: { label: 'Published', status: ['PUBLISHED'] },
	unpublished: { label: 'Unpublished', status: ['UNPUBLISHED'] }
} as const satisfies Record<string, { label: string; status: readonly schema.Tour['status'][] }>;

type TabKey = keyof typeof TABS;

/**
 * How long a listing has been waiting, as presets rather than a date picker.
 *
 * The whole queue spans a couple of days, so a two-ended calendar would be
 * theatre. These map onto the partial index on submitted_at.
 */
const WAITING = {
	'24h': 24,
	'3d': 72,
	'7d': 168
} as const;

export const load: PageServerLoad = async ({ url }) => {
	const pagination = paginationFrom(url);
	const requested = url.searchParams.get('tab') ?? '';
	const tab: TabKey = requested in TABS ? (requested as TabKey) : 'pending';
	const operator = url.searchParams.get('operator') ?? '';
	const waiting = url.searchParams.get('waiting') ?? '';

	const conditions: SQL[] = [isNull(schema.tours.deletedAt), inArray(schema.tours.status, [...TABS[tab].status])];
	// One box over the two things a reviewer actually remembers: the listing or who sent it.
	if (pagination.q) {
		conditions.push(
			or(ilike(schema.tours.title, `%${pagination.q}%`), ilike(schema.tenants.name, `%${pagination.q}%`)) as SQL
		);
	}
	// Keyed on the tenant id, never the name: two tenants in this database differ
	// only by capitalisation, and a name filter would silently merge them.
	if (operator) conditions.push(eq(schema.tours.tenantId, operator));
	if (waiting in WAITING) {
		const cutoff = new Date(Date.now() - WAITING[waiting as keyof typeof WAITING] * 3600_000);
		conditions.push(lte(schema.tours.submittedAt, cutoff));
	}
	const where = and(...conditions);

	// Readiness, counted set-wise. assertPublishable is per-tour and does three
	// queries; twenty-five rows would be seventy-five. These two counts plus the
	// columns cover every gap that makes a listing unpublishable.
	const dayCount = sql<number>`(select count(*) from tour_itinerary_days d where d.tour_id = ${schema.tours.id})::int`;
	const destinationCount = sql<number>`(select count(*) from tour_destinations td where td.tour_id = ${schema.tours.id})::int`;

	const heroMedia = schema.media;
	const rowsQuery = db()
		.select({
			id: schema.tours.id,
			title: schema.tours.title,
			status: schema.tours.status,
			featured: schema.tours.featured,
			submittedAt: schema.tours.submittedAt,
			updatedAt: schema.tours.updatedAt,
			durationDays: schema.tours.durationDays,
			priceFrom: schema.tours.priceFrom,
			currency: schema.tours.currency,
			heroUrl: heroMedia.url,
			// The public name of the business, falling back to the account name for an
			// operator who has not written a profile yet.
			operator: schema.tenants.name,
			operatorDisplayName: schema.operatorProfiles.displayName,
			tenantId: schema.tours.tenantId,
			// Surfaced because assertAllowed is the first thing transitionTour does: on a
			// suspended or cancelled account EVERY action below fails, and a reviewer
			// should see that before selecting the row rather than after.
			accountStatus: schema.tenants.status,
			reviewer: schema.users.fullName,
			dayCount,
			destinationCount,
			hasCategory: sql<boolean>`${schema.tours.primaryCategoryId} is not null`,
			hasCountry: sql<boolean>`${schema.tours.primaryCountryId} is not null`
		})
		.from(schema.tours)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tours.tenantId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.tours.tenantId))
		.leftJoin(heroMedia, eq(heroMedia.id, schema.tours.heroMediaId))
		.leftJoin(schema.users, eq(schema.users.id, schema.tours.reviewedBy))
		.where(where)
		// Oldest submission first while a listing is waiting on us — a review queue sorted
		// newest-first is how the operator who submitted on Monday is still waiting on Friday.
		// Everywhere else the last thing touched is the interesting one.
		.orderBy(tab === 'pending' ? asc(schema.tours.submittedAt) : desc(schema.tours.updatedAt))
		.limit(pagination.limit)
		.offset(offsetOf(pagination));

	const [rows, [{ value: total }], statusCounts, operators] = await Promise.all([
		rowsQuery,
		db()
			.select({ value: count() })
			.from(schema.tours)
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tours.tenantId))
			.where(where),
		// Counted across the whole marketplace rather than the page, so the tab badge says
		// how much work there is and not how much of it happens to be on screen.
		db()
			.select({ status: schema.tours.status, value: count() })
			.from(schema.tours)
			.where(isNull(schema.tours.deletedAt))
			.groupBy(schema.tours.status),
		// Options built from the rows in THIS tab, not from the tenants table: eight
		// tenants exist, most have nothing here, and a dropdown of empty choices is
		// worse than no dropdown.
		db()
			.selectDistinct({ id: schema.tenants.id, name: schema.tenants.name })
			.from(schema.tours)
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tours.tenantId))
			.where(and(isNull(schema.tours.deletedAt), inArray(schema.tours.status, [...TABS[tab].status])))
			.orderBy(schema.tenants.name)
	]);

	// Destinations as ONE side query keyed by the page's ids. Joining them onto the
	// main query would multiply a row per destination and corrupt the count above.
	const ids = rows.map((r) => r.id);
	const places = ids.length
		? await db()
				.select({ tourId: schema.tourDestinations.tourId, name: schema.destinations.name })
				.from(schema.tourDestinations)
				.innerJoin(schema.destinations, eq(schema.destinations.id, schema.tourDestinations.destinationId))
				.where(inArray(schema.tourDestinations.tourId, ids))
		: [];
	const placesByTour = new Map<string, string[]>();
	for (const p of places) placesByTour.set(p.tourId, [...(placesByTour.get(p.tourId) ?? []), p.name]);

	const byStatus = new Map(statusCounts.map((c) => [c.status, Number(c.value)]));
	const tabs = (Object.keys(TABS) as TabKey[]).map((key) => ({
		key,
		label: TABS[key].label,
		count: TABS[key].status.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0)
	}));

	return {
		rows: rows.map(({ operatorDisplayName, operator: name, dayCount, destinationCount, hasCategory, hasCountry, ...r }) => ({
			...r,
			operator: operatorDisplayName || name,
			destinations: placesByTour.get(r.id) ?? [],
			// What the operator would still be told to fix. Rendered only when non-empty,
			// and the reason bulk publish refuses a row.
			gaps: [
				!r.heroUrl && 'a main photo',
				Number(dayCount) < 1 && 'an itinerary',
				Number(destinationCount) < 1 && 'a destination',
				!hasCategory && 'a category',
				!hasCountry && 'a country',
				!r.priceFrom && 'a price'
			].filter((v): v is string => typeof v === 'string'),
			// The listing you half-reviewed yesterday is not the one on screen now.
			editedSinceSubmitted: Boolean(r.submittedAt && r.updatedAt && r.updatedAt > r.submittedAt),
			actions: platformActionsFor(r.status)
		})),
		tabs,
		tab,
		q: pagination.q ?? '',
		operator,
		waiting,
		operators,
		waitingOptions: Object.keys(WAITING),
		total: Number(total),
		pagination
	};
};

/** The moves a reviewer may make on many listings at once. */
const BULK_ACTIONS = new Set<TourAction>(['start_review', 'approve', 'request_changes', 'publish', 'unpublish']);

export const actions: Actions = {
	/**
	 * One action, many listings — applied per row, never as one transaction.
	 *
	 * All-or-nothing would be wrong here: fifteen listings from one operator are
	 * fifteen independent decisions, and rolling back twelve good approvals because
	 * the thirteenth belongs to a suspended account helps nobody. So each row is
	 * attempted, and the ones that failed are NAMED — a reviewer who selected
	 * fifteen and moved twelve must be told which three did not, or the queue has
	 * quietly lied to them.
	 *
	 * Legality is recomputed here from the row's CURRENT status. The buttons the
	 * page offered are a hint; the listing may have moved since it rendered, and
	 * transitionTour re-checks again underneath this.
	 */
	bulk: async ({ locals, request }) => {
		const data = await request.formData();
		const action = String(data.get('action') ?? '') as TourAction;
		const ids = data.getAll('ids').map(String).filter(Boolean);
		const note = String(data.get('note') ?? '').trim();

		if (!BULK_ACTIONS.has(action)) return fail(400, { message: 'That is not a review action.' });
		if (!ids.length) return fail(400, { message: 'Select at least one listing first.' });
		if (ids.length > 100) return fail(400, { message: 'Too many at once — filter the list down first.' });

		const rows = await db()
			.select({ id: schema.tours.id, title: schema.tours.title, status: schema.tours.status, tenantId: schema.tours.tenantId })
			.from(schema.tours)
			.where(and(inArray(schema.tours.id, ids), isNull(schema.tours.deletedAt)));

		/*
		 * A shared note across two operators is a form letter.
		 *
		 * The note is the ONLY thing the operator sees, and a sentence vague enough
		 * to be true of two different companies' listings tells neither of them what
		 * to fix. Refused server-side rather than merely hidden in the UI.
		 */
		if (action === 'request_changes') {
			if (!note) return fail(400, { message: 'Say what needs to change — the operator sees only this note.' });
			if (new Set(rows.map((r) => r.tenantId)).size > 1) {
				return fail(400, {
					message: 'Asking for changes writes one note to every listing you picked, so keep it to a single operator.'
				});
			}
		}

		const moved: string[] = [];
		const failures: { title: string; reason: string }[] = [];

		for (const row of rows) {
			if (!platformActionsFor(row.status).includes(action)) {
				failures.push({ title: row.title, reason: `is ${row.status.toLowerCase().replace('_', ' ')}` });
				continue;
			}
			try {
				await transitionTour(row.tenantId, row.id, action, { userId: locals.user!.id }, { canPublish: true, note: note || null });
				moved.push(row.title);
			} catch (err) {
				failures.push({ title: row.title, reason: toAppError(err).message });
			}
		}

		return { bulk: { action, moved: moved.length, failures } };
	}
};
