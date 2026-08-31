// Marketplace listings, from the operator's side (§35).
//
// Authoring and MODERATION both live here, but they are not the same act: writing a
// listing is sales work, putting it in front of the public puts the marketplace's name
// on it. So transitionTour is TOLD whether its caller may publish rather than deciding
// for itself — the permission check belongs to the route, and this module has to be
// equally safe called from a vendor page or from the platform review queue.
//
// Public reads live elsewhere. Nothing returned here is shaped for a browser: rows come
// back whole because every caller of this module has already proved which tenant it is.
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { audit, type AuditAction, type AuditActor } from './audit';
import { db, schema, txDb } from './db';
import { assertAllowed } from './entitlements';
import { AppError } from './errors';
import type { Pagination } from './http';
import { getTenantById } from './tenants';

export type TourActor = { userId?: string | null; apiKeyId?: string | null };

/**
 * Everything a vendor may write.
 *
 * `status` is absent on purpose — the lifecycle moves through transitionTour, which is
 * the only place the platform-only steps are guarded. `featured` is absent for the same
 * reason as operatorProfiles.isVerified: it is a platform editorial slot, and a listing
 * that can feature itself is not a feature.
 */
export type TourInput = {
	title: string;
	/** Optional. The public URL is derived from the title unless a caller names one. */
	slug?: string;
	primaryCountryId?: string | null;
	/** WHAT this tour is. Validated against the active taxonomy — never free text. */
	primaryCategoryId?: string | null;
	shortDescription?: string | null;
	description?: string | null;
	durationDays?: number;
	durationNights?: number | null;
	priceFrom?: string | null;
	currency?: string | null;
	pricingType?: string;
	travelStyle?: string | null;
	groupType?: string | null;
	groupSizeMin?: number | null;
	groupSizeMax?: number | null;
	ageRequirement?: string | null;
	customisable?: boolean;
	soloFriendly?: boolean;
	startsAnyDay?: boolean;
	heroMediaId?: string | null;
	accommodationSummary?: string | null;
	transportSummary?: string | null;
	mealsSummary?: string | null;
	bestTimeSummary?: string | null;
	availabilityType?: string;
	availableFrom?: string | null;
	availableTo?: string | null;
	seoTitle?: string | null;
	seoDescription?: string | null;
	highlights?: string[];
	included?: string[];
	excluded?: string[];
	metadata?: Record<string, unknown>;
};

export type ItineraryDayInput = {
	dayNumber: number;
	title: string;
	description?: string | null;
	destinationId?: string | null;
	accommodation?: string | null;
	meals?: string | null;
	activities?: string[];
	distance?: string | null;
	estimatedTravelTime?: string | null;
	mediaId?: string | null;
	/** The day's own pin, for a stop that is not a canonical destination. */
	latitude?: string | null;
	longitude?: string | null;
};

const PRICING_TYPES = ['PER_PERSON', 'PER_GROUP', 'FROM'];
const AVAILABILITY_TYPES = ['YEAR_ROUND', 'SEASONAL', 'DATE_RANGE'];
const PRICE = /^\d+(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An API key writing a listing is not the same actor as a person clicking Save, and a
 *  moderation trail that cannot tell them apart is worth less than one that can. */
const auditActor = (actor: TourActor): AuditActor =>
	actor.apiKeyId
		? { type: 'api_key', apiKeyId: actor.apiKeyId, userId: actor.userId ?? undefined }
		: { type: 'user', userId: actor.userId ?? undefined };

/** A malformed uuid reaching a query is a 500 from Postgres; caught here it is a 422. */
function assertUuid(value: string, label: string): string {
	if (!UUID.test(value)) throw new AppError('VALIDATION_ERROR', `Invalid ${label}.`);
	return value;
}

/* ------------------------------------------------------------------ slugs ---- */

const SLUG_MAX = 80;
const SLUG_ATTEMPTS = 8;

/** Not tenants.slugify: that one caps at 60 for a subdomain, and a tour URL carries a
 *  whole title. Changing it there would move every existing tenant slug. */
export function tourSlug(value: string): string {
	const base = value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.slice(0, SLUG_MAX).replace(/-+$/, '') || 'tour';
}

/** First candidate from `${base}`, `${base}-2`, … that no LIVE row holds. */
async function freeSlug(base: string, from: number): Promise<{ slug: string; n: number }> {
	for (let n = from; n < from + SLUG_ATTEMPTS; n++) {
		const suffix = n === 1 ? '' : `-${n}`;
		const slug = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
		const clash = await db()
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.slug, slug), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!clash.length) return { slug, n };
	}
	throw new AppError('CONFLICT', 'Too many listings share this title. Give this one a more specific name.');
}

/**
 * Write a row under a slug nothing live holds.
 *
 * The pre-check above is a courtesy, never the guarantee: two operators can both pass it
 * in the same millisecond and the partial unique index then rejects the loser. So the
 * unique violation is CAUGHT and the next suffix tried, bounded. Because that index
 * covers live rows only, a soft-deleted tour hands its slug back for reuse.
 */
