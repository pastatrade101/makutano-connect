// The public read layer — every page the marketplace website renders, and nothing else.
//
// NOT ONE FUNCTION HERE TAKES A tenantId, and that is the design rather than an
// oversight. Every caller is an anonymous browser: the visitor names a TOUR (a slug out
// of a URL) and the server derives who owns it from the row it finds. A public caller
// that could name a tenant could name somebody else's, which is how an enquiry meant
// for one operator ends up in a rival's inbox. resolveTourOwner is the one place that
// derivation happens, and it is the only thing the enquiry flow asks.
//
// Responses are assembled field by field, never spread out of a row. A tour carries
// reviewNote — a platform reviewer talking to a vendor about their listing — and a
// media row carries objectKey, the handle that can delete the object. Both are one
// careless `...row` away from a public page, so neither is ever selected here.
//
// As far as this module is concerned, unpublished rows do not exist. A draft slug
// returns null exactly like a slug nobody has ever used: anything that told the two
// apart would leak what each operator has in review, and when.
import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gte,
	ilike,
	inArray,
	isNull,
	lte,
	ne,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { mealsLabel, normaliseMeals } from '../tour-options';
import { accommodationsForTours, imagesForAccommodations, type TourStay } from './accommodations';
import {
	getOperatorReviewSummary,
	getTourReviewSummary,
	tourReviewSummaries,
	type ReviewSummary
} from './reviews';
import { db, schema } from './db';
import type { Pagination } from './http';

/* ------------------------------------------------------------- shapes ---- */

/**
 * A renderable image AND the credit it must be rendered with.
 *
 * attribution/license/sourceUrl are not decoration. The destination photography
 * is Wikimedia Commons material under CC BY / CC BY-SA, and those licences
 * require the credit to travel with the image. Carrying it in the same shape as
 * the URL is what makes it impossible to ship the picture without the credit.
 */
export type MediaRef = {
	url: string;
	altText: string | null;
	width: number | null;
	height: number | null;
	/**
	 * How many bytes the file is.
	 *
	 * A page that has a choice of photograph — the homepage hero picks one out of
	 * the featured listings — cannot make it well without knowing the cost. The
	 * spread between the lightest and heaviest hero on this marketplace is ten to
	 * one, and that difference is paid entirely by the first paint.
	 */
	bytes: number | null;
	attribution: string | null;
	license: string | null;
	sourceUrl: string | null;
};

export type CountryRef = { id: string; name: string; slug: string; isoCode: string | null };

export type CountryCard = CountryRef & {
	shortDescription: string | null;
	hero: MediaRef | null;
	tourCount: number;
};

export type CountryDetail = CountryRef & {
	shortDescription: string | null;
	description: string | null;
	seoTitle: string | null;
	seoDescription: string | null;
	hero: MediaRef | null;
};

export type DestinationRef = {
	id: string;
	name: string;
	slug: string;
	destinationType: schema.Destination['destinationType'];
	/** Numeric, not the numeric(9,6) strings postgres returns — this is drawn, not printed. */
	latitude: number | null;
	longitude: number | null;
	/** The basemap polygon to paint for this place. */
	mapRegion: string | null;
};

export type DestinationCard = DestinationRef & { shortDescription: string | null; hero: MediaRef | null };

export type DestinationListItem = DestinationCard & { country: CountryRef | null; tourCount: number };

export type DestinationDetail = DestinationCard & {
	/** The region that contains this place, for the map caption and the breadcrumb. */
	parent: { id: string; name: string; slug: string } | null;
	description: string | null;
	recommendedStayMin: number | null;
	recommendedStayMax: number | null;
	bestTimeSummary: string | null;
	highlights: string[];
	travelTips: string[];
	seoTitle: string | null;
	seoDescription: string | null;
};

/** Exactly what an operator card may say about a tenant, and not one field more. */
/** A category or a style, as a discovery card. They render identically. */
export type TaxonomyCard = {
	id: string;
	name: string;
	slug: string;
	shortDescription: string | null;
	hero: MediaRef | null;
	tourCount: number;
};

export type OperatorCard = {
	slug: string;
	displayName: string;
	location: string | null;
	about: string | null;
	specialties: string[];
	languages: string[];
	yearsInBusiness: number | null;
	isVerified: boolean;
	logo: MediaRef | null;
	cover: MediaRef | null;
	/*
	 * Contact the operator chose to publish. NULL means they did not, and the
	 * page must render nothing rather than falling back to the account's own
	 * details — those are operational and were never offered to the public.
	 */
	websiteUrl: string | null;
	publicEmail: string | null;
	publicPhone: string | null;
};

export type TourCard = {
	id: string;
	slug: string;
	title: string;
	/**
	 * Published reviews only, attached in one batched query for the whole page.
	 *
	 * `count: 0` is the honest state and the common one — no traveller has left a
	 * review yet, because submitting one was broken until it was fixed. The
	 * marketplace uses this to decide whether a rating filter is worth offering
	 * at all rather than showing an empty control.
	 */
	reviews?: ReviewSummary;
	shortDescription: string | null;
	durationDays: number;
	durationNights: number | null;
	priceFrom: string | null;
	currency: string | null;
	pricingType: string;
	travelStyle: string | null;
	groupType: string | null;
	featured: boolean;
	hero: MediaRef | null;
	country: CountryRef | null;
	operator: OperatorCard | null;
	/*
	 * What the card shows besides the picture: where the trip goes, what kind of
	 * trip it is, and how it is experienced. Destinations and styles are hydrated
	 * in a second pass rather than joined — a tour has many of each, and joining
	 * them would multiply every card row by destinations x styles.
	 */
	destinations: TaxonomyRef[];
	category: TaxonomyRef | null;
	styles: TaxonomyRef[];
};

/** Just enough of a related row to label it and link to it. */
export type TaxonomyRef = { name: string; slug: string };

export type TourDetail = {
	id: string;
	slug: string;
	title: string;
	shortDescription: string | null;
	description: string | null;
	durationDays: number;
	durationNights: number | null;
	priceFrom: string | null;
	currency: string | null;
	pricingType: string;
	travelStyle: string | null;
	groupType: string | null;
	groupSizeMin: number | null;
	groupSizeMax: number | null;
	ageRequirement: string | null;
	customisable: boolean;
	soloFriendly: boolean;
	startsAnyDay: boolean;
	accommodationSummary: string | null;
	transportSummary: string | null;
	mealsSummary: string | null;
	bestTimeSummary: string | null;
	availabilityType: string;
	availableFrom: string | null;
	availableTo: string | null;
	featured: boolean;
	highlights: string[];
	included: string[];
	excluded: string[];
	hero: MediaRef | null;
	seoTitle: string | null;
	seoDescription: string | null;
	publishedAt: Date | null;
	updatedAt: Date;
	/*
	 * The other two discovery axes. They were absent here while the marketplace's
	 * own copy of the type declared them, so `tour.category` on the detail page
	 * was quietly always undefined and no tour ever showed what kind of trip it
	 * was. Destinations already arrive as their own key on the response.
	 */
	category: TaxonomyRef | null;
	styles: TaxonomyRef[];
	/**
	 * What the traveller DOES — the fourth axis, beside where, what and how.
	 *
	 * On the detail only. Cards do not carry it: nothing filters on activities
	 * yet, and a key every card query must remember to supply is how a type
	 * starts describing something other than what the page receives.
	 */
	activities: TaxonomyRef[];
};

export type ItineraryDay = {
	id: string;
	dayNumber: number;
	title: string;
	description: string | null;
	destination: DestinationRef | null;
	accommodation: string | null;
	/** Set when the day names a directory property, so a page can link to it. */
	accommodationSlug: string | null;
	/**
	 * Photographs of where the night is spent — from the directory when the day
	 * points at a listed property, from the day's own urls when it does not. One
	 * field, because a page rendering a strip of pictures does not care which of
	 * the two it is looking at.
	 */
	accommodationImages: string[];
	/** A rendered sentence — "All meals", "Breakfast and dinner" — or null. */
	meals: string | null;
	/** The same fact as a closed set, for anything that has to filter or translate. */
	mealsIncluded: string[];
	activities: string[];
	distance: string | null;
	estimatedTravelTime: string | null;
	image: MediaRef | null;
	/**
	 * The day's own pin, for a stop that is not a canonical destination. The route
	 * uses this when set and the destination's coordinate otherwise, so a vendor
	 * can plot a camp without polluting the directory with it.
	 */
	latitude: number | null;
	longitude: number | null;
	/** DRIVE | FLY | BOAT, or null where the operator did not say. */
	travelMode: string | null;
};

export const TOUR_SORTS = ['recommended', 'price_asc', 'price_desc', 'duration', 'newest'] as const;
export type TourSort = (typeof TOUR_SORTS)[number];

