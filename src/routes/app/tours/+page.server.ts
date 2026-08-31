// The vendor's own marketplace listings.
//
// Reading and writing a listing is sales work, so this page needs nothing beyond
// tours:read / tours:write. Everything on the moderation side — approve, publish,
// request changes — is deliberately absent: tours:publish is not held by any tenant
// role, and a screen that renders a button nobody can press only teaches people that
// the product is broken.
import { fail, redirect } from '@sveltejs/kit';
import { and, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { db, schema } from '$lib/server/db';
import { createTour, listTours } from '$lib/server/tours';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import type { Tour } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

/**
 * The filters, in the order the lifecycle runs.
 *
 * SUBMITTED and IN_REVIEW share one filter on purpose. They are two states of the
 * same fact for the operator — it is with the marketplace team, not with you — and
 * splitting them would give a vendor a chip whose meaning depends on whether a
 * reviewer has opened the listing yet.
 */
const FILTERS: Record<string, Tour['status'][]> = {
	DRAFT: ['DRAFT'],
	SUBMITTED: ['SUBMITTED', 'IN_REVIEW'],
	CHANGES_REQUESTED: ['CHANGES_REQUESTED'],
	APPROVED: ['APPROVED'],
	PUBLISHED: ['PUBLISHED'],
	UNPUBLISHED: ['UNPUBLISHED'],
	ARCHIVED: ['ARCHIVED']
};

/**
 * How many listings sit in each status.
 *
 * One grouped count rather than eight calls to listTours, which would each also fetch
 * a page of rows nobody renders. The title/slug match is the same one listTours runs,
 * repeated here rather than exported because the numbers have to move with the table:
 * a chip reading "Draft 6" above four rows is the page contradicting itself.
 */
async function countByStatus(tenantId: string, search: string | undefined): Promise<Map<string, number>> {
	const conditions: SQL[] = [eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)];
	if (search) {
		conditions.push(or(ilike(schema.tours.title, `%${search}%`), ilike(schema.tours.slug, `%${search}%`)) as SQL);
	}
	const rows = await db()
		.select({ status: schema.tours.status, value: count() })
		.from(schema.tours)
		.where(and(...conditions))
		.groupBy(schema.tours.status);
	return new Map(rows.map((r) => [r.status as string, Number(r.value)]));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'tours:read');
	const tenantId = requireTenant(locals).id;
	const pagination = paginationFrom(url);

	// An unknown value in the query string is treated as no filter rather than as an
	// empty status list, which listTours would read as "match nothing".
	const requested = url.searchParams.get('status') ?? '';
	const status = requested in FILTERS ? requested : '';

	// listTours already falls back to pagination.q, so the search box is just `q`.
	const [{ items, total }, byStatus] = await Promise.all([
		listTours(tenantId, pagination, { status: status ? FILTERS[status] : undefined }),
		countByStatus(tenantId, pagination.q)
	]);

	// A number per chip, so "how much of my work is waiting on the marketplace team"
	// is answered before anything is clicked. Every status the table can hold belongs
	// to exactly one filter, so summing the filters is also the count for "All".
	const counts: Record<string, number> = { '': 0 };
	for (const [key, statuses] of Object.entries(FILTERS)) {
		counts[key] = statuses.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0);
		counts[''] += counts[key];
	}

	return {
		items,
		total,
		pagination,
		status,
		counts,
		filters: Object.keys(FILTERS),
		canWrite: locals.permissions.includes('tours:write')
	};
};

export const actions: Actions = {
	/** A new listing starts as a DRAFT with nothing but a title, and opens straight
	 *  into the composer — an empty row in a list is not somewhere to start writing. */
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const data = await request.formData();
		const title = String(data.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'Give the listing a working title — you can change it later.' });

		const tenantId = requireTenant(locals).id;
		let id: string;
		try {
			const tour = await createTour(tenantId, { title }, { userId: locals.user?.id });
			id = tour.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		// Outside the catch: redirect() signals by throwing, and swallowing it there
		// would turn a listing that was created into "Could not save".
		redirect(303, `/app/tours/${id}`);
	}
};