async function withUniqueSlug<T>(desired: string, write: (slug: string) => Promise<T>): Promise<T> {
	const base = tourSlug(desired);
	let from = 1;
	for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
		const candidate = await freeSlug(base, from);
		try {
			return await write(candidate.slug);
		} catch (err) {
			if (!isUniqueViolation(err)) throw err;
			from = candidate.n + 1;
		}
	}
	throw new AppError('CONFLICT', 'Could not find a free URL for this listing. Try a slightly different title.');
}

/** 23505 — unique_violation, as postgres.js surfaces it. */
function isUniqueViolation(err: unknown): boolean {
	return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505');
}

/* ------------------------------------------------------------- validation ---- */

/** Empty means CLEARED, not an empty string sitting on a public page. */
const text = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

const list = (value: string[] | undefined) =>
	value === undefined ? undefined : value.map((v) => v?.trim()).filter((v): v is string => Boolean(v));

function isoDate(value: string | null | undefined, label: string) {
	if (value === undefined) return undefined;
	const trimmed = value?.trim();
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
		throw new AppError('VALIDATION_ERROR', `${label} must be a YYYY-MM-DD date.`);
	return trimmed;
}

function wholeNumber(value: number | null | undefined, label: string, min: number) {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (!Number.isInteger(value) || value < min) {
		throw new AppError('VALIDATION_ERROR', `${label} must be a whole number of at least ${min}.`);
	}
	return value;
}

/** The country a listing sells must be one the marketplace actually sells. */
async function activeCountry(id: string): Promise<string> {
	assertUuid(id, 'country id');
	const rows = await db()
		.select({ id: schema.countries.id })
		.from(schema.countries)
		.where(and(eq(schema.countries.id, id), eq(schema.countries.isActive, true)))
		.limit(1);
	if (!rows[0]) throw new AppError('VALIDATION_ERROR', 'That country is not available on the marketplace.');
	return rows[0].id;
}

/**
 * A media id is just a uuid in a request body.
 *
 * Without this, an operator could point their hero image — or a day photo — at another
 * operator's asset by pasting its id, and the marketplace would serve someone else's
 * photograph under the wrong name.
 */
async function assertOwnedMedia(tenantId: string, ids: Array<string | null | undefined>): Promise<void> {
	const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	if (!wanted.length) return;
	for (const id of wanted) assertUuid(id, 'media id');
	const rows = await db()
		.select({ id: schema.media.id })
		.from(schema.media)
		.where(and(inArray(schema.media.id, wanted), eq(schema.media.tenantId, tenantId)));
	if (rows.length !== wanted.length) {
		throw new AppError('VALIDATION_ERROR', 'That image does not belong to this account.');
	}
}

/**
 * Resolve a category id, refusing anything retired.
 *
 * A vendor CHOOSES from the taxonomy; they cannot invent one and cannot attach a
 * category the platform has withdrawn. That is the whole reason categories are a
 * table rather than the free-text column this replaces.
 */
async function activeCategory(id: string): Promise<string> {
	assertUuid(id, 'category id');
	const [row] = await db()
		.select({ id: schema.tourCategories.id })
		.from(schema.tourCategories)
		.where(and(eq(schema.tourCategories.id, id), eq(schema.tourCategories.isActive, true)))
		.limit(1);
	if (!row) throw new AppError('VALIDATION_ERROR', 'That category is not available.');
	return row.id;
}