export type TourFilters = {
	/**
	 * The tour's PRIMARY country — the one the operator sells it under. Deliberately
	 * not "visits a destination in this country": the count on the country card is
	 * derived the same way, and a filter that disagreed with the number next to it
	 * would show 40 tours behind a card that promised 31.
	 */
	countrySlug?: string;
	destinationSlug?: string;
	/** Product category, matched through tour_category_links. */
	categorySlug?: string;
	/** Travel style, matched through tour_travel_styles. */
	styleSlug?: string;
	/**
	 * Minimum average rating from PUBLISHED reviews, 1–5.
	 *
	 * A tour with no reviews is excluded rather than treated as zero: "4 stars and
	 * up" is a claim about what travellers said, and a tour nobody has reviewed
	 * has not earned a place in that list or been condemned to fail it.
	 */
	minRating?: number;
	/** @deprecated free-text column; use styleSlug. */
	travelStyle?: string;
	groupType?: string;
	/**
	 * How many people are travelling.
	 *
	 * Matched against the tour's own published group size. A NULL bound means
	 * "no limit stated", which passes — the alternative is hiding every listing
	 * whose operator has not filled the field in, which would make the filter
	 * look broken rather than permissive.
	 */
	travellers?: number;
	/**
	 * A date they want to travel, as YYYY-MM-DD.
	 *
	 * A YEAR_ROUND tour always matches; a seasonal or date-ranged one matches
	 * only inside its window. Same NULL rule as above: an unstated bound is not
	 * a closed door.
	 */
	date?: string;
	minDays?: number;
	maxDays?: number;
	priceMin?: number | string;
	priceMax?: number | string;
	featured?: boolean;
	search?: string;
	sort?: TourSort;
};

/* ------------------------------------------------------------ plumbing ---- */

// Media is joined several times in one query — a tour's hero and its operator's logo
// and cover are three different rows of the same table — so each join needs its own
// name. Aliasing everything, including the joins that would not strictly need it,
// keeps `media` from ever meaning two things in one statement.
const tourHero = alias(schema.media, 'tour_hero');
const countryHero = alias(schema.media, 'country_hero');
const destinationHero = alias(schema.media, 'destination_hero');
/** The region a destination sits in — destinations joined to themselves. */
const parentDestination = alias(schema.destinations, 'parent_destination');
const dayImage = alias(schema.media, 'day_image');
/** The directory property an itinerary day points at, when it points at one. */
const dayStay = alias(schema.accommodations, 'day_stay');
const galleryImage = alias(schema.media, 'gallery_image');
const operatorLogo = alias(schema.media, 'operator_logo');
const operatorCover = alias(schema.media, 'operator_cover');
const categoryHero = alias(schema.media, 'category_hero');
const styleHero = alias(schema.media, 'style_hero');

/** A public endpoint needs a ceiling. These are what the pages actually render. */
const DESTINATION_TOUR_LIMIT = 24;
const OPERATOR_TOUR_LIMIT = 60;
const RELATED_DESTINATION_LIMIT = 6;
const RELATED_TOUR_LIMIT = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only tours that exist publicly: approved AND live. */
const publishedTour = (): SQL => and(eq(schema.tours.status, 'PUBLISHED'), isNull(schema.tours.deletedAt)) as SQL;

type MediaSelection = {
	url: PgColumn;
	altText: PgColumn;
	width: PgColumn;
	height: PgColumn;
	size: PgColumn;
	attribution: PgColumn;
	license: PgColumn;
	sourceUrl: PgColumn;
};

/**
 * The media columns a page renders — and pointedly not `objectKey`, the handle
 * that can delete the object behind the URL.
 *
 * media.ts has publicMedia() for the same job, but it projects a whole row that has
 * already been read. Joining only these four columns means the private ones never
 * reach this process at all, which is a weaker thing to get wrong.
 *
 * The return type is spelled out as indexed accesses rather than left to inference:
 * without it TypeScript widens each column to the constraint, and drizzle then types
 * every joined image as `unknown`.
 */
const mediaColumns = <T extends MediaSelection>(
	t: T
): {
	url: T['url'];
	altText: T['altText'];
	width: T['width'];
	height: T['height'];
	size: T['size'];
	attribution: T['attribution'];
	license: T['license'];
	sourceUrl: T['sourceUrl'];
} => ({
	url: t.url,
	altText: t.altText,
	width: t.width,
	height: t.height,
	size: t.size,
	attribution: t.attribution,
	license: t.license,
	sourceUrl: t.sourceUrl
});

type JoinedMedia = {
	url: string | null;
	altText: string | null;
	width: number | null;
	height: number | null;
	size?: number | null;
	attribution?: string | null;
	license?: string | null;
	sourceUrl?: string | null;
} | null;

/**
 * postgres returns `numeric` as a string, to avoid silently losing precision on
 * values that do not fit a double. A coordinate is drawn, not accounted for, so
 * it is converted once here rather than at every call site that forgets to.
 */
const coord = (v: string | number | null | undefined): number | null =>
	v === null || v === undefined ? null : typeof v === 'number' ? v : Number(v);

const mediaOf = (m: JoinedMedia): MediaRef | null =>
	m?.url
		? {
				url: m.url,
				altText: m.altText,
				width: m.width,
				height: m.height,
				bytes: m.size ?? null,
				attribution: m.attribution ?? null,
				license: m.license ?? null,
				sourceUrl: m.sourceUrl ?? null
			}
		: null;

type JoinedCountry = { id: string | null; name: string | null; slug: string | null; isoCode: string | null } | null;

const countryRefOf = (c: JoinedCountry): CountryRef | null =>
	c?.id && c.name && c.slug ? { id: c.id, name: c.name, slug: c.slug, isoCode: c.isoCode } : null;

type JoinedOperator = {
	slug: string | null;
	displayName: string | null;
	location: string | null;
	about: string | null;
	specialties: string[] | null;
	languages: string[] | null;
	yearsInBusiness: number | null;
	isVerified: boolean | null;
	websiteUrl: string | null;
	publicEmail: string | null;
	publicPhone: string | null;
} | null;

const operatorCardOf = (o: JoinedOperator, logo: JoinedMedia, cover: JoinedMedia): OperatorCard | null =>
	o?.slug && o.displayName
		? {
				slug: o.slug,
				displayName: o.displayName,
				location: o.location,
				about: o.about,
				specialties: o.specialties ?? [],
				languages: o.languages ?? [],
				yearsInBusiness: o.yearsInBusiness,
				isVerified: o.isVerified ?? false,
				logo: mediaOf(logo),
				cover: mediaOf(cover),
				websiteUrl: o.websiteUrl,
				publicEmail: o.publicEmail,
				publicPhone: o.publicPhone
			}
		: null;

/**
 * Anything unrecognised is 'recommended' rather than an error: this reads a `?sort=`
 * straight off a URL, and a shared link with a stale sort key should still render the
 * page it was shared for.
 */
const sortOf = (value?: string | null): TourSort =>
	TOUR_SORTS.includes(value as TourSort) ? (value as TourSort) : 'recommended';

function tourOrder(sort: TourSort): SQL[] {
	// Every sort ends on the id. Without a total order two equally-priced tours come
	// back in whatever order Postgres happened to produce, and that order is not
	// stable between the page-1 and the page-2 query — the visitor then sees one tour
	// twice and never sees another at all.
	const stable = asc(schema.tours.id);
	switch (sort) {
		case 'price_asc':
			// Tours quoted "on request" have no priceFrom. They belong at the end of a
			// price sort in BOTH directions, which is not what Postgres does by default.
			return [sql`${schema.tours.priceFrom} asc nulls last`, stable];
		case 'price_desc':
			return [sql`${schema.tours.priceFrom} desc nulls last`, stable];
		case 'duration':
			return [asc(schema.tours.durationDays), stable];
		case 'newest':
			return [sql`${schema.tours.publishedAt} desc nulls last`, stable];
		default:
			// "Recommended" is an editorial ordering the PLATFORM controls — featured
			// first, then most recently published. It is deliberately not a popularity
			// score: nothing counts views yet, and inventing one would be a claim about
			// other travellers that is not true.
			return [desc(schema.tours.featured), sql`${schema.tours.publishedAt} desc nulls last`, stable];
	}
}

const filterLink = alias(schema.tourDestinations, 'filter_link');
const filterDestination = alias(schema.destinations, 'filter_destination');

/**
 * "this tour visits <slug>", as a predicate rather than a join.
 *
 * The page query and the count query must agree exactly, and a predicate goes into
 * both from one `conditions` array — a join would have to be remembered twice.
 */
const visitsDestination = (slug: string): SQL =>
	exists(
		db()
			.select({ one: sql`1` })
			.from(filterLink)
			.innerJoin(filterDestination, eq(filterDestination.id, filterLink.destinationId))
			.where(
				and(
					eq(filterLink.tourId, schema.tours.id),
					eq(filterDestination.slug, slug),
					eq(filterDestination.status, 'PUBLISHED')
				)
			)
	);

/**
 * One tour card, joined once and reused by every list on the site.
 *
 * The operator profile is joined on `isActive` rather than filtered afterwards: a
 * deactivated profile must not be shown, but the tour behind it is published by the
 * platform and stays on the marketplace. Making it an inner join would take approved
 * listings off the site as a side effect of an operator hiding their own page.
 */
