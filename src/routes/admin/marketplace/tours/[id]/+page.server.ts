// One listing, as a reviewer needs to see it: the whole thing, plus the five moves the
// platform is allowed to make on it.
//
// The tenant is DERIVED from the tour row and never read from the form. A moderation
// screen that took a tenant id from a request body would let a crafted post move one
// operator's listing while claiming to be another's.
//
// The route is already super-admin guarded by src/routes/admin/+layout.server.ts, which
// is what makes canPublish: true honest here — tours:publish is platform-only and no
// tenant role holds it, so the vendor composer must never pass it.
import { error, fail } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { publicMedia } from '$lib/server/media';
import { assertPublishable, getTourDetail, transitionTour, type TourAction } from '$lib/server/tours';
import type { Actions, PageServerLoad } from './$types';

/**
 * Which of the platform's moves are legal from a given status.
 *
 * transitionTour is the enforcer — this table only decides what to OFFER, so a reviewer
 * is never shown a button whose only outcome is a CONFLICT. The vendor-side steps
 * (submit, archive, restore) are absent because they are the operator's to make.
 */
const PLATFORM_ACTIONS = {
	start_review: ['SUBMITTED'],
	approve: ['SUBMITTED', 'IN_REVIEW'],
	request_changes: ['SUBMITTED', 'IN_REVIEW'],
	publish: ['APPROVED'],
	unpublish: ['PUBLISHED']
} as const satisfies Record<string, readonly schema.Tour['status'][]>;

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'listing id');

/** The listing, read across tenants — the platform is not scoped to one operator. */
async function platformTour(id: string) {
	const rows = await db()
		.select({
			tour: schema.tours,
			tenantName: schema.tenants.name,
			tenantStatus: schema.tenants.status,
			operatorDisplayName: schema.operatorProfiles.displayName,
			operatorSlug: schema.operatorProfiles.slug,
			operatorVerified: schema.operatorProfiles.isVerified,
			country: schema.countries.name,
			reviewerName: schema.users.fullName,
			reviewerEmail: schema.users.email
		})
		.from(schema.tours)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tours.tenantId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.tours.tenantId))
		.leftJoin(schema.countries, eq(schema.countries.id, schema.tours.primaryCountryId))
		.leftJoin(schema.users, eq(schema.users.id, schema.tours.reviewedBy))
		.where(and(eq(schema.tours.id, id), isNull(schema.tours.deletedAt)))
		.limit(1);
	if (!rows[0]) error(404, 'Listing not found');
	return rows[0];
}

export const load: PageServerLoad = async ({ params }) => {
	const id = idOf(params);
	const row = await platformTour(id);
	const tenantId = row.tour.tenantId;

	// The service owns the shape of a listing. Re-querying the children here would be a
	// second definition of "what a tour is", free to drift from the vendor's own view.
	const [{ tour, destinations, itinerary, gallery }, missing] = await Promise.all([
		getTourDetail(tenantId, id),
		// What the operator would still be told to fix. Worth seeing BEFORE approving:
		// a listing can reach the queue and then lose its hero image to a media delete.
		assertPublishable(tenantId, id)
	]);

	// A day may point at a place the listing does not otherwise link, so the names come
	// from the ids actually used rather than from the destination list.
	const dayDestinationIds = [...new Set(itinerary.map((d) => d.destinationId).filter((v): v is string => Boolean(v)))];
	const [heroRows, dayDestinations] = await Promise.all([
		tour.heroMediaId
			? db().select().from(schema.media).where(eq(schema.media.id, tour.heroMediaId)).limit(1)
			: Promise.resolve([]),
		dayDestinationIds.length
			? db()
					.select({ id: schema.destinations.id, name: schema.destinations.name })
					.from(schema.destinations)
					.where(inArray(schema.destinations.id, dayDestinationIds))
			: Promise.resolve([])
	]);
	const placeName = new Map(dayDestinations.map((d) => [d.id, d.name]));

	return {
		// Reshaped on purpose: the raw rows carry tenantId and media.objectKey — the
		// handle that can delete an object — and neither belongs in a page payload.
		listing: {
			id: tour.id,
			title: tour.title,
			slug: tour.slug,
			status: tour.status,
			featured: tour.featured,
			shortDescription: tour.shortDescription,
			description: tour.description,
			durationDays: tour.durationDays,
			durationNights: tour.durationNights,
			priceFrom: tour.priceFrom,
			currency: tour.currency,
			pricingType: tour.pricingType,
			travelStyle: tour.travelStyle,
			groupType: tour.groupType,
			groupSizeMin: tour.groupSizeMin,
			groupSizeMax: tour.groupSizeMax,
			ageRequirement: tour.ageRequirement,
			accommodationSummary: tour.accommodationSummary,
			transportSummary: tour.transportSummary,
			mealsSummary: tour.mealsSummary,
			bestTimeSummary: tour.bestTimeSummary,
			availabilityType: tour.availabilityType,
			availableFrom: tour.availableFrom,
			availableTo: tour.availableTo,
			highlights: tour.highlights,
			included: tour.included,
			excluded: tour.excluded,
			seoTitle: tour.seoTitle,
			seoDescription: tour.seoDescription,
			submittedAt: tour.submittedAt,
			reviewedAt: tour.reviewedAt,
			reviewNote: tour.reviewNote,
			publishedAt: tour.publishedAt,
			createdAt: tour.createdAt,
			updatedAt: tour.updatedAt
		},
		operator: {
			name: row.operatorDisplayName || row.tenantName,
			slug: row.operatorSlug,
			verified: row.operatorVerified ?? false,
			// Surfaced because transitionTour runs assertAllowed first: while the account is
			// suspended EVERY move below fails, unpublish included, and the operator-facing
			// "please contact support" a reviewer would otherwise see explains nothing.
			accountStatus: row.tenantStatus
		},
		country: row.country,
		reviewer: row.tour.reviewedBy ? row.reviewerName || row.reviewerEmail : null,
		destinations: destinations.map((d) => ({ id: d.id, name: d.name, type: d.destinationType })),
		itinerary: itinerary.map((d) => ({
			id: d.id,
			dayNumber: d.dayNumber,
			title: d.title,
			description: d.description,
			destination: d.destinationId ? (placeName.get(d.destinationId) ?? null) : null,
			accommodation: d.accommodation,
			meals: d.meals,
			activities: d.activities,
			distance: d.distance,
			estimatedTravelTime: d.estimatedTravelTime
		})),
		hero: publicMedia(heroRows[0]),
		gallery: gallery.map((asset) => publicMedia(asset)),
		missing,
		offered: (Object.entries(PLATFORM_ACTIONS) as [TourAction, readonly string[]][])
			.filter(([, from]) => from.includes(tour.status))
			.map(([action]) => action)
	};
};