/** Everything a caller may set, validated and normalised. Nothing else reaches a write. */
async function tourValues(
	tenantId: string,
	input: Partial<TourInput>,
	opts: { requireTitle: boolean }
): Promise<Partial<typeof schema.tours.$inferInsert>> {
	const values: Partial<typeof schema.tours.$inferInsert> = {};

	if (opts.requireTitle && !input.title?.trim()) throw new AppError('VALIDATION_ERROR', 'A listing needs a title.');
	if (input.title !== undefined) {
		const title = input.title.trim();
		if (!title) throw new AppError('VALIDATION_ERROR', 'A listing needs a title.');
		values.title = title;
	}

	if (input.primaryCountryId !== undefined) {
		values.primaryCountryId = input.primaryCountryId ? await activeCountry(input.primaryCountryId) : null;
	}
	if (input.primaryCategoryId !== undefined) {
		values.primaryCategoryId = input.primaryCategoryId ? await activeCategory(input.primaryCategoryId) : null;
	}
	if (input.heroMediaId !== undefined) {
		await assertOwnedMedia(tenantId, [input.heroMediaId]);
		values.heroMediaId = input.heroMediaId || null;
	}

	// Booleans are only written when the caller mentions them, so a partial patch
	// from another surface cannot silently un-tick a feature it never sent.
	if (input.customisable !== undefined) values.customisable = Boolean(input.customisable);
	if (input.soloFriendly !== undefined) values.soloFriendly = Boolean(input.soloFriendly);
	if (input.startsAnyDay !== undefined) values.startsAnyDay = Boolean(input.startsAnyDay);

	values.durationDays = wholeNumber(input.durationDays, 'Duration in days', 1) ?? undefined;
	values.durationNights = wholeNumber(input.durationNights, 'Duration in nights', 0);
	values.groupSizeMin = wholeNumber(input.groupSizeMin, 'Minimum group size', 1);
	values.groupSizeMax = wholeNumber(input.groupSizeMax, 'Maximum group size', 1);
	// Only comparable when both arrive together — a patch carrying one of them is
	// checked against nothing rather than against a half-updated row.
	if (typeof values.groupSizeMin === 'number' && typeof values.groupSizeMax === 'number') {
		if (values.groupSizeMin > values.groupSizeMax) {
			throw new AppError('VALIDATION_ERROR', 'Minimum group size cannot be larger than the maximum.');
		}
	}

	if (input.priceFrom !== undefined) {
		const price = input.priceFrom?.trim();
		if (price && !PRICE.test(price)) {
			throw new AppError('VALIDATION_ERROR', 'Price must be a number with at most two decimal places.');
		}
		values.priceFrom = price || null;
	}
	if (input.currency !== undefined) {
		const currency = input.currency?.trim().toUpperCase();
		if (currency && !/^[A-Z]{3}$/.test(currency)) {
			throw new AppError('VALIDATION_ERROR', 'Currency must be a three-letter code, e.g. USD.');
		}
		values.currency = currency || null;
	}
	if (input.pricingType !== undefined) {
		if (!PRICING_TYPES.includes(input.pricingType)) {
			throw new AppError('VALIDATION_ERROR', `Pricing type must be one of ${PRICING_TYPES.join(', ')}.`);
		}
		values.pricingType = input.pricingType;
	}
	if (input.availabilityType !== undefined) {
		if (!AVAILABILITY_TYPES.includes(input.availabilityType)) {
			throw new AppError('VALIDATION_ERROR', `Availability must be one of ${AVAILABILITY_TYPES.join(', ')}.`);
		}
		values.availabilityType = input.availabilityType;
	}

	values.availableFrom = isoDate(input.availableFrom, 'Available from');
	values.availableTo = isoDate(input.availableTo, 'Available to');
	if (values.availableFrom && values.availableTo && values.availableFrom > values.availableTo) {
		throw new AppError('VALIDATION_ERROR', 'The availability window ends before it starts.');
	}

	values.shortDescription = text(input.shortDescription);
	values.description = text(input.description);
	values.travelStyle = text(input.travelStyle);
	values.groupType = text(input.groupType);
	values.ageRequirement = text(input.ageRequirement);
	values.accommodationSummary = text(input.accommodationSummary);
	values.transportSummary = text(input.transportSummary);
	values.mealsSummary = text(input.mealsSummary);
	values.bestTimeSummary = text(input.bestTimeSummary);
	values.seoTitle = text(input.seoTitle);
	values.seoDescription = text(input.seoDescription);

	values.highlights = list(input.highlights);
	values.included = list(input.included);
	values.excluded = list(input.excluded);
	if (input.metadata !== undefined) values.metadata = input.metadata;

	return values;
}

/* ------------------------------------------------------------------ reads ---- */

export async function listTours(
	tenantId: string,
	p: Pagination,
	filters: { status?: schema.Tour['status'][]; search?: string } = {}
) {
	const conditions: SQL[] = [eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)];
	if (filters.status?.length) conditions.push(inArray(schema.tours.status, filters.status));
	const term = filters.search?.trim() || p.q;
	if (term) {
		conditions.push(or(ilike(schema.tours.title, `%${term}%`), ilike(schema.tours.slug, `%${term}%`)) as SQL);
	}
	const where = and(...conditions);
	// updatedAt desc matches tours_tenant_idx, so the vendor's list is an index read.
	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select()
			.from(schema.tours)
			.where(where)
			.orderBy(desc(schema.tours.updatedAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.tours).where(where)
	]);
	return { items, total: Number(total) };
}

/**
 * The ownership check the rest of this file is built on.
 *
 * Every mutation resolves the tour through here first, so a tenant id is never taken
 * from a caller's payload — the tour row is what says who owns the work.
 */