/**
 * Category and style filters, built the same way as visitsDestination.
 *
 * EXISTS against the link table, never a text match on tours.travel_style. That
 * column is deprecated precisely because free text is how "Luxury", "luxury" and
 * "Luxury Safari" become three filters that each find a third of the inventory.
 */
const inCategory = (slug: string): SQL =>
	exists(
		db()
			.select({ one: sql`1` })
			.from(schema.tourCategoryLinks)
			.innerJoin(schema.tourCategories, eq(schema.tourCategories.id, schema.tourCategoryLinks.categoryId))
			.where(
				and(
					eq(schema.tourCategoryLinks.tourId, schema.tours.id),
					eq(schema.tourCategories.slug, slug),
					eq(schema.tourCategories.isActive, true)
				)
			)
	);

const hasStyle = (slug: string): SQL =>
	exists(
		db()
			.select({ one: sql`1` })
			.from(schema.tourTravelStyles)
			.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
			.where(
				and(
					eq(schema.tourTravelStyles.tourId, schema.tours.id),
					eq(schema.travelStyles.slug, slug),
					eq(schema.travelStyles.isActive, true)
				)
			)
	);

/* ------------------------------------------------------------- taxonomy --- */

/**
 * The places a given set of tours actually visits.
 *
 * Used by the category and style landing pages to answer "where do these trips
 * go" from the inventory itself, rather than guessing at a plausible list.
 */
export async function destinationsForTours(tourIds: string[]): Promise<DestinationCard[]> {
	if (!tourIds.length) return [];
	const rows = await db()
		.select({
			id: schema.destinations.id,
			name: schema.destinations.name,
			slug: schema.destinations.slug,
			destinationType: schema.destinations.destinationType,
			latitude: schema.destinations.latitude,
			longitude: schema.destinations.longitude,
			mapRegion: schema.destinations.mapRegion,
			shortDescription: schema.destinations.shortDescription,
			hero: mediaColumns(destinationHero),
			uses: sql<number>`count(*)::int`
		})
		.from(schema.tourDestinations)
		.innerJoin(schema.destinations, eq(schema.destinations.id, schema.tourDestinations.destinationId))
		.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
		.where(and(inArray(schema.tourDestinations.tourId, tourIds), eq(schema.destinations.status, 'PUBLISHED')))
		.groupBy(
			schema.destinations.id,
			schema.destinations.name,
			schema.destinations.slug,
			schema.destinations.destinationType,
			schema.destinations.shortDescription,
			destinationHero.id,
			destinationHero.url,
			destinationHero.altText,
			destinationHero.width,
			destinationHero.height
		)
		// Most-visited first: that IS the popularity signal for this set.
		.orderBy(desc(sql`count(*)`), asc(schema.destinations.name))
		.limit(12);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		destinationType: r.destinationType,
		latitude: coord(r.latitude),
		longitude: coord(r.longitude),
		mapRegion: r.mapRegion,
		shortDescription: r.shortDescription,
		hero: mediaOf(r.hero)
	}));
}

/** The five product categories. Small enough that all of them are normally shown. */
export async function listCategories(): Promise<TaxonomyCard[]> {
	const rows = await db()
		.select({
			id: schema.tourCategories.id,
			name: schema.tourCategories.name,
			slug: schema.tourCategories.slug,
			shortDescription: schema.tourCategories.shortDescription,
			hero: mediaColumns(categoryHero),
			tourCount: sql<number>`(
				select count(distinct l.tour_id)::int from tour_category_links l
				join tours t on t.id = l.tour_id
				where l.category_id = ${schema.tourCategories.id}
				  and t.status = 'PUBLISHED' and t.deleted_at is null
			)`
		})
		.from(schema.tourCategories)
		.leftJoin(categoryHero, eq(categoryHero.id, schema.tourCategories.heroMediaId))
		.where(eq(schema.tourCategories.isActive, true))
		.orderBy(asc(schema.tourCategories.sortOrder), asc(schema.tourCategories.name));
	return rows.map((r) => ({ ...r, hero: mediaOf(r.hero), tourCount: Number(r.tourCount ?? 0) }));
}

export async function listTravelStyles(featuredOnly = false): Promise<TaxonomyCard[]> {
	const conditions: SQL[] = [eq(schema.travelStyles.isActive, true)];
	if (featuredOnly) conditions.push(eq(schema.travelStyles.isFeatured, true));

	const rows = await db()
		.select({
			id: schema.travelStyles.id,
			name: schema.travelStyles.name,
			slug: schema.travelStyles.slug,
			shortDescription: schema.travelStyles.shortDescription,
			hero: mediaColumns(styleHero),
			tourCount: sql<number>`(
				select count(distinct l.tour_id)::int from tour_travel_styles l
				join tours t on t.id = l.tour_id
				where l.travel_style_id = ${schema.travelStyles.id}
				  and t.status = 'PUBLISHED' and t.deleted_at is null
			)`
		})
		.from(schema.travelStyles)
		.leftJoin(styleHero, eq(styleHero.id, schema.travelStyles.heroMediaId))
		.where(and(...conditions))
		.orderBy(asc(schema.travelStyles.sortOrder), asc(schema.travelStyles.name));
	return rows.map((r) => ({ ...r, hero: mediaOf(r.hero), tourCount: Number(r.tourCount ?? 0) }));
}

const tourCardQuery = () =>
	db()
		.select({
			tour: {
				id: schema.tours.id,
				slug: schema.tours.slug,
				title: schema.tours.title,
				shortDescription: schema.tours.shortDescription,
				durationDays: schema.tours.durationDays,
				durationNights: schema.tours.durationNights,
				priceFrom: schema.tours.priceFrom,
				currency: schema.tours.currency,
				pricingType: schema.tours.pricingType,
				travelStyle: schema.tours.travelStyle,
				groupType: schema.tours.groupType,
				customisable: schema.tours.customisable,
				soloFriendly: schema.tours.soloFriendly,
				startsAnyDay: schema.tours.startsAnyDay,
				featured: schema.tours.featured
			},
			country: {
				id: schema.countries.id,
				name: schema.countries.name,
				slug: schema.countries.slug,
				isoCode: schema.countries.isoCode
			},
			hero: mediaColumns(tourHero),
			category: { name: schema.tourCategories.name, slug: schema.tourCategories.slug },
			operator: {
				slug: schema.operatorProfiles.slug,
				displayName: schema.operatorProfiles.displayName,
				location: schema.operatorProfiles.location,
				about: schema.operatorProfiles.about,
				specialties: schema.operatorProfiles.specialties,
				languages: schema.operatorProfiles.languages,
				yearsInBusiness: schema.operatorProfiles.yearsInBusiness,
				isVerified: schema.operatorProfiles.isVerified,
				websiteUrl: schema.operatorProfiles.websiteUrl,
				publicEmail: schema.operatorProfiles.publicEmail,
				publicPhone: schema.operatorProfiles.publicPhone
			},
			logo: mediaColumns(operatorLogo),
			cover: mediaColumns(operatorCover)
		})
		.from(schema.tours)
		.leftJoin(
			schema.countries,
			and(eq(schema.countries.id, schema.tours.primaryCountryId), eq(schema.countries.isActive, true))
		)
		.leftJoin(tourHero, eq(tourHero.id, schema.tours.heroMediaId))
		// Many-to-one, so it can be joined straight into the card without fanning rows out.
		.leftJoin(schema.tourCategories, eq(schema.tourCategories.id, schema.tours.primaryCategoryId))
		.leftJoin(
			schema.operatorProfiles,
			and(eq(schema.operatorProfiles.tenantId, schema.tours.tenantId), eq(schema.operatorProfiles.isActive, true))
		)
		.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
		.leftJoin(operatorCover, eq(operatorCover.id, schema.operatorProfiles.coverMediaId));

type TourCardRow = Awaited<ReturnType<typeof tourCardQuery>>[number];

/**
 * Turn card rows into cards, with the many-valued relations filled in.
 *
 * Two extra queries for the whole page rather than two per card, and rows keep
 * their order. `toTourCard` alone would leave `destinations` and `styles` empty,
 * which is why nothing outside this file should call it: a card that renders no
 * places is a card that looks broken.
 */
