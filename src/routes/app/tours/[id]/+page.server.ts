// The tour composer — one page, six steps, one action per step.
//
// Every rule lives in $lib/server/tours and $lib/server/media; this file only turns
// form fields into the shapes those services already validate. Two things it does
// enforce on its own, because they are route concerns:
//
//   1. `canPublish: false`, always. tours:publish is held by no tenant role, so the
//      four platform transitions are refused BY NAME here rather than being allowed
//      to reach transitionTour and be refused there — a vendor asking to approve
//      their own listing deserves a sentence, not a 403.
//   2. media rows are projected through publicMedia before they leave: objectKey is
//      the handle that can destroy an object in the bucket.
import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { db, schema } from '$lib/server/db';
import { MAX_BYTES, deleteMedia, mediaEnabled, publicMedia, uploadMedia } from '$lib/server/media';
import {
	MAX_TRAVEL_STYLES,
	assertPublishable,
	getTourDetail,
	listActiveCategories,
	listActiveTravelStyles,
	replaceItinerary,
	setTourCategories,
	setTourDestinations,
	setTourGallery,
	setTourTravelStyles,
	transitionTour,
	updateTour,
	type ItineraryDayInput,
	type TourAction
} from '$lib/server/tours';
import { AppError, toAppError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';

/** The vendor half of the lifecycle. The other four are moderation acts. */
const VENDOR_ACTIONS: readonly string[] = ['submit', 'unpublish', 'archive', 'restore'];

/** A JSON field has no natural size limit the way a set of inputs does. */
const MAX_DAYS = 60;

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'tours:read');
	const tenantId = requireTenant(locals).id;
	const detail = await getTourDetail(tenantId, params.id);

	const [countries, destinations, categories, travelStyles, missing] = await Promise.all([
		db()
			.select({ id: schema.countries.id, name: schema.countries.name })
			.from(schema.countries)
			.where(eq(schema.countries.isActive, true))
			.orderBy(asc(schema.countries.name)),
		// Every published destination the marketplace sells, with the country it sits
		// in. Loaded whole rather than per country so switching the country select does
		// not cost a round trip — this is a small, platform-curated list, and a vendor
		// picking places must never wait on the network to see them.
		db()
			.select({
				id: schema.destinations.id,
				name: schema.destinations.name,
				countryId: schema.destinations.countryId,
				destinationType: schema.destinations.destinationType,
				// The composer draws the route as the vendor builds it, so the places
				// arrive with their coordinates rather than being fetched per pick.
				latitude: schema.destinations.latitude,
				longitude: schema.destinations.longitude,
				mapRegion: schema.destinations.mapRegion
			})
			.from(schema.destinations)
			.innerJoin(schema.countries, eq(schema.countries.id, schema.destinations.countryId))
			.where(and(eq(schema.destinations.status, 'PUBLISHED'), eq(schema.countries.isActive, true)))
			.orderBy(asc(schema.destinations.name)),
		listActiveCategories(),
		listActiveTravelStyles(),
		assertPublishable(tenantId, params.id)
	]);

	const t = detail.tour;
	return {
		// Field by field rather than a spread: tenantId, reviewedBy and the SEO columns
		// have no business in a page payload, and a spread is how they would get there.
		tour: {
			id: t.id,
			title: t.title,
			slug: t.slug,
			status: t.status,
			shortDescription: t.shortDescription,
			description: t.description,
			durationDays: t.durationDays,
			durationNights: t.durationNights,
			priceFrom: t.priceFrom,
			currency: t.currency,
			pricingType: t.pricingType,
			travelStyle: t.travelStyle,
			groupType: t.groupType,
			groupSizeMin: t.groupSizeMin,
			groupSizeMax: t.groupSizeMax,
			ageRequirement: t.ageRequirement,
			customisable: t.customisable,
			soloFriendly: t.soloFriendly,
			startsAnyDay: t.startsAnyDay,
			primaryCountryId: t.primaryCountryId,
			primaryCategoryId: t.primaryCategoryId,
			heroMediaId: t.heroMediaId,
			accommodationSummary: t.accommodationSummary,
			transportSummary: t.transportSummary,
			mealsSummary: t.mealsSummary,
			bestTimeSummary: t.bestTimeSummary,
			reviewNote: t.reviewNote,
			submittedAt: t.submittedAt,
			publishedAt: t.publishedAt
		},
		destinationIds: detail.destinations.map((d) => d.id),
		travelStyleIds: detail.travelStyleIds,
		categoryIds: detail.categoryIds,
		itinerary: detail.itinerary.map((d) => ({
			dayNumber: d.dayNumber,
			title: d.title,
			description: d.description,
			destinationId: d.destinationId,
			accommodation: d.accommodation,
			meals: d.meals,
			activities: d.activities,
			distance: d.distance,
			estimatedTravelTime: d.estimatedTravelTime,
			latitude: d.latitude === null ? null : Number(d.latitude),
			longitude: d.longitude === null ? null : Number(d.longitude)
		})),
		gallery: detail.gallery.map((m) => publicMedia(m)).filter((m): m is NonNullable<typeof m> => m !== null),
		countries,
		destinations: destinations.map((d) => ({
			...d,
			latitude: d.latitude === null ? null : Number(d.latitude),
			longitude: d.longitude === null ? null : Number(d.longitude)
		})),
		categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, shortDescription: c.shortDescription })),
		travelStyles: travelStyles.map((s) => ({ id: s.id, name: s.name, slug: s.slug, shortDescription: s.shortDescription })),
		maxTravelStyles: MAX_TRAVEL_STYLES,
		// The service's own words for what is still missing. The page ticks off the rest
		// against this; it never decides for itself whether a listing is ready.
		missing,
		mediaConfigured: mediaEnabled(),
		maxUploadBytes: MAX_BYTES,
		canWrite: locals.permissions.includes('tours:write')
	};
};