/** Every review step is the same call, differing only in which move it names. */
async function move(params: { id?: string }, locals: App.Locals, action: TourAction, note?: string | null) {
	const id = idOf(params);
	const row = await platformTour(id);
	try {
		// canPublish: true is safe HERE and only here — this route is behind the
		// super-admin guard. The vendor composer calls the same function with it absent,
		// which is what makes tours:publish platform-only rather than a UI convention.
		await transitionTour(row.tour.tenantId, id, action, { userId: locals.user!.id }, { canPublish: true, note });
		return { success: true };
	} catch (err) {
		return fail(400, { message: toAppError(err).message });
	}
}

export const actions: Actions = {
	startReview: ({ locals, params }) => move(params, locals, 'start_review'),

	approve: async ({ locals, params, request }) => {
		const data = await request.formData();
		// An approval note is optional — a reviewer waving something through has nothing
		// to say, and forcing a sentence produces "ok".
		return move(params, locals, 'approve', String(data.get('note') ?? ''));
	},

	requestChanges: async ({ locals, params, request }) => {
		const data = await request.formData();
		const note = String(data.get('note') ?? '').trim();
		// The service refuses an empty note too. Checked again here so the reviewer is
		// told what is wrong before a round trip that could only ever fail.
		if (!note) return fail(400, { message: 'Say what needs to change — the operator sees only this note.' });
		return move(params, locals, 'request_changes', note);
	},

	publish: ({ locals, params }) => move(params, locals, 'publish'),

	unpublish: ({ locals, params }) => move(params, locals, 'unpublish'),

	/**
	 * The featured slot, written straight to the row.
	 *
	 * updateTour deliberately ignores `featured` — a listing that can feature itself is
	 * not a feature, so the field is absent from TourInput and no vendor path can set it.
	 * That leaves nothing in the service to call, and this is the one place where writing
	 * it directly is correct: the decision is editorial, the route is super-admin guarded,
	 * and only the flag is touched. The same three lines in the vendor composer would
	 * hand every operator the marketplace's front page.
	 */
	feature: async ({ locals, params, request }) => {
		const id = idOf(params);
		const row = await platformTour(id);
		const data = await request.formData();
		const featured = String(data.get('featured') ?? '') === 'true';
		try {
			await db()
				.update(schema.tours)
				.set({ featured, updatedAt: new Date() })
				.where(and(eq(schema.tours.id, id), isNull(schema.tours.deletedAt)));
			await audit(
				row.tour.tenantId,
				'tour.updated',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'tour', id },
				{ action: 'featured', featured }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