async function hydrateTourCards(rows: TourCardRow[]): Promise<TourCard[]> {
	const cards = rows.map(toTourCard);
	if (!cards.length) return cards;
	const ids = cards.map((c) => c.id);

	const [destRows, styleRows] = await Promise.all([
		db()
			.select({
				tourId: schema.tourDestinations.tourId,
				name: schema.destinations.name,
				slug: schema.destinations.slug
			})
			.from(schema.tourDestinations)
			.innerJoin(schema.destinations, eq(schema.destinations.id, schema.tourDestinations.destinationId))
			// A destination pulled from the marketplace must vanish from the cards too,
			// exactly as it vanishes from the listings.
			.where(and(inArray(schema.tourDestinations.tourId, ids), eq(schema.destinations.status, 'PUBLISHED')))
			.orderBy(asc(schema.tourDestinations.sortOrder), asc(schema.destinations.name)),
		db()
			.select({
				tourId: schema.tourTravelStyles.tourId,
				name: schema.travelStyles.name,
				slug: schema.travelStyles.slug
			})
			.from(schema.tourTravelStyles)
			.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
			.where(and(inArray(schema.tourTravelStyles.tourId, ids), eq(schema.travelStyles.isActive, true)))
			.orderBy(asc(schema.travelStyles.name))
	]);

	const group = (rows: Array<{ tourId: string; name: string; slug: string }>) => {
		const by = new Map<string, TaxonomyRef[]>();
		for (const r of rows) {
			const list = by.get(r.tourId);
			if (list) list.push({ name: r.name, slug: r.slug });
			else by.set(r.tourId, [{ name: r.name, slug: r.slug }]);
		}
		return by;
	};
	const byDest = group(destRows);
	const byStyle = group(styleRows);
	// One query for the page, not one per card. tourReviewSummaries was written
	// for a listing and had no caller until now.
	const byReviews = await tourReviewSummaries(ids);

	for (const card of cards) {
		card.destinations = byDest.get(card.id) ?? [];
		card.styles = byStyle.get(card.id) ?? [];
		card.reviews = byReviews.get(card.id) ?? { average: null, count: 0, distribution: {} };
	}
	return cards;
}

const toTourCard = (row: TourCardRow): TourCard => ({
	id: row.tour.id,
	slug: row.tour.slug,
	title: row.tour.title,
	shortDescription: row.tour.shortDescription,
	durationDays: row.tour.durationDays,
	durationNights: row.tour.durationNights,
	priceFrom: row.tour.priceFrom,
	currency: row.tour.currency,
	pricingType: row.tour.pricingType,
	travelStyle: row.tour.travelStyle,
	groupType: row.tour.groupType,
	featured: row.tour.featured,
	hero: mediaOf(row.hero),
	country: countryRefOf(row.country),
	operator: operatorCardOf(row.operator, row.logo, row.cover),
	category: row.category?.slug ? { name: row.category.name, slug: row.category.slug } : null,
	// Filled in by hydrateTourCards; empty here so the shape is never undefined.
	destinations: [],
	styles: []
});

/* ----------------------------------------------------------- countries ---- */

/**
 * The countries the marketplace sells, each with the number of tours behind it.
 *
 * The count is part of the query rather than a second round trip because it is the
 * only thing that makes the card worth clicking, and a country with nothing published
 * behind it still belongs on the list — the page has editorial content of its own.
 */
export async function listCountries(): Promise<CountryCard[]> {
	const rows = await db()
		.select({
			id: schema.countries.id,
			name: schema.countries.name,
			slug: schema.countries.slug,
			isoCode: schema.countries.isoCode,
			shortDescription: schema.countries.shortDescription,
			hero: mediaColumns(countryHero),
			tourCount: sql<number>`count(${schema.tours.id})::int`
		})
		.from(schema.countries)
		.leftJoin(countryHero, eq(countryHero.id, schema.countries.heroMediaId))
		.leftJoin(schema.tours, and(eq(schema.tours.primaryCountryId, schema.countries.id), publishedTour()))
		.where(eq(schema.countries.isActive, true))
		.groupBy(schema.countries.id, countryHero.id)
		.orderBy(asc(schema.countries.name));

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		isoCode: r.isoCode,
		shortDescription: r.shortDescription,
		hero: mediaOf(r.hero),
		tourCount: Number(r.tourCount)
	}));
}

export async function getCountryBySlug(slug: string): Promise<{
	country: CountryDetail;
	destinations: DestinationListItem[];
	tourCount: number;
} | null> {
	const [row] = await db()
		.select({
			id: schema.countries.id,
			name: schema.countries.name,
			slug: schema.countries.slug,
			isoCode: schema.countries.isoCode,
			shortDescription: schema.countries.shortDescription,
			description: schema.countries.description,
			seoTitle: schema.countries.seoTitle,
			seoDescription: schema.countries.seoDescription,
			hero: mediaColumns(countryHero)
		})
		.from(schema.countries)
		.leftJoin(countryHero, eq(countryHero.id, schema.countries.heroMediaId))
		.where(and(eq(schema.countries.slug, slug), eq(schema.countries.isActive, true)))
		.limit(1);
	if (!row) return null;

	const [destinations, [{ value: tourCount }]] = await Promise.all([
		listDestinations({ countrySlug: slug }),
		db()
			.select({ value: count() })
			.from(schema.tours)
			.where(and(eq(schema.tours.primaryCountryId, row.id), publishedTour()))
	]);

	return {
		country: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			isoCode: row.isoCode,
			shortDescription: row.shortDescription,
			description: row.description,
			seoTitle: row.seoTitle,
			seoDescription: row.seoDescription,
			hero: mediaOf(row.hero)
		},
		destinations: destinations.items,
		tourCount: Number(tourCount)
	};
}

/* -------------------------------------------------------- destinations ---- */

/**
 * Published destinations, optionally within one country or of one kind.
 *
 * A destination in a deactivated country is not listed either: the country page it
 * would link to has already been taken down.
 */
export async function listDestinations(
	filters: { countrySlug?: string; type?: schema.Destination['destinationType'] } = {}
): Promise<{ items: DestinationListItem[]; total: number }> {
	const conditions: SQL[] = [eq(schema.destinations.status, 'PUBLISHED'), eq(schema.countries.isActive, true)];
	if (filters.countrySlug) conditions.push(eq(schema.countries.slug, filters.countrySlug));
	if (filters.type) conditions.push(eq(schema.destinations.destinationType, filters.type));

	const rows = await db()
		.select({
			id: schema.destinations.id,
			name: schema.destinations.name,
			slug: schema.destinations.slug,
			destinationType: schema.destinations.destinationType,
			latitude: schema.destinations.latitude,
			longitude: schema.destinations.longitude,
			mapRegion: schema.destinations.mapRegion,
			shortDescription: schema.destinations.shortDescription,
			hero: mediaColumns(destinationHero),
			country: {
				id: schema.countries.id,
				name: schema.countries.name,
				slug: schema.countries.slug,
				isoCode: schema.countries.isoCode
			},
			tourCount: sql<number>`count(distinct ${schema.tours.id})::int`
		})
		.from(schema.destinations)
		.innerJoin(schema.countries, eq(schema.countries.id, schema.destinations.countryId))
		.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
		.leftJoin(schema.tourDestinations, eq(schema.tourDestinations.destinationId, schema.destinations.id))
		.leftJoin(schema.tours, and(eq(schema.tours.id, schema.tourDestinations.tourId), publishedTour()))
		.where(and(...conditions))
		.groupBy(schema.destinations.id, schema.countries.id, destinationHero.id)
		.orderBy(asc(schema.countries.name), asc(schema.destinations.name));

	const items = rows.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		destinationType: r.destinationType,
		latitude: coord(r.latitude),
		longitude: coord(r.longitude),
		mapRegion: r.mapRegion,
		shortDescription: r.shortDescription,
		hero: mediaOf(r.hero),
		country: countryRefOf(r.country),
		tourCount: Number(r.tourCount)
	}));
	return { items, total: items.length };
}

const anchorLink = alias(schema.tourDestinations, 'anchor_link');
const siblingLink = alias(schema.tourDestinations, 'sibling_link');

/**
 * The places most often sold ALONGSIDE this one.
 *
 * Derived from tour_destinations rather than from geography, because "commonly
 * combined" is a fact about how operators actually build itineraries, not about what
 * is nearby. Tarangire and Ngorongoro are 150km apart and on half the same trips;
 * two parks on either side of the same border are on none. Picking country siblings
 * instead would produce a related-places rail that no itinerary supports.
 *
 * The strength is the number of PUBLISHED tours carrying both, which is also the
 * honest thing to print next to the name.
 */