export async function getTour(tenantId: string, id: string): Promise<schema.Tour> {
	const rows = await db()
		.select()
		.from(schema.tours)
		.where(and(eq(schema.tours.id, id), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Tour could not be found.');
	return rows[0];
}

/**
 * The authoring view: the listing and its three ordered child lists.
 *
 * Rows are returned whole because the caller owns them. A PUBLIC response must build an
 * explicit allow-list from this — media.objectKey in particular is the handle that can
 * delete an object and never leaves the server.
 */
export async function getTourDetail(tenantId: string, id: string) {
	const tour = await getTour(tenantId, id);
	const [destinationRows, itinerary, galleryRows, styleRows, categoryRows] = await Promise.all([
		db()
			.select({ destination: schema.destinations, sortOrder: schema.tourDestinations.sortOrder })
			.from(schema.tourDestinations)
			.innerJoin(schema.destinations, eq(schema.destinations.id, schema.tourDestinations.destinationId))
			.where(eq(schema.tourDestinations.tourId, id))
			.orderBy(asc(schema.tourDestinations.sortOrder)),
		db()
			.select()
			.from(schema.tourItineraryDays)
			.where(eq(schema.tourItineraryDays.tourId, id))
			.orderBy(asc(schema.tourItineraryDays.dayNumber)),
		db()
			.select({ asset: schema.media, sortOrder: schema.tourMedia.sortOrder })
			.from(schema.tourMedia)
			.innerJoin(schema.media, eq(schema.media.id, schema.tourMedia.mediaId))
			.where(eq(schema.tourMedia.tourId, id))
			.orderBy(asc(schema.tourMedia.sortOrder)),
		db()
			.select({ id: schema.tourTravelStyles.travelStyleId })
			.from(schema.tourTravelStyles)
			.where(eq(schema.tourTravelStyles.tourId, id))
			.orderBy(asc(schema.tourTravelStyles.sortOrder)),
		db()
			.select({ id: schema.tourCategoryLinks.categoryId })
			.from(schema.tourCategoryLinks)
			.where(eq(schema.tourCategoryLinks.tourId, id))
			.orderBy(asc(schema.tourCategoryLinks.sortOrder))
	]);
	return {
		tour,
		destinations: destinationRows.map((r) => r.destination),
		itinerary,
		gallery: galleryRows.map((r) => r.asset),
		travelStyleIds: styleRows.map((r) => r.id),
		categoryIds: categoryRows.map((r) => r.id)
	};
}

/* -------------------------------------------------------------- authoring ---- */

/**
 * Make sure this tenant has a public operator profile.
 *
 * The marketplace's promise is "run by the operator who listed it", so a listing
 * with no operator behind it is a broken promise rendered as an empty card. The
 * profile is created from what the tenant already told us at signup rather than
 * making them fill a second form before they can start — they can edit it later,
 * and the platform is the only thing that can set isVerified.
 *
 * Idempotent and cheap: called on every tour creation, does nothing after the
 * first. Deliberately NOT part of provisioning — most tenants never sell on the
 * marketplace, and giving all of them a public profile they did not ask for
 * would be worse than creating one at the moment it starts to matter.
 */
export async function ensureOperatorProfile(tenantId: string): Promise<schema.OperatorProfile> {
	const [existing] = await db()
		.select()
		.from(schema.operatorProfiles)
		.where(eq(schema.operatorProfiles.tenantId, tenantId))
		.limit(1);
	if (existing) return existing;

	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	const base = tourSlug(tenant.slug || tenant.name) || 'operator';
	// operator_profiles.slug is unique across the whole marketplace, and a tenant
	// slug is not guaranteed to be free here, so collisions get a suffix.
	for (let attempt = 0; attempt < 25; attempt++) {
		const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
		try {
			const [row] = await db()
				.insert(schema.operatorProfiles)
				.values({
					tenantId,
					slug,
					displayName: tenant.name,
					location: tenant.country,
					isActive: true
				})
				.returning();
			return row;
		} catch (err) {
			// Another request created it between the read and the insert — take theirs.
			const [raced] = await db()
				.select()
				.from(schema.operatorProfiles)
				.where(eq(schema.operatorProfiles.tenantId, tenantId))
				.limit(1);
			if (raced) return raced;
			if (attempt === 24) throw err;
		}
	}
	throw new AppError('INTERNAL_ERROR', 'Could not create an operator profile.');
}

export async function createTour(tenantId: string, input: TourInput, actor: TourActor = {}): Promise<schema.Tour> {
	// A listing needs somebody's name on it; see ensureOperatorProfile.
	await ensureOperatorProfile(tenantId);
	await assertAllowed(tenantId);
	const values = await tourValues(tenantId, input, { requireTitle: true });
	const title = input.title.trim();

	const tour = await withUniqueSlug(input.slug || title, async (slug) => {
		const [row] = await db()
			.insert(schema.tours)
			.values({ ...values, tenantId, title, slug })
			.returning();
		return row;
	});

	await audit(tenantId, 'tour.created', auditActor(actor), { type: 'tour', id: tour.id }, { title, slug: tour.slug });
	return tour;
}

export async function updateTour(
	tenantId: string,
	id: string,
	patch: Partial<TourInput>,
	actor: TourActor = {}
): Promise<schema.Tour> {
	await assertAllowed(tenantId);
	const before = await getTour(tenantId, id);
	const values = await tourValues(tenantId, patch, { requireTitle: false });

	const write = async (slug?: string): Promise<schema.Tour> => {
		const [row] = await db()
			.update(schema.tours)
			.set({ ...values, ...(slug ? { slug } : {}), updatedAt: new Date() })
			.where(and(eq(schema.tours.id, id), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.returning();
		if (!row) throw new AppError('NOT_FOUND', 'Tour could not be found.');
		return row;
	};

	// The slug IS the public URL. Retitling must not silently move a live listing out
	// from under every link already pointing at it, so it only moves when asked by name —
	// and asking for an empty one means "rebuild it from the title", not "call it tour".
	const after =
		patch.slug !== undefined ? await withUniqueSlug(patch.slug || values.title || before.title, write) : await write();

	await audit(
		tenantId,
		'tour.updated',
		auditActor(actor),
		{ type: 'tour', id },
		{ fields: Object.keys(values).filter((k) => values[k as keyof typeof values] !== undefined) }
	);
	return after;
}

/**
 * Hide a listing. Never destroy one.
 *
 * Itinerary days, gallery links and any booking request that named this tour hang off
 * the row, so a hard delete would take a customer's enquiry with it. The status is left
 * alone: every read here and on the public side already filters deletedAt, and the
 * partial unique index releases the slug the moment it is set.
 */
export async function softDeleteTour(tenantId: string, id: string, actor: TourActor = {}): Promise<void> {
	await assertAllowed(tenantId);
	const tour = await getTour(tenantId, id);
	const now = new Date();
	await db()
		.update(schema.tours)
		.set({ deletedAt: now, updatedAt: now })
		.where(and(eq(schema.tours.id, id), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)));
	await audit(
		tenantId,
		'tour.deleted',
		auditActor(actor),
		{ type: 'tour', id },
		{ status: tour.status, slug: tour.slug }
	);
}

/* ----------------------------------------------------------- destinations ---- */

/**
 * Replace the whole set of places a tour visits, in the order given.
 *
 * Unknown ids are REFUSED rather than dropped: saving four of five destinations and
 * reporting success tells the vendor the fifth was saved.
 */
export async function setTourDestinations(
	tenantId: string,
	tourId: string,
	destinationIds: string[],
	actor: TourActor = {}
): Promise<void> {
	await assertAllowed(tenantId);
	const tour = await getTour(tenantId, tourId);

	// Order is the vendor's; duplicates are not — the composite primary key would reject
	// them, so a place named twice keeps its first position and is linked once.
	const ids: string[] = [];
	for (const raw of destinationIds) {
		const id = raw?.trim();
		if (!id) continue;
		assertUuid(id, 'destination id');
		if (!ids.includes(id)) ids.push(id);
	}

	if (ids.length) {
		// Multi-country listings are not switched on yet, and without a country there is
		// nothing to check them against — so the country comes first, deliberately.
		if (!tour.primaryCountryId) {
			throw new AppError('VALIDATION_ERROR', 'Set the country for this listing before linking destinations.');
		}
		const rows = await db()
			.select({
				id: schema.destinations.id,
				name: schema.destinations.name,
				countryId: schema.destinations.countryId
			})
			.from(schema.destinations)
			.where(and(inArray(schema.destinations.id, ids), eq(schema.destinations.status, 'PUBLISHED')));
		const found = new Map(rows.map((r) => [r.id, r]));

		const unknown = ids.filter((id) => !found.has(id));
		if (unknown.length) {
			throw new AppError('VALIDATION_ERROR', `${unknown.length} destination(s) do not exist or are not published.`, {
				unknown
			});
		}
		const foreign = rows.filter((r) => r.countryId !== tour.primaryCountryId).map((r) => r.name);
		if (foreign.length) {
			throw new AppError(
				'VALIDATION_ERROR',
				`This listing can only visit places in its own country: remove ${foreign.join(', ')}.`
			);
		}
	}

	await txDb().transaction(async (tx) => {
		// tour_destinations carries no tenant_id — the tour row IS the ownership record,
		// so it is re-read inside the transaction that rewrites the links.
		const owned = await tx
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!owned.length) throw new AppError('NOT_FOUND', 'Tour could not be found.');

		await tx.delete(schema.tourDestinations).where(eq(schema.tourDestinations.tourId, tourId));
		if (ids.length) {
			await tx
				.insert(schema.tourDestinations)
				.values(ids.map((destinationId, index) => ({ tourId, destinationId, sortOrder: index })));
		}
	});

	await audit(tenantId, 'tour.updated', auditActor(actor), { type: 'tour', id: tourId }, { destinations: ids });
}

/* -------------------------------------------------------------- itinerary ---- */

/**
 * Replace the itinerary as one list, atomically.
 *
 * Whole-list replace rather than per-day edits, because reordering days is the normal
 * operation and doing it row by row means a unique (tour, day_number) collision halfway
 * through. Inside a transaction for the same reason: a tour showing days 1, 2 and 5
 * because an insert failed is worse than a rejected save.
 */
/**
 * Tag a listing with the travel styles it actually is.
 *
 * Whole-set replace, like destinations: the composer edits the selection and
 * sends it whole, which removes a class of bug where two edits interleave.
 *
 * Capped, and the cap is the point. A vendor who ticks every style to appear in
 * every filter makes the filters useless for everybody — including themselves,
 * because a traveller who filters to Honeymoon and finds a budget group tour
 * stops trusting the filter.
 */
export const MAX_TRAVEL_STYLES = 5;

export async function setTourTravelStyles(
	tenantId: string,
	tourId: string,
	styleIds: string[],
	actor: TourActor = {}
): Promise<void> {
	await assertAllowed(tenantId);
	const tour = await getTour(tenantId, tourId);

	const ids: string[] = [];
	for (const raw of styleIds) {
		const id = raw?.trim();
		if (!id || ids.includes(id)) continue;
		assertUuid(id, 'travel style id');
		ids.push(id);
	}
	if (ids.length > MAX_TRAVEL_STYLES) {
		throw new AppError(
			'VALIDATION_ERROR',
			`Choose up to ${MAX_TRAVEL_STYLES} travel styles — the ones that genuinely describe this trip.`
		);
	}

	if (ids.length) {
		// Only ACTIVE canonical styles. A vendor selects from the taxonomy; they
		// cannot invent one, and a retired style cannot be re-attached.
		const found = await db()
			.select({ id: schema.travelStyles.id })
			.from(schema.travelStyles)
			.where(and(inArray(schema.travelStyles.id, ids), eq(schema.travelStyles.isActive, true)));
		if (found.length !== ids.length) {
			throw new AppError('VALIDATION_ERROR', 'One of those travel styles is not available.');
		}
	}

	await txDb().transaction(async (tx) => {
		// tour_travel_styles carries no tenant_id — the tour row IS the ownership
		// record, so it is re-read inside the transaction that rewrites the links.
		const owned = await tx
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!owned.length) throw new AppError('NOT_FOUND', 'Tour could not be found.');

		await tx.delete(schema.tourTravelStyles).where(eq(schema.tourTravelStyles.tourId, tourId));
		if (ids.length) {
			await tx
				.insert(schema.tourTravelStyles)
				.values(ids.map((travelStyleId, index) => ({ tourId, travelStyleId, sortOrder: index })));
		}
		await tx.update(schema.tours).set({ updatedAt: new Date() }).where(eq(schema.tours.id, tourId));
	});

	await audit(tenantId, 'tour.updated', auditActor(actor), { type: 'tour', id: tourId }, {
		title: tour.title,
		travelStyles: ids.length
	});
}

/**
 * The categories a listing spans, including its primary one.
 *
 * The primary is written in here too, so a category filter is one join rather
 * than a union of a column and a table. Whole-set replace, like the others.
 */
export async function setTourCategories(
	tenantId: string,
	tourId: string,
	categoryIds: string[],
	actor: TourActor = {}
): Promise<void> {
	await assertAllowed(tenantId);
	const tour = await getTour(tenantId, tourId);

	const ids: string[] = [];
	for (const raw of categoryIds) {
		const id = raw?.trim();
		if (!id || ids.includes(id)) continue;
		assertUuid(id, 'category id');
		ids.push(id);
	}
	// The primary category is a category. Writing it here as well is what keeps
	// "every safari" a single join, and it can never be missing from the set.
	if (tour.primaryCategoryId && !ids.includes(tour.primaryCategoryId)) ids.unshift(tour.primaryCategoryId);

	if (ids.length) {
		const found = await db()
			.select({ id: schema.tourCategories.id })
			.from(schema.tourCategories)
			.where(and(inArray(schema.tourCategories.id, ids), eq(schema.tourCategories.isActive, true)));
		if (found.length !== ids.length) {
			throw new AppError('VALIDATION_ERROR', 'One of those categories is not available.');
		}
	}

	await txDb().transaction(async (tx) => {
		const owned = await tx
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!owned.length) throw new AppError('NOT_FOUND', 'Tour could not be found.');

		await tx.delete(schema.tourCategoryLinks).where(eq(schema.tourCategoryLinks.tourId, tourId));
		if (ids.length) {
			await tx
				.insert(schema.tourCategoryLinks)
				.values(ids.map((categoryId, index) => ({ tourId, categoryId, sortOrder: index })));
		}
		await tx.update(schema.tours).set({ updatedAt: new Date() }).where(eq(schema.tours.id, tourId));
	});

	await audit(tenantId, 'tour.updated', auditActor(actor), { type: 'tour', id: tourId }, {
		title: tour.title,
		categories: ids.length
	});
}

