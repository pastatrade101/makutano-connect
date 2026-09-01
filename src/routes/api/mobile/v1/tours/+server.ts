// The operator's own listings, as they stand on the marketplace.
//
// This is the phone's answer to "what have I got up there?" — the thing an
// operator on a marketplace product actually opens the app to see, and the one
// part of their business the app could not show at all until now.
//
// Read-only on purpose. Building a tour is a long, media-heavy job that belongs
// in the portal; what the phone owes an operator is the STATE of the shopfront —
// what is live, what is stuck waiting for review, what was sent back — and a
// link to the real page a traveller would see.
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '$lib/server/db';
import { env } from '$lib/server/env';
import { groupTypeLabel } from '$lib/tour-options';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import type { RequestHandler } from './$types';

/**
 * The order an operator cares about, which is not the order the enum is in:
 * what is live, then what is waiting on somebody else, then what is waiting on
 * them, then the rest.
 */
const RANK: Record<string, number> = {
	PUBLISHED: 0,
	CHANGES_REQUESTED: 1,
	IN_REVIEW: 2,
	SUBMITTED: 3,
	APPROVED: 4,
	DRAFT: 5,
	UNPUBLISHED: 6,
	ARCHIVED: 7
};

/** Said the way an operator would say it, not the way the column spells it. */
const STATE: Record<string, { label: string; tone: 'live' | 'waiting' | 'action' | 'quiet' }> = {
	PUBLISHED: { label: 'Live', tone: 'live' },
	APPROVED: { label: 'Approved · not live yet', tone: 'waiting' },
	SUBMITTED: { label: 'Waiting for review', tone: 'waiting' },
	IN_REVIEW: { label: 'Being reviewed', tone: 'waiting' },
	CHANGES_REQUESTED: { label: 'Changes requested', tone: 'action' },
	DRAFT: { label: 'Draft', tone: 'action' },
	UNPUBLISHED: { label: 'Taken down', tone: 'quiet' },
	ARCHIVED: { label: 'Archived', tone: 'quiet' }
};

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'tours:read');

		const hero = alias(schema.media, 'mobile_tour_hero');
		const rows = await db()
			.select({
				id: schema.tours.id,
				title: schema.tours.title,
				slug: schema.tours.slug,
				status: schema.tours.status,
				priceFrom: schema.tours.priceFrom,
				currency: schema.tours.currency,
				pricingType: schema.tours.pricingType,
				durationDays: schema.tours.durationDays,
				durationNights: schema.tours.durationNights,
				groupType: schema.tours.groupType,
				featured: schema.tours.featured,
				publishedAt: schema.tours.publishedAt,
				updatedAt: schema.tours.updatedAt,
				heroUrl: hero.url,
				heroAlt: hero.altText,
				// Where the trip goes, for the line under the title. The country
				// rather than a destination list: one place name a card can hold.
				country: schema.countries.name
			})
			.from(schema.tours)
			.leftJoin(hero, eq(hero.id, schema.tours.heroMediaId))
			.leftJoin(schema.countries, eq(schema.countries.id, schema.tours.primaryCountryId))
			.where(and(eq(schema.tours.tenantId, viewer.tenantId), isNull(schema.tours.deletedAt)))
			.orderBy(desc(schema.tours.updatedAt))
			.limit(60);

		/*
		 * The tour's own travel style, from the link table.
		 *
		 * NOT tours.travel_style, which is deprecated free text — the whole reason
		 * the link table exists is that "Luxury", "luxury" and "Luxury Safari"
		 * become three filters that each find a third of the inventory. One
		 * grouped query, first style by sort order, rather than a query per card.
		 */
		const tourIds = rows.map((r) => r.id);
		const styleRows = tourIds.length
			? await db()
					.select({
						tourId: schema.tourTravelStyles.tourId,
						name: schema.travelStyles.name,
						sortOrder: schema.tourTravelStyles.sortOrder
					})
					.from(schema.tourTravelStyles)
					.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
					.where(inArray(schema.tourTravelStyles.tourId, tourIds))
					.orderBy(asc(schema.tourTravelStyles.sortOrder))
			: [];
		const styleByTour = new Map<string, string>();
		for (const row of styleRows) {
			if (!styleByTour.has(row.tourId)) styleByTour.set(row.tourId, row.name);
		}

		// Enquiries per tour, so a listing can say whether it is actually working.
		// One grouped query rather than one per card.
		const enquiryRows = await db()
			.select({ tourId: schema.bookingRequests.tourId, value: count() })
			.from(schema.bookingRequests)
			.where(and(eq(schema.bookingRequests.tenantId, viewer.tenantId), isNull(schema.bookingRequests.deletedAt)))
			.groupBy(schema.bookingRequests.tourId);
		const enquiriesByTour = new Map(enquiryRows.map((r) => [r.tourId, Number(r.value)]));

		const marketplace = env().MARKETPLACE_URL.replace(/\/+$/, '');
		const items = rows
			.map((row) => ({
				id: row.id,
				title: row.title,
				slug: row.slug,
				status: row.status,
				state: STATE[row.status]?.label ?? row.status,
				tone: STATE[row.status]?.tone ?? 'quiet',
				priceFrom: row.priceFrom,
				currency: row.currency,
				pricingType: row.pricingType,
				durationDays: row.durationDays,
				durationNights: row.durationNights,
				country: row.country,
				// "Private tour" reads as a chip; PRIVATE does not.
				groupType: row.groupType ? groupTypeLabel(row.groupType) : null,
				style: styleByTour.get(row.id) ?? null,
				featured: row.featured,
				publishedAt: row.publishedAt,
				updatedAt: row.updatedAt,
				hero: row.heroUrl ? { url: row.heroUrl, altText: row.heroAlt } : null,
				enquiries: enquiriesByTour.get(row.id) ?? 0,
				// Only a PUBLISHED tour has a page a traveller can open. Handing back
				// a URL for anything else would offer the operator a 404.
				publicUrl: row.status === 'PUBLISHED' ? `${marketplace}/tours/${row.slug}` : null
			}))
			.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.title.localeCompare(b.title));

		return ok({
			items,
			summary: {
				total: items.length,
				live: items.filter((t) => t.status === 'PUBLISHED').length,
				// What somebody else owes them, and what they owe the marketplace —
				// two different kinds of waiting, and only one of them is theirs to fix.
				waiting: items.filter((t) => ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(t.status)).length,
				needsYou: items.filter((t) => ['CHANGES_REQUESTED', 'DRAFT'].includes(t.status)).length
			},
			marketplaceUrl: marketplace
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