async function relatedDestinationsFor(destination: {
	id: string;
	countryId: string;
}): Promise<Array<DestinationCard & { sharedTours: number }>> {
	const rows = await db()
		.select({
			id: schema.destinations.id,
			name: schema.destinations.name,
			slug: schema.destinations.slug,
			destinationType: schema.destinations.destinationType,
			latitude: schema.destinations.latitude,
			longitude: schema.destinations.longitude,
			mapRegion: schema.destinations.mapRegion,
			shortDescription: schema.destinations.shortDescription,
			hero: mediaColumns(destinationHero),
			sharedTours: sql<number>`count(distinct ${anchorLink.tourId})::int`
		})
		.from(anchorLink)
		.innerJoin(schema.tours, and(eq(schema.tours.id, anchorLink.tourId), publishedTour()))
		.innerJoin(
			siblingLink,
			and(eq(siblingLink.tourId, anchorLink.tourId), ne(siblingLink.destinationId, anchorLink.destinationId))
		)
		.innerJoin(
			schema.destinations,
			and(eq(schema.destinations.id, siblingLink.destinationId), eq(schema.destinations.status, 'PUBLISHED'))
		)
		.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
		.where(eq(anchorLink.destinationId, destination.id))
		.groupBy(schema.destinations.id, destinationHero.id)
		.orderBy(sql`count(distinct ${anchorLink.tourId}) desc`, asc(schema.destinations.name))
		.limit(RELATED_DESTINATION_LIMIT);

	if (rows.length) {
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			slug: r.slug,
			destinationType: r.destinationType,
			latitude: coord(r.latitude),
			longitude: coord(r.longitude),
			mapRegion: r.mapRegion,
			shortDescription: r.shortDescription,
			hero: mediaOf(r.hero),
			sharedTours: Number(r.sharedTours)
		}));
	}

	// Nothing has been sold with this place yet — a new destination, or a young
	// marketplace. Same-country siblings are the fallback so the rail is not empty on
	// day one; sharedTours is 0 rather than invented, so a caller can tell the two
	// apart and the page can stop saying "often combined with" when it is not true.
	const siblings = await db()
		.select({
			id: schema.destinations.id,
			name: schema.destinations.name,
			slug: schema.destinations.slug,
			destinationType: schema.destinations.destinationType,
			latitude: schema.destinations.latitude,
			longitude: schema.destinations.longitude,
			mapRegion: schema.destinations.mapRegion,
			shortDescription: schema.destinations.shortDescription,
			hero: mediaColumns(destinationHero)
		})
		.from(schema.destinations)
		.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
		.where(
			and(
				eq(schema.destinations.countryId, destination.countryId),
				eq(schema.destinations.status, 'PUBLISHED'),
				ne(schema.destinations.id, destination.id)
			)
		)
		.orderBy(asc(schema.destinations.name))
		.limit(RELATED_DESTINATION_LIMIT);

	return siblings.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		destinationType: r.destinationType,
		latitude: coord(r.latitude),
		longitude: coord(r.longitude),
		mapRegion: r.mapRegion,
		shortDescription: r.shortDescription,
		hero: mediaOf(r.hero),
		sharedTours: 0
	}));
}

export async function getDestinationBySlug(slug: string): Promise<{
	destination: DestinationDetail;
	country: CountryRef | null;
	tours: TourCard[];
	relatedDestinations: Array<DestinationCard & { sharedTours: number }>;
} | null> {
	const [row] = await db()
		.select({
			id: schema.destinations.id,
			countryId: schema.destinations.countryId,
			name: schema.destinations.name,
			slug: schema.destinations.slug,
			destinationType: schema.destinations.destinationType,
			latitude: schema.destinations.latitude,
			longitude: schema.destinations.longitude,
			mapRegion: schema.destinations.mapRegion,
			shortDescription: schema.destinations.shortDescription,
			description: schema.destinations.description,
			recommendedStayMin: schema.destinations.recommendedStayMin,
			recommendedStayMax: schema.destinations.recommendedStayMax,
			bestTimeSummary: schema.destinations.bestTimeSummary,
			highlights: schema.destinations.highlights,
			travelTips: schema.destinations.travelTips,
			seoTitle: schema.destinations.seoTitle,
			seoDescription: schema.destinations.seoDescription,
			hero: mediaColumns(destinationHero),
			country: {
				id: schema.countries.id,
				name: schema.countries.name,
				slug: schema.countries.slug,
				isoCode: schema.countries.isoCode
			},
			parent: {
				id: parentDestination.id,
				name: parentDestination.name,
				slug: parentDestination.slug,
				status: parentDestination.status
			}
		})
		.from(schema.destinations)
		// Inner, and on isActive: a destination whose country has been taken down has
		// no page to sit under, so it 404s with everything else that is not published.
		.innerJoin(
			schema.countries,
			and(eq(schema.countries.id, schema.destinations.countryId), eq(schema.countries.isActive, true))
		)
		.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
		.leftJoin(parentDestination, eq(parentDestination.id, schema.destinations.parentId))
		.where(and(eq(schema.destinations.slug, slug), eq(schema.destinations.status, 'PUBLISHED')))
		.limit(1);
	if (!row) return null;

	const [tourRows, relatedDestinations] = await Promise.all([
		// The first page of them. Everything past this belongs to the tour list, which
		// is paginated and can filter on the same destination.
		tourCardQuery()
			.where(and(publishedTour(), visitsDestination(slug)))
			.orderBy(...tourOrder('recommended'))
			.limit(DESTINATION_TOUR_LIMIT),
		relatedDestinationsFor({ id: row.id, countryId: row.countryId })
	]);

	return {
		destination: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			destinationType: row.destinationType,
			latitude: coord(row.latitude),
			longitude: coord(row.longitude),
			mapRegion: row.mapRegion,
			shortDescription: row.shortDescription,
			description: row.description,
			recommendedStayMin: row.recommendedStayMin,
			recommendedStayMax: row.recommendedStayMax,
			bestTimeSummary: row.bestTimeSummary,
			highlights: row.highlights ?? [],
			travelTips: row.travelTips ?? [],
			seoTitle: row.seoTitle,
			seoDescription: row.seoDescription,
			hero: mediaOf(row.hero),
			// Only when the region is itself published: an unpublished parent has no
			// page, and a breadcrumb to a 404 is worse than no breadcrumb.
			parent:
				row.parent?.id && row.parent.name && row.parent.slug && row.parent.status === 'PUBLISHED'
					? { id: row.parent.id, name: row.parent.name, slug: row.parent.slug }
					: null
		},
		country: countryRefOf(row.country),
		tours: await hydrateTourCards(tourRows),
		relatedDestinations
	};
}

/* --------------------------------------------------------------- tours ---- */

export async function listPublishedTours(
	p: Pagination,
	filters: TourFilters = {}
): Promise<{ items: TourCard[]; total: number }> {
	const conditions: SQL[] = [publishedTour()];
	if (filters.countrySlug) conditions.push(eq(schema.countries.slug, filters.countrySlug));
	if (filters.destinationSlug) conditions.push(visitsDestination(filters.destinationSlug));
	if (filters.categorySlug) conditions.push(inCategory(filters.categorySlug));
	if (filters.styleSlug) conditions.push(hasStyle(filters.styleSlug));
	if (filters.minRating && filters.minRating >= 1 && filters.minRating <= 5) {
		// Averaged over published reviews for THIS tour. EXISTS-style subquery
		// rather than a join, so a tour with many reviews is still one row.
		conditions.push(
			sql`(
				select avg(r.rating) from reviews r
				where r.tour_id = ${schema.tours.id}
					and r.status = 'PUBLISHED'
			) >= ${filters.minRating}` as SQL
		);
	}
	if (filters.travelStyle) conditions.push(eq(schema.tours.travelStyle, filters.travelStyle));
	if (filters.groupType) conditions.push(eq(schema.tours.groupType, filters.groupType));
	if (filters.travellers && Number.isFinite(filters.travellers)) {
		const n = Math.max(1, Math.trunc(filters.travellers));
		conditions.push(
			sql`(${schema.tours.groupSizeMin} is null or ${schema.tours.groupSizeMin} <= ${n})
				and (${schema.tours.groupSizeMax} is null or ${schema.tours.groupSizeMax} >= ${n})` as SQL
		);
	}
	if (filters.date) {
		conditions.push(
			sql`(${schema.tours.availabilityType} = 'YEAR_ROUND'
				or ((${schema.tours.availableFrom} is null or ${schema.tours.availableFrom}::date <= ${filters.date}::date)
					and (${schema.tours.availableTo} is null or ${schema.tours.availableTo}::date >= ${filters.date}::date)))` as SQL
		);
	}
	if (filters.minDays !== undefined) conditions.push(gte(schema.tours.durationDays, filters.minDays));
	if (filters.maxDays !== undefined) conditions.push(lte(schema.tours.durationDays, filters.maxDays));
	// priceFrom is a numeric column, which drizzle reads and writes as a string
	// precisely so a price never round-trips through a float. The bounds go in the
	// same way rather than as numbers.
	if (filters.priceMin !== undefined) conditions.push(gte(schema.tours.priceFrom, String(filters.priceMin)));
	if (filters.priceMax !== undefined) conditions.push(lte(schema.tours.priceFrom, String(filters.priceMax)));
	if (filters.featured) conditions.push(eq(schema.tours.featured, true));
	const term = filters.search?.trim() || p.q;
	if (term) {
		const like = `%${term}%`;
		conditions.push(or(ilike(schema.tours.title, like), ilike(schema.tours.shortDescription, like)) as SQL);
	}
	const where = and(...conditions);

	const [rows, [{ value: total }]] = await Promise.all([
		tourCardQuery()
			.where(where)
			.orderBy(...tourOrder(sortOf(filters.sort ?? p.sort)))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		// The country join is repeated only because countrySlug filters on it. It is
		// many-to-one, so it cannot change what count() returns.
		db()
			.select({ value: count() })
			.from(schema.tours)
			.leftJoin(
				schema.countries,
				and(eq(schema.countries.id, schema.tours.primaryCountryId), eq(schema.countries.isActive, true))
			)
			.where(where)
	]);

	return { items: await hydrateTourCards(rows), total: Number(total) };
}