/** The taxonomy a vendor may choose from. */
export async function listActiveCategories() {
	return db()
		.select()
		.from(schema.tourCategories)
		.where(eq(schema.tourCategories.isActive, true))
		.orderBy(asc(schema.tourCategories.sortOrder), asc(schema.tourCategories.name));
}

/** The taxonomy a vendor may choose from. */
export async function listActiveTravelStyles() {
	return db()
		.select()
		.from(schema.travelStyles)
		.where(eq(schema.travelStyles.isActive, true))
		.orderBy(asc(schema.travelStyles.sortOrder), asc(schema.travelStyles.name));
}

export async function replaceItinerary(
	tenantId: string,
	tourId: string,
	days: ItineraryDayInput[],
	actor: TourActor = {}
): Promise<schema.TourItineraryDay[]> {
	await assertAllowed(tenantId);
	await getTour(tenantId, tourId);

	const ordered = [...days].sort((a, b) => a.dayNumber - b.dayNumber);
	ordered.forEach((day, index) => {
		if (!Number.isInteger(day.dayNumber) || day.dayNumber !== index + 1) {
			throw new AppError('VALIDATION_ERROR', 'Itinerary days must be numbered 1, 2, 3 with no gaps or repeats.');
		}
		if (!day.title?.trim()) throw new AppError('VALIDATION_ERROR', `Day ${index + 1} needs a title.`);
	});

	// A day may point at a place the tour does not formally "visit" — a lunch stop on the
	// way — so this is not checked against the linked destinations. It must still be a
	// real, published place, or the rendered route links to nothing.
	const destinationIds = [...new Set(ordered.map((d) => d.destinationId).filter((id): id is string => Boolean(id)))];
	if (destinationIds.length) {
		for (const id of destinationIds) assertUuid(id, 'destination id');
		const rows = await db()
			.select({ id: schema.destinations.id })
			.from(schema.destinations)
			.where(and(inArray(schema.destinations.id, destinationIds), eq(schema.destinations.status, 'PUBLISHED')));
		if (rows.length !== destinationIds.length) {
			throw new AppError(
				'VALIDATION_ERROR',
				'An itinerary day names a destination that does not exist or is not published.'
			);
		}
	}
	await assertOwnedMedia(
		tenantId,
		ordered.map((d) => d.mediaId)
	);

	const rows = await txDb().transaction(async (tx) => {
		const owned = await tx
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!owned.length) throw new AppError('NOT_FOUND', 'Tour could not be found.');

		await tx.delete(schema.tourItineraryDays).where(eq(schema.tourItineraryDays.tourId, tourId));
		if (!ordered.length) return [];
		return tx
			.insert(schema.tourItineraryDays)
			.values(
				ordered.map((day) => ({
					tourId,
					dayNumber: day.dayNumber,
					title: day.title.trim(),
					description: text(day.description) ?? null,
					destinationId: day.destinationId || null,
					accommodation: text(day.accommodation) ?? null,
					meals: text(day.meals) ?? null,
					activities: list(day.activities) ?? [],
					distance: text(day.distance) ?? null,
					estimatedTravelTime: text(day.estimatedTravelTime) ?? null,
					mediaId: day.mediaId || null,
					// Both or neither, matching the column CHECK: half a coordinate is
					// not a location, it is a pin that renders off the coast of Ghana.
					latitude: day.latitude && day.longitude ? day.latitude : null,
					longitude: day.latitude && day.longitude ? day.longitude : null
				}))
			)
			.returning();
	});

	await audit(
		tenantId,
		'tour.updated',
		auditActor(actor),
		{ type: 'tour', id: tourId },
		{ itineraryDays: rows.length }
	);
	return rows;
}

