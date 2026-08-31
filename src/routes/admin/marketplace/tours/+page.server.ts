// The platform's moderation queue: every operator's listings in one list.
//
// Deliberately NOT listTours() — that function is tenant-scoped, which is exactly right
// for the vendor's own list and exactly wrong here. A queue that can only see one tenant
// at a time is not a queue, so this reads schema.tours directly and joins the operator on.
//
// The route is already super-admin guarded by src/routes/admin/+layout.server.ts.
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { offsetOf, paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

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

export const load: PageServerLoad = async ({ url }) => {
	const pagination = paginationFrom(url);
	const requested = url.searchParams.get('tab') ?? '';
	const tab: TabKey = requested in TABS ? (requested as TabKey) : 'pending';

	const conditions: SQL[] = [isNull(schema.tours.deletedAt), inArray(schema.tours.status, [...TABS[tab].status])];
	// One box over the two things a reviewer actually remembers: the listing or who sent it.
	if (pagination.q) {
		conditions.push(
			or(ilike(schema.tours.title, `%${pagination.q}%`), ilike(schema.tenants.name, `%${pagination.q}%`)) as SQL
		);
	}
	const where = and(...conditions);

	const rowsQuery = db()
		.select({
			id: schema.tours.id,
			title: schema.tours.title,
			status: schema.tours.status,
			featured: schema.tours.featured,
			submittedAt: schema.tours.submittedAt,
			updatedAt: schema.tours.updatedAt,
			// The public name of the business, falling back to the account name for an
			// operator who has not written a profile yet. The tenant id stays server-side.
			operator: schema.tenants.name,
			operatorDisplayName: schema.operatorProfiles.displayName,
			country: schema.countries.name
		})
		.from(schema.tours)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tours.tenantId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.tours.tenantId))
		.leftJoin(schema.countries, eq(schema.countries.id, schema.tours.primaryCountryId))
		.where(where)
		// Oldest submission first while a listing is waiting on us — a review queue sorted
		// newest-first is how the operator who submitted on Monday is still waiting on Friday.
		// Everywhere else the last thing touched is the interesting one.
		.orderBy(tab === 'pending' ? asc(schema.tours.submittedAt) : desc(schema.tours.updatedAt))
		.limit(pagination.limit)
		.offset(offsetOf(pagination));

	const [rows, [{ value: total }], statusCounts] = await Promise.all([
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
			.groupBy(schema.tours.status)
	]);

	const byStatus = new Map(statusCounts.map((c) => [c.status, Number(c.value)]));
	const tabs = (Object.keys(TABS) as TabKey[]).map((key) => ({
		key,
		label: TABS[key].label,
		count: TABS[key].status.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0)
	}));

	return {
		rows: rows.map(({ operatorDisplayName, operator, ...r }) => ({ ...r, operator: operatorDisplayName || operator })),
		tabs,
		tab,
		q: pagination.q ?? '',
		total: Number(total),
		pagination
	};
};