const sharedLink = alias(schema.tourDestinations, 'shared_link');

/**
 * Other tours a visitor looking at this one would plausibly want.
 *
 * Ranked, never sampled: the same tour page must show the same rail on every load, or
 * a visitor who goes back cannot find the thing they nearly clicked. Shared
 * destinations first — two trips through Serengeti and Ngorongoro are genuinely
 * alternatives to each other — then the same travel style, then the platform's own
 * recommended order, and finally the id so ties never wobble.
 */
async function relatedToursFor(tour: {
	id: string;
	travelStyle: string | null;
	destinationIds: string[];
}): Promise<TourCard[]> {
	if (!tour.destinationIds.length && !tour.travelStyle) return [];

	const overlap = tour.destinationIds.length
		? and(eq(sharedLink.tourId, schema.tours.id), inArray(sharedLink.destinationId, tour.destinationIds))
		: sql`false`;

	const having = or(
		tour.destinationIds.length ? sql`count(${sharedLink.destinationId}) > 0` : undefined,
		tour.travelStyle ? eq(schema.tours.travelStyle, tour.travelStyle) : undefined
	);

	const order: SQL[] = [sql`count(${sharedLink.destinationId}) desc`];
	if (tour.travelStyle) order.push(sql`(${schema.tours.travelStyle} = ${tour.travelStyle}) desc nulls last`);
	order.push(desc(schema.tours.featured), sql`${schema.tours.publishedAt} desc nulls last`, asc(schema.tours.id));

	// Ranked first, hydrated second. Scoring and the card's five joins in one
	// statement would mean grouping by every joined key just to keep Postgres happy.
	const ranked = await db()
		.select({ id: schema.tours.id })
		.from(schema.tours)
		.leftJoin(sharedLink, overlap)
		.where(and(publishedTour(), ne(schema.tours.id, tour.id)))
		.groupBy(schema.tours.id)
		.having(having)
		.orderBy(...order)
		.limit(RELATED_TOUR_LIMIT);
	if (!ranked.length) return [];

	const ids = ranked.map((r) => r.id);
	const rows = await tourCardQuery().where(and(publishedTour(), inArray(schema.tours.id, ids)));
	const byId = new Map((await hydrateTourCards(rows)).map((c) => [c.id, c]));
	return ids.map((id) => byId.get(id)).filter((t): t is TourCard => !!t);
}

/**
 * The published trips that sleep at one property.
 *
 * Two ways a tour can name a place and both count: the whole-trip "where you
 * stay" list, and an individual itinerary night. A tour that names a lodge on
 * day three but never added it to the trip-level list is still a tour that stays
 * there, and a directory page that omitted it would be quietly wrong.
 *
 * Ranked and hydrated in two steps for the same reason relatedToursFor is:
 * scoring plus the card's five joins in one statement means grouping by every
 * joined key to keep Postgres happy.
 */
export async function publishedToursForAccommodation(accommodationId: string): Promise<TourCard[]> {
	const ranked = await db()
		.select({ id: schema.tours.id })
		.from(schema.tours)
		.where(
			and(
				publishedTour(),
				or(
					exists(
						db()
							.select({ one: sql`1` })
							.from(schema.tourAccommodations)
							.where(
								and(
									eq(schema.tourAccommodations.tourId, schema.tours.id),
									eq(schema.tourAccommodations.accommodationId, accommodationId)
								)
							)
					),
					exists(
						db()
							.select({ one: sql`1` })
							.from(schema.tourItineraryDays)
							.where(
								and(
									eq(schema.tourItineraryDays.tourId, schema.tours.id),
									eq(schema.tourItineraryDays.accommodationId, accommodationId)
								)
							)
					)
				)
			)
		)
		.orderBy(desc(schema.tours.featured), sql`${schema.tours.publishedAt} desc nulls last`, asc(schema.tours.id))
		.limit(12);
	if (!ranked.length) return [];

	const ids = ranked.map((r) => r.id);
	const rows = await tourCardQuery().where(and(publishedTour(), inArray(schema.tours.id, ids)));
	const byId = new Map((await hydrateTourCards(rows)).map((c) => [c.id, c]));
	return ids.map((id) => byId.get(id)).filter((t): t is TourCard => !!t);
}

/** How many published trips stay at each of these properties, in one query. */
export async function tourCountsForAccommodations(ids: string[]): Promise<Map<string, number>> {
	if (!ids.length) return new Map();
	const rows = (await db().execute(sql`
		select a.id::text as accommodation_id, count(distinct t.id)::int as tours
		from accommodations a
		join tours t on t.deleted_at is null and t.status = 'PUBLISHED' and (
			exists (select 1 from tour_accommodations ta where ta.tour_id = t.id and ta.accommodation_id = a.id)
			or exists (select 1 from tour_itinerary_days d where d.tour_id = t.id and d.accommodation_id = a.id)
		)
		where a.id in ${ids}
		group by a.id
	`)) as unknown as Array<{ accommodation_id: string; tours: number }>;
	return new Map(rows.map((r) => [r.accommodation_id, Number(r.tours)]));
}