/* ------------------------------------------------------------- moderation ---- */

/**
 * What a listing is still missing before anyone should look at it.
 *
 * Returns the gaps rather than throwing, so the authoring page can show the checklist
 * while it is being filled in. submit runs the same list and refuses on it — the vendor
 * and the reviewer are never working from two different definitions of "ready".
 */
/**
 * Replace a tour's gallery, in the given order.
 *
 * Whole-list replace rather than add/remove calls: the vendor UI reorders by
 * dragging, so the browser already knows the final order and sending it whole
 * removes a class of bug where two reorders race and interleave.
 *
 * assertOwnedMedia is the guard that matters — a caller naming another tenant's
 * media id is refused before anything is written, so a gallery can never point
 * at an image its owner did not upload.
 */
export async function setTourGallery(
	tenantId: string,
	tourId: string,
	mediaIds: string[],
	actor: TourActor = {}
): Promise<void> {
	await assertAllowed(tenantId);
	const tour = await getTour(tenantId, tourId);

	// Duplicates keep their first position and are linked once — the composite
	// primary key would reject the second row anyway.
	const ids: string[] = [];
	for (const raw of mediaIds) {
		const id = raw?.trim();
		if (!id || ids.includes(id)) continue;
		assertUuid(id, 'media id');
		ids.push(id);
	}
	await assertOwnedMedia(tenantId, ids);

	await txDb().transaction(async (tx) => {
		// tour_media carries no tenant_id — the tour row IS the ownership record,
		// so it is re-read inside the transaction that rewrites the links.
		const owned = await tx
			.select({ id: schema.tours.id })
			.from(schema.tours)
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
			.limit(1);
		if (!owned.length) throw new AppError('NOT_FOUND', 'Tour could not be found.');

		await tx.delete(schema.tourMedia).where(eq(schema.tourMedia.tourId, tourId));
		if (ids.length) {
			await tx
				.insert(schema.tourMedia)
				.values(ids.map((mediaId, index) => ({ tourId, mediaId, sortOrder: index })));
		}
		await tx.update(schema.tours).set({ updatedAt: new Date() }).where(eq(schema.tours.id, tourId));
	});

	await audit(tenantId, 'tour.media_added', auditActor(actor), { type: 'tour', id: tourId }, {
		title: tour.title,
		count: ids.length
	});
}