/** Empty means CLEARED, matching what the service does with an empty patch field. */
const text = (f: FormData, key: string): string | null => String(f.get(key) ?? '').trim() || null;

/**
 * Blank CLEARS the column; anything that is not a number is refused.
 *
 * Refused rather than treated as blank: silently clearing a group size because
 * somebody typed "6-8" would look exactly like a save that worked.
 */
function num(f: FormData, key: string, label: string): number | null {
	const raw = String(f.get(key) ?? '').trim();
	if (!raw) return null;
	const n = Number(raw);
	if (!Number.isFinite(n)) throw new AppError('VALIDATION_ERROR', `${label} must be a number.`);
	return n;
}

const trimmed = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * A map pin from the browser, or nothing.
 *
 * Anything unparseable becomes null rather than an error: the coordinate is set
 * by dragging a marker, so a malformed one means a bug here, not a vendor
 * mistake worth a validation message. The column CHECK keeps the pair honest.
 */
const coordinate = (value: unknown): string | null => {
	const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
	return Number.isFinite(n) && n !== 0 ? String(n) : null;
};

export const actions: Actions = {
	saveBasics: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		const styleIds = f.getAll('travelStyleIds').map(String).filter(Boolean);
		const categoryIds = f.getAll('categoryIds').map(String).filter(Boolean);
		try {
			await updateTour(
				tenantId,
				params.id,
				{
					title: String(f.get('title') ?? '').trim(),
					shortDescription: text(f, 'shortDescription'),
					description: text(f, 'description'),
					// A blank duration leaves the column alone rather than clearing it — every
					// listing has one, and the service refuses anything below a single day.
					durationDays: num(f, 'durationDays', 'Duration in days') ?? undefined,
					durationNights: num(f, 'durationNights', 'Duration in nights'),
					primaryCategoryId: text(f, 'primaryCategoryId'),
					groupType: text(f, 'groupType'),
					groupSizeMin: num(f, 'groupSizeMin', 'Minimum group size'),
					groupSizeMax: num(f, 'groupSizeMax', 'Maximum group size'),
					ageRequirement: text(f, 'ageRequirement'),
					// A checkbox that is off sends NOTHING, so absence is false. Read with
					// f.has rather than a truthiness test on the value, which would make
					// an unchecked box indistinguishable from a field that was not shown.
					customisable: f.has('customisable'),
					soloFriendly: f.has('soloFriendly'),
					startsAnyDay: f.has('startsAnyDay'),
					accommodationSummary: text(f, 'accommodationSummary'),
					transportSummary: text(f, 'transportSummary'),
					mealsSummary: text(f, 'mealsSummary'),
					bestTimeSummary: text(f, 'bestTimeSummary')
				},
				{ userId: locals.user?.id }
			);
			// After the tour row, not before: setTourCategories reads the primary
			// category off it so the primary can never be missing from the set.
			await setTourCategories(tenantId, params.id, categoryIds, { userId: locals.user?.id });
			await setTourTravelStyles(tenantId, params.id, styleIds, { userId: locals.user?.id });
			return { success: true, notice: 'Basics saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	saveLocation: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		const destinationIds = f.getAll('destinationIds').map(String).filter(Boolean);
		try {
			// Country first, and in its own call: setTourDestinations refuses to link any
			// place until the listing knows which country it sells, and refuses places
			// from any other one. Saving them the other way round fails on a fresh draft.
			await updateTour(
				tenantId,
				params.id,
				{ primaryCountryId: text(f, 'primaryCountryId') },
				{
					userId: locals.user?.id
				}
			);
			await setTourDestinations(tenantId, params.id, destinationIds, { userId: locals.user?.id });
			return { success: true, notice: 'Location saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	saveItinerary: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();

		// Days are added, removed and reordered in the browser, so the browser already
		// holds the finished list — it posts it as one JSON field rather than as dozens
		// of indexed inputs that would only be reassembled into the same array here.
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(f.get('days') ?? '[]'));
		} catch {
			return fail(400, { message: 'The itinerary could not be read. Reload the page and try again.' });
		}
		if (!Array.isArray(parsed)) {
			return fail(400, { message: 'The itinerary could not be read. Reload the page and try again.' });
		}
		if (parsed.length > MAX_DAYS) {
			return fail(400, {
				message: `An itinerary can run to ${MAX_DAYS} days. Split anything longer into two listings.`
			});
		}

		// Renumbered 1..n from the order given rather than from anything the browser
		// counted: replaceItinerary refuses gaps and repeats, and day numbers are
		// something the vendor should never have to type.
		const days: ItineraryDayInput[] = parsed.map((raw, index) => {
			const d = (raw ?? {}) as Record<string, unknown>;
			return {
				dayNumber: index + 1,
				title: String(d.title ?? '').trim(),
				description: trimmed(d.description),
				destinationId: trimmed(d.destinationId),
				accommodation: trimmed(d.accommodation),
				meals: trimmed(d.meals),
				activities: String(d.activities ?? '')
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
				distance: trimmed(d.distance),
				estimatedTravelTime: trimmed(d.estimatedTravelTime),
				latitude: coordinate(d.latitude),
				longitude: coordinate(d.longitude)
			};
		});

		try {
			await replaceItinerary(tenantId, params.id, days, { userId: locals.user?.id });
			return { success: true, notice: 'Itinerary saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	savePricing: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		try {
			await updateTour(
				tenantId,
				params.id,
				{
					priceFrom: text(f, 'priceFrom'),
					currency: text(f, 'currency'),
					pricingType: String(f.get('pricingType') ?? 'PER_PERSON')
				},
				{ userId: locals.user?.id }
			);
			return { success: true, notice: 'Pricing saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Bytes are proxied through here. Handing a browser a signed write URL would mean
	 *  putting a bucket credential on a page, and the object key must be composed from
	 *  ids the server resolved rather than from a filename the browser chose. */
	uploadPhoto: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { message: 'Choose a photo to upload.' });
		if (file.size > MAX_BYTES) {
			return fail(400, { message: `Photos must be smaller than ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` });
		}

		try {
			// Ownership first: bytes must not reach the bucket before we know this
			// listing belongs to the tenant whose folder they would be written into.
			const detail = await getTourDetail(tenantId, params.id);
			const media = await uploadMedia(
				{ kind: 'tour-gallery', tenantId, tourId: params.id },
				new Uint8Array(await file.arrayBuffer()),
				file.type,
				{ altText: text(f, 'altText'), createdBy: locals.user?.id }
			);
			await setTourGallery(tenantId, params.id, [...detail.gallery.map((m) => m.id), media.id], {
				userId: locals.user?.id
			});
			// The first photo becomes the main one. A listing holding photographs and no
			// main photo is a gap the vendor did not knowingly leave.
			if (!detail.tour.heroMediaId) {
				await updateTour(tenantId, params.id, { heroMediaId: media.id }, { userId: locals.user?.id });
			}
			return { success: true, notice: 'Photo uploaded' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	deletePhoto: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		const mediaId = String(f.get('mediaId') ?? '');
		try {
			const detail = await getTourDetail(tenantId, params.id);
			// deleteMedia is scoped to the TENANT, which is not the same fact as the photo
			// being on this listing. Without this check a stray id posted from one
			// composer would take a photograph out of a different listing in the same
			// account, and the vendor would be told it worked.
			if (!detail.gallery.some((m) => m.id === mediaId)) {
				return fail(404, { message: 'That photo is not on this listing.' });
			}
			// Unlinked before it is destroyed. The foreign keys would tidy up on their
			// own, but a listing whose hero points at a deleted object is a broken card
			// on a public page for as long as that ordering is left to chance.
			if (detail.tour.heroMediaId === mediaId) {
				await updateTour(tenantId, params.id, { heroMediaId: null }, { userId: locals.user?.id });
			}
			await setTourGallery(
				tenantId,
				params.id,
				detail.gallery.filter((m) => m.id !== mediaId).map((m) => m.id),
				{ userId: locals.user?.id }
			);
			await deleteMedia(mediaId, { kind: 'tenant', tenantId });
			return { success: true, notice: 'Photo removed' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Order and main photo together — they are one decision about how the listing looks. */
	saveMedia: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		try {
			await setTourGallery(tenantId, params.id, f.getAll('mediaIds').map(String).filter(Boolean), {
				userId: locals.user?.id
			});
			await updateTour(tenantId, params.id, { heroMediaId: text(f, 'heroMediaId') }, { userId: locals.user?.id });
			return { success: true, notice: 'Photos saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	transition: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'tours:write');
		const tenantId = requireTenant(locals).id;
		const f = await request.formData();
		const action = String(f.get('action') ?? '');
		if (!VENDOR_ACTIONS.includes(action)) {
			return fail(403, {
				message: 'Reviewing and publishing a marketplace listing is done by the Makutano team, not from this page.'
			});
		}
		try {
			// Stated rather than defaulted, so the refusal is visible in the call itself.
			await transitionTour(
				tenantId,
				params.id,
				action as TourAction,
				{ userId: locals.user?.id },
				{
					canPublish: false
				}
			);
			return {
				success: true,
				notice:
					action === 'submit'
						? 'Sent for review'
						: action === 'unpublish'
							? 'Taken off the marketplace'
							: action === 'archive'
								? 'Listing archived'
								: 'Listing restored to draft'
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