export async function getPublishedTourBySlug(slug: string): Promise<{
	tour: TourDetail;
	country: CountryRef | null;
	destinations: DestinationCard[];
	itinerary: ItineraryDay[];
	gallery: MediaRef[];
	/** Where the traveller sleeps, directory properties and one-offs in one list. */
	stays: TourStay[];
	/**
	 * Published reviews only, computed at read time.
	 *
	 * Carried on the detail so a page can decide whether a reviews section exists
	 * at all without a second round trip — and so a tour with none renders an
	 * empty state rather than "0.0".
	 */
	reviews: ReviewSummary;
	operator: OperatorCard | null;
	route: DestinationRef[];
	relatedTours: TourCard[];
} | null> {
	const [row] = await db()
		.select({
			tour: {
				id: schema.tours.id,
				slug: schema.tours.slug,
				title: schema.tours.title,
				shortDescription: schema.tours.shortDescription,
				description: schema.tours.description,
				durationDays: schema.tours.durationDays,
				durationNights: schema.tours.durationNights,
				priceFrom: schema.tours.priceFrom,
				currency: schema.tours.currency,
				pricingType: schema.tours.pricingType,
				travelStyle: schema.tours.travelStyle,
				groupType: schema.tours.groupType,
				customisable: schema.tours.customisable,
				soloFriendly: schema.tours.soloFriendly,
				startsAnyDay: schema.tours.startsAnyDay,
				groupSizeMin: schema.tours.groupSizeMin,
				groupSizeMax: schema.tours.groupSizeMax,
				ageRequirement: schema.tours.ageRequirement,
				accommodationSummary: schema.tours.accommodationSummary,
				transportSummary: schema.tours.transportSummary,
				mealsSummary: schema.tours.mealsSummary,
				bestTimeSummary: schema.tours.bestTimeSummary,
				availabilityType: schema.tours.availabilityType,
				availableFrom: schema.tours.availableFrom,
				availableTo: schema.tours.availableTo,
				featured: schema.tours.featured,
				highlights: schema.tours.highlights,
				included: schema.tours.included,
				excluded: schema.tours.excluded,
				seoTitle: schema.tours.seoTitle,
				seoDescription: schema.tours.seoDescription,
				publishedAt: schema.tours.publishedAt,
				updatedAt: schema.tours.updatedAt
			},
			country: {
				id: schema.countries.id,
				name: schema.countries.name,
				slug: schema.countries.slug,
				isoCode: schema.countries.isoCode
			},
			hero: mediaColumns(tourHero),
			category: { name: schema.tourCategories.name, slug: schema.tourCategories.slug },
			operator: {
				slug: schema.operatorProfiles.slug,
				displayName: schema.operatorProfiles.displayName,
				location: schema.operatorProfiles.location,
				about: schema.operatorProfiles.about,
				specialties: schema.operatorProfiles.specialties,
				languages: schema.operatorProfiles.languages,
				yearsInBusiness: schema.operatorProfiles.yearsInBusiness,
				isVerified: schema.operatorProfiles.isVerified,
				websiteUrl: schema.operatorProfiles.websiteUrl,
				publicEmail: schema.operatorProfiles.publicEmail,
				publicPhone: schema.operatorProfiles.publicPhone
			},
			logo: mediaColumns(operatorLogo),
			cover: mediaColumns(operatorCover)
		})
		.from(schema.tours)
		.leftJoin(
			schema.countries,
			and(eq(schema.countries.id, schema.tours.primaryCountryId), eq(schema.countries.isActive, true))
		)
		.leftJoin(tourHero, eq(tourHero.id, schema.tours.heroMediaId))
		.leftJoin(schema.tourCategories, eq(schema.tourCategories.id, schema.tours.primaryCategoryId))
		.leftJoin(
			schema.operatorProfiles,
			and(eq(schema.operatorProfiles.tenantId, schema.tours.tenantId), eq(schema.operatorProfiles.isActive, true))
		)
		.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
		.leftJoin(operatorCover, eq(operatorCover.id, schema.operatorProfiles.coverMediaId))
		.where(and(eq(schema.tours.slug, slug), publishedTour()))
		.limit(1);
	if (!row) return null;

	const tourId = row.tour.id;

	// Styles are many per tour, so they are their own statement; the category is
	// one, and rides along on the join above.
	const [styleRows, activityRows] = await Promise.all([
		db()
			.select({ name: schema.travelStyles.name, slug: schema.travelStyles.slug })
			.from(schema.tourTravelStyles)
			.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
			.where(and(eq(schema.tourTravelStyles.tourId, tourId), eq(schema.travelStyles.isActive, true)))
			.orderBy(asc(schema.travelStyles.name)),
		db()
			.select({ name: schema.activities.name, slug: schema.activities.slug })
			.from(schema.tourActivities)
			.innerJoin(schema.activities, eq(schema.activities.id, schema.tourActivities.activityId))
			.where(and(eq(schema.tourActivities.tourId, tourId), eq(schema.activities.isActive, true)))
			.orderBy(asc(schema.tourActivities.sortOrder))
	]);

	const [destinationRows, itineraryRows, galleryRows] = await Promise.all([
		db()
			.select({
				id: schema.destinations.id,
				name: schema.destinations.name,
				slug: schema.destinations.slug,
				destinationType: schema.destinations.destinationType,
				latitude: schema.destinations.latitude,
				longitude: schema.destinations.longitude,
				mapRegion: schema.destinations.mapRegion,
				shortDescription: schema.destinations.shortDescription,
				hero: mediaColumns(destinationHero),
				sortOrder: schema.tourDestinations.sortOrder
			})
			.from(schema.tourDestinations)
			.innerJoin(
				schema.destinations,
				and(
					eq(schema.destinations.id, schema.tourDestinations.destinationId),
					eq(schema.destinations.status, 'PUBLISHED')
				)
			)
			.leftJoin(destinationHero, eq(destinationHero.id, schema.destinations.heroMediaId))
			.where(eq(schema.tourDestinations.tourId, tourId))
			.orderBy(asc(schema.tourDestinations.sortOrder), asc(schema.destinations.name)),
		db()
			.select({
				id: schema.tourItineraryDays.id,
				dayNumber: schema.tourItineraryDays.dayNumber,
				title: schema.tourItineraryDays.title,
				description: schema.tourItineraryDays.description,
				accommodation: schema.tourItineraryDays.accommodation,
				accommodationId: schema.tourItineraryDays.accommodationId,
				accommodationName: dayStay.name,
				accommodationSlug: dayStay.slug,
				accommodationImages: schema.tourItineraryDays.accommodationImages,
				meals: schema.tourItineraryDays.meals,
				mealsNote: schema.tourItineraryDays.mealsNote,
				activities: schema.tourItineraryDays.activities,
				distance: schema.tourItineraryDays.distance,
				estimatedTravelTime: schema.tourItineraryDays.estimatedTravelTime,
				latitude: schema.tourItineraryDays.latitude,
				longitude: schema.tourItineraryDays.longitude,
				travelMode: schema.tourItineraryDays.travelMode,
				image: mediaColumns(dayImage),
				destination: {
					id: schema.destinations.id,
					name: schema.destinations.name,
					slug: schema.destinations.slug,
					destinationType: schema.destinations.destinationType,
					latitude: schema.destinations.latitude,
					longitude: schema.destinations.longitude,
					mapRegion: schema.destinations.mapRegion
				}
			})
			.from(schema.tourItineraryDays)
			// The status test is in the ON clause, not the WHERE: a day pointing at a
			// destination that is not published keeps its own text and simply loses the
			// link, rather than dropping the day out of the itinerary entirely.
			.leftJoin(
				schema.destinations,
				and(
					eq(schema.destinations.id, schema.tourItineraryDays.destinationId),
					eq(schema.destinations.status, 'PUBLISHED')
				)
			)
			.leftJoin(dayImage, eq(dayImage.id, schema.tourItineraryDays.mediaId))
			// Same reasoning as the destination join above: a day whose property has
			// been deactivated keeps its day and falls back to the operator's own
			// words, rather than vanishing from the itinerary.
			.leftJoin(
				dayStay,
				and(
					eq(dayStay.id, schema.tourItineraryDays.accommodationId),
					eq(dayStay.isActive, true),
					isNull(dayStay.deletedAt)
				)
			)
			.where(eq(schema.tourItineraryDays.tourId, tourId))
			.orderBy(asc(schema.tourItineraryDays.dayNumber)),
		db()
			.select({ image: mediaColumns(galleryImage) })
			.from(schema.tourMedia)
			.innerJoin(galleryImage, eq(galleryImage.id, schema.tourMedia.mediaId))
			.where(eq(schema.tourMedia.tourId, tourId))
			.orderBy(asc(schema.tourMedia.sortOrder))
	]);

	const destinations: DestinationCard[] = destinationRows.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		destinationType: r.destinationType,
		latitude: coord(r.latitude),
		longitude: coord(r.longitude),
		mapRegion: r.mapRegion,
		shortDescription: r.shortDescription,
		hero: mediaOf(r.hero)
	}));

	// One query for every day's stay photographs, rather than one per day.
	const dayStayImages = await imagesForAccommodations(
		[...new Set(itineraryRows.map((r) => r.accommodationId).filter((id): id is string => Boolean(id)))]
	);

	const itinerary: ItineraryDay[] = itineraryRows.map((r) => ({
		id: r.id,
		dayNumber: r.dayNumber,
		title: r.title,
		description: r.description,
		destination:
			r.destination?.id && r.destination.name && r.destination.slug
				? {
						id: r.destination.id,
						name: r.destination.name,
						slug: r.destination.slug,
						destinationType: r.destination.destinationType,
						latitude: coord(r.destination.latitude),
						longitude: coord(r.destination.longitude),
						mapRegion: r.destination.mapRegion
					}
				: null,
		// The directory's name where the day points at one, the operator's own
		// words where it does not. One field, because a page showing both would
		// print the same lodge twice under two spellings — which is the problem
		// the directory exists to end.
		accommodation: r.accommodationName ?? r.accommodation,
		accommodationSlug: r.accommodationSlug,
		accommodationImages: r.accommodationId
			? (dayStayImages.get(r.accommodationId) ?? []).map((i) => i.url)
			: (r.accommodationImages ?? []),
		// Rendered once, here, so every consumer says it the same way rather than
		// each reimplementing the join.
		meals: mealsLabel(r.meals) ?? r.mealsNote,
		mealsIncluded: normaliseMeals(r.meals),
		activities: r.activities ?? [],
		distance: r.distance,
		estimatedTravelTime: r.estimatedTravelTime,
		image: mediaOf(r.image),
		latitude: coord(r.latitude),
		longitude: coord(r.longitude),
		travelMode: r.travelMode
	}));

	// Arusha → Tarangire → Serengeti, READ OFF the days the vendor already wrote.
	//
	// The route is the single most repeated element of a tour page and the one most
	// likely to be wrong if it is typed twice: an operator who moves day 4 to a
	// different park will fix the day and forget the summary, and the page then
	// contradicts itself. Nobody types it here at all.
	//
	// Only CONSECUTIVE repeats collapse. Three nights in the Serengeti are three days
	// but one stop, while a trip that starts and ends in Arusha genuinely passes
	// through it twice and the route should say so — de-duplicating globally would
	// erase the return leg.
	const route: DestinationRef[] = [];
	for (const day of itinerary) {
		if (!day.destination) continue;
		if (route[route.length - 1]?.id === day.destination.id) continue;
		route.push(day.destination);
	}

	const relatedTours = await relatedToursFor({
		id: tourId,
		travelStyle: row.tour.travelStyle,
		destinationIds: destinations.map((d) => d.id)
	});

	return {
		tour: {
			id: row.tour.id,
			slug: row.tour.slug,
			title: row.tour.title,
			shortDescription: row.tour.shortDescription,
			description: row.tour.description,
			durationDays: row.tour.durationDays,
			durationNights: row.tour.durationNights,
			priceFrom: row.tour.priceFrom,
			currency: row.tour.currency,
			pricingType: row.tour.pricingType,
			travelStyle: row.tour.travelStyle,
			groupType: row.tour.groupType,
			customisable: row.tour.customisable,
			soloFriendly: row.tour.soloFriendly,
			startsAnyDay: row.tour.startsAnyDay,
			groupSizeMin: row.tour.groupSizeMin,
			groupSizeMax: row.tour.groupSizeMax,
			ageRequirement: row.tour.ageRequirement,
			accommodationSummary: row.tour.accommodationSummary,
			transportSummary: row.tour.transportSummary,
			mealsSummary: row.tour.mealsSummary,
			bestTimeSummary: row.tour.bestTimeSummary,
			availabilityType: row.tour.availabilityType,
			availableFrom: row.tour.availableFrom,
			availableTo: row.tour.availableTo,
			featured: row.tour.featured,
			highlights: row.tour.highlights ?? [],
			included: row.tour.included ?? [],
			excluded: row.tour.excluded ?? [],
			hero: mediaOf(row.hero),
			seoTitle: row.tour.seoTitle,
			seoDescription: row.tour.seoDescription,
			publishedAt: row.tour.publishedAt,
			updatedAt: row.tour.updatedAt,
			category: row.category?.slug ? { name: row.category.name, slug: row.category.slug } : null,
			styles: styleRows.map((r) => ({ name: r.name, slug: r.slug })),
			activities: activityRows.map((r) => ({ name: r.name, slug: r.slug }))
		},
		country: countryRefOf(row.country),
		destinations,
		itinerary,
		gallery: galleryRows.map((r) => mediaOf(r.image)).filter((m): m is MediaRef => !!m),
		// Where the traveller sleeps, as the operator arranged it — directory
		// properties and one-off camps in one list, because a reader does not care
		// which of the two a lodge happens to be.
		stays: (await accommodationsForTours([tourId])).get(tourId) ?? [],
		reviews: await getTourReviewSummary(tourId),
		operator: operatorCardOf(row.operator, row.logo, row.cover),
		route,
		relatedTours
	};
}