export async function assertPublishable(tenantId: string, id: string): Promise<string[]> {
	const tour = await getTour(tenantId, id);
	const [[dayCount], [destinationCount]] = await Promise.all([
		db().select({ value: count() }).from(schema.tourItineraryDays).where(eq(schema.tourItineraryDays.tourId, id)),
		db().select({ value: count() }).from(schema.tourDestinations).where(eq(schema.tourDestinations.tourId, id))
	]);

	const missing: string[] = [];
	if (!tour.title.trim()) missing.push('a title');
	if (!tour.shortDescription?.trim()) missing.push('a short description');
	if (!tour.primaryCountryId) missing.push('a country');
	// A listing with no category appears under no category filter, which is a
	// listing nobody finds. The taxonomy is small and every real tour fits one.
	if (!tour.primaryCategoryId) missing.push('a category');
	if (!tour.durationDays || tour.durationDays < 1) missing.push('a duration of at least one day');
	if (!tour.priceFrom) missing.push('a starting price');
	if (!tour.currency) missing.push('a currency');
	if (!tour.heroMediaId) missing.push('a main photo');
	if (Number(dayCount.value) < 1) missing.push('at least one itinerary day');
	if (Number(destinationCount.value) < 1) missing.push('at least one destination');
	return missing;
}

export type TourAction =
	'submit' | 'start_review' | 'approve' | 'request_changes' | 'publish' | 'unpublish' | 'archive' | 'restore';