/* ----------------------------------------------------------- operators ---- */

/**
 * An operator's own page.
 *
 * The operator object is the same OperatorCard a tour card carries and nothing more —
 * not even the profile's SEO columns. `operator_profiles` is the allow-list for a
 * tenant by construction, and the value of that only holds while there is exactly one
 * shape of it: the moment this page starts returning "the card, plus a couple of extra
 * fields", the next caller adds two more.
 */
export async function getOperatorBySlug(
	slug: string
): Promise<{ operator: OperatorCard; tours: TourCard[]; reviews: ReviewSummary } | null> {
	const [row] = await db()
		.select({
			// tenantId is read here and never returned: it is what scopes the tour list
			// below, derived from the profile row the slug resolved to rather than from
			// anything the caller said.
			tenantId: schema.operatorProfiles.tenantId,
			slug: schema.operatorProfiles.slug,
			displayName: schema.operatorProfiles.displayName,
			location: schema.operatorProfiles.location,
			about: schema.operatorProfiles.about,
			specialties: schema.operatorProfiles.specialties,
			languages: schema.operatorProfiles.languages,
			yearsInBusiness: schema.operatorProfiles.yearsInBusiness,
			isVerified: schema.operatorProfiles.isVerified,
			websiteUrl: schema.operatorProfiles.websiteUrl,
			publicEmail: schema.operatorProfiles.publicEmail,
			publicPhone: schema.operatorProfiles.publicPhone,
			logo: mediaColumns(operatorLogo),
			cover: mediaColumns(operatorCover)
		})
		.from(schema.operatorProfiles)
		.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
		.leftJoin(operatorCover, eq(operatorCover.id, schema.operatorProfiles.coverMediaId))
		.where(and(eq(schema.operatorProfiles.slug, slug), eq(schema.operatorProfiles.isActive, true)))
		.limit(1);
	if (!row) return null;

	const card = operatorCardOf(row, row.logo, row.cover);
	if (!card) return null;

	const tours = await tourCardQuery()
		.where(and(publishedTour(), eq(schema.tours.tenantId, row.tenantId)))
		.orderBy(...tourOrder('recommended'))
		.limit(OPERATOR_TOUR_LIMIT);

	return {
		operator: card,
		tours: await hydrateTourCards(tours),
		// Every published review this operator has, across every trip they run —
		// not the sum of one listing's. Computed at read time from published rows,
		// so hiding a review changes the number immediately.
		reviews: await getOperatorReviewSummary(row.tenantId)
	};
}

/* ----------------------------------------------------------- ownership ---- */

/**
 * Who owns this tour. THE ownership resolver, and the only one the public side has.
 *
 * A visitor sending an enquiry names a tour and nothing else. This turns that name
 * into the tenant the enquiry belongs to, so no public payload, query string or header
 * ever gets a say in whose inbox it lands — which is the whole reason the caller is
 * not allowed to pass a tenant in the first place.
 *
 * A tour that is not published has no owner as far as this is concerned. An enquiry
 * against a draft would both route mail from a listing nobody may see and confirm that
 * the listing exists, so an unpublished slug resolves to null exactly like a made-up
 * one.
 */
/**
 * Which tenant owns an operator storefront.
 *
 * The operator-page counterpart to `resolveTourOwner`, and it exists for the
 * same reason: an enquiry sent from a profile has to reach THAT operator, and
 * the browser is not allowed to say which tenant that is. It names a public
 * slug; the server answers with the tenant, or with nothing.
 *
 * Deliberately as strict as the tour path. `isActive` is checked because an
 * operator withdrawn from the marketplace should be as unreachable as a tour
 * that was never published — otherwise "unlist me" would still deliver leads.
 */
export async function resolveOperatorOwner(slug: string): Promise<{ operatorId: string; tenantId: string } | null> {
	const value = slug?.trim();
	if (!value) return null;

	const [row] = await db()
		.select({ operatorId: schema.operatorProfiles.id, tenantId: schema.operatorProfiles.tenantId })
		.from(schema.operatorProfiles)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.operatorProfiles.tenantId))
		.where(
			and(
				eq(schema.operatorProfiles.slug, value),
				eq(schema.operatorProfiles.isActive, true),
				// A suspended, cancelled or deleted tenant must not receive leads.
				//
				// Stated as an EXCLUSION, not as `status = 'ACTIVE'`. A tenant on a
				// free trial is 'TRIAL', and a self-signup awaiting billing is
				// 'PENDING' — both are real operators whose tours are published and
				// visible. Demanding 'ACTIVE' silently swallowed every enquiry to a
				// trialling operator, which is precisely the operator who most needs
				// the first one to arrive.
				isNull(schema.tenants.deletedAt),
				notInArray(schema.tenants.status, ['SUSPENDED', 'CANCELLED'])
			)
		)
		.limit(1);
	return row ?? null;
}

export async function resolveTourOwner(slugOrId: string): Promise<{ tourId: string; tenantId: string } | null> {
	const value = slugOrId?.trim();
	if (!value) return null;

	// Only test the id when the string could BE one: comparing a uuid column against
	// arbitrary text is a Postgres cast error, not a miss.
	const identity = UUID.test(value)
		? or(eq(schema.tours.slug, value), eq(schema.tours.id, value))
		: eq(schema.tours.slug, value);

	const [row] = await db()
		.select({ tourId: schema.tours.id, tenantId: schema.tours.tenantId })
		.from(schema.tours)
		.where(and(identity, publishedTour()))
		.limit(1);
	return row ?? null;
}

/**
 * What the marketplace currently holds, counted live.
 *
 * Exists so the signup page can say something true about the catalogue an
 * operator is joining. Hard-coding these numbers is how a page starts lying:
 * the count that was right the week it was written keeps being displayed long
 * after it stopped being right, and there is nothing in the codebase to notice.
 *
 * Returns null rather than zeros when the query fails. A signup form is more
 * important than the panel beside it, and "0 destinations" is a worse thing to
 * show a prospective operator than no number at all.
 */
export interface MarketplaceScale {
	journeys: number;
	destinations: number;
	stays: number;
	styles: number;
}

/*
 * Cached, because /signup is public and unauthenticated.
 *
 * Five counts on every render — including every render driven by a bot probing
 * the form — is a database round trip bought for nothing. The numbers move a
 * handful of times a week; a stale minute costs the reader nothing.
 */
let scaleCache: { at: number; value: MarketplaceScale | null } | null = null;
const SCALE_TTL_MS = 5 * 60 * 1000;

export async function marketplaceScale(): Promise<MarketplaceScale | null> {
	if (scaleCache && Date.now() - scaleCache.at < SCALE_TTL_MS) return scaleCache.value;

	try {
		const [journeys, destinations, stays, styles] = await Promise.all([
			db().select({ value: count() }).from(schema.tours).where(publishedTour()),
			db()
				.select({ value: count() })
				.from(schema.destinations)
				.where(eq(schema.destinations.status, 'PUBLISHED')),
			db()
				.select({ value: count() })
				.from(schema.accommodations)
				.where(eq(schema.accommodations.isActive, true)),
			db()
				.select({ value: count() })
				.from(schema.travelStyles)
				.where(eq(schema.travelStyles.isActive, true))
		]);

		const value: MarketplaceScale = {
			journeys: journeys[0]?.value ?? 0,
			destinations: destinations[0]?.value ?? 0,
			stays: stays[0]?.value ?? 0,
			styles: styles[0]?.value ?? 0
		};
		scaleCache = { at: Date.now(), value };
		return value;
	} catch {
		// Cached as null too, so a database that is down is not re-asked on
		// every request by a page that only wanted decoration.
		scaleCache = { at: Date.now(), value: null };
		return null;
	}
}