type TransitionRule = {
	from: schema.Tour['status'][];
	to: schema.Tour['status'];
	/** PLATFORM-only: refused unless the caller states it holds tours:publish. */
	platform: boolean;
	audit: AuditAction;
};

/**
 * The lifecycle, in one table.
 *
 * The four `platform: true` steps are the ones no tenant role can reach — not even an
 * OWNER, because tours:publish is excluded from TENANT_ALL. unpublish is deliberately
 * open to both: an operator pulling their own listing off the marketplace is not a
 * moderation decision, and making them wait for the platform to do it is how stale or
 * mis-priced listings stay live.
 *
 * archive excludes PUBLISHED (unpublish it first) and ARCHIVED (a CONFLICT naming the
 * current state is a better answer than a silent no-op).
 */
const TRANSITIONS: Record<TourAction, TransitionRule> = {
	submit: {
		from: ['DRAFT', 'CHANGES_REQUESTED', 'UNPUBLISHED'],
		to: 'SUBMITTED',
		platform: false,
		audit: 'tour.submitted'
	},
	// start_review, approve and restore have no dedicated name in the AuditAction union,
	// so they land on tour.updated with the action in the metadata.
	start_review: { from: ['SUBMITTED'], to: 'IN_REVIEW', platform: true, audit: 'tour.updated' },
	approve: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'APPROVED', platform: true, audit: 'tour.updated' },
	request_changes: {
		from: ['SUBMITTED', 'IN_REVIEW'],
		to: 'CHANGES_REQUESTED',
		platform: true,
		audit: 'tour.rejected'
	},
	publish: { from: ['APPROVED'], to: 'PUBLISHED', platform: true, audit: 'tour.published' },
	unpublish: { from: ['PUBLISHED'], to: 'UNPUBLISHED', platform: false, audit: 'tour.unpublished' },
	archive: {
		from: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'UNPUBLISHED'],
		to: 'ARCHIVED',
		platform: false,
		audit: 'tour.archived'
	},
	restore: { from: ['ARCHIVED'], to: 'DRAFT', platform: false, audit: 'tour.updated' }
};

/**
 * Move a listing through its lifecycle.
 *
 * `canPublish` is passed IN. Reading the permission here would make this file the second
 * place the rule lives, free to disagree with the route — and the whole point of
 * tours:publish is that there is exactly one answer to "may this caller approve a
 * listing", whether the request came from a vendor page, the review queue or an API key
 * (which cannot hold the scope at all).
 */
export async function transitionTour(
	tenantId: string,
	id: string,
	action: TourAction,
	actor: TourActor = {},
	opts: { canPublish?: boolean; note?: string | null } = {}
): Promise<schema.Tour> {
	await assertAllowed(tenantId);
	const rule = TRANSITIONS[action];
	if (!rule) throw new AppError('VALIDATION_ERROR', `Unknown listing action: ${action}.`);
	if (rule.platform && opts.canPublish !== true) {
		throw new AppError('FORBIDDEN', 'Only the marketplace team can review or publish a listing.');
	}

	const tour = await getTour(tenantId, id);
	if (!rule.from.includes(tour.status)) {
		throw new AppError('CONFLICT', `A listing in ${tour.status} cannot move to ${rule.to} (${action}).`);
	}

	const note = opts.note?.trim() || null;
	if (action === 'request_changes' && !note) {
		throw new AppError('VALIDATION_ERROR', 'Say what needs to change — the operator sees only this note.');
	}
	if (action === 'submit') {
		const missing = await assertPublishable(tenantId, id);
		if (missing.length) {
			throw new AppError('VALIDATION_ERROR', `This listing still needs ${missing.join(', ')}.`, { missing });
		}
	}

	const now = new Date();
	const reviewed = action === 'start_review' || action === 'approve' || action === 'request_changes';
	// Compare-and-set on the status we validated against. Two reviewers acting at once
	// would otherwise both pass the gate and both write, and the second would overwrite a
	// transition it never checked.
	const [updated] = await db()
		.update(schema.tours)
		.set({
			status: rule.to,
			// Resubmitting answers the note it was sent back with; leaving it attached
			// shows the next reviewer a complaint that has already been addressed.
			...(action === 'submit' ? { submittedAt: now, reviewNote: null } : {}),
			...(reviewed ? { reviewedAt: now, reviewedBy: actor.userId ?? null } : {}),
			...(action === 'approve' || action === 'request_changes' ? { reviewNote: note } : {}),
			...(action === 'publish' ? { publishedAt: now } : {}),
			updatedAt: now
		})
		.where(
			and(
				eq(schema.tours.id, id),
				eq(schema.tours.tenantId, tenantId),
				isNull(schema.tours.deletedAt),
				eq(schema.tours.status, tour.status)
			)
		)
		.returning();
	if (!updated) {
		throw new AppError(
			'CONFLICT',
			'Somebody else moved this listing while you were working on it. Reload and try again.'
		);
	}

	await audit(
		tenantId,
		rule.audit,
		auditActor(actor),
		{ type: 'tour', id },
		{ action, from: tour.status, to: rule.to, ...(note ? { note } : {}) }
	);
	return updated;
}
