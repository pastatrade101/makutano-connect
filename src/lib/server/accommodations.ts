// The accommodation directory: reading it, and attaching it to tours.
//
// Platform-owned, like countries and destinations. Nothing in this file takes a
// tenant id for a READ — a lodge is a place, and two operators selling the same
// camp see the same record. Writes that attach a property to a tour DO resolve
// the tour through the tenant first, because a link is a tenant's data even when
// the thing it points at is not.
import { and, asc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { accommodationLevelLabel, lodgeTypeLabel, normaliseBestFor } from '../tour-options';
import { AppError } from './errors';
import type { Pagination } from './http';

/** What a card needs: the name, and one picture. */
export type AccommodationCard = {
	id: string;
	name: string;
	slug: string;
	shortDescription: string | null;
	/** LUXURY | MID_RANGE | BUDGET, and the words for them. */
	level: string | null;
	levelLabel: string | null;
	lodgeType: string | null;
	lodgeTypeLabel: string | null;
	bestFor: string[];
	featured: boolean;
	destination: { id: string; name: string; slug: string } | null;
	country: { id: string; name: string; slug: string } | null;
	image: { url: string; altText: string | null } | null;
	imageCount: number;
};

export type AccommodationDetail = AccommodationCard & {
	/** Rich text (HTML) from the source system. */
	description: string | null;
	whyWeRecommend: string | null;
	websiteUrl: string | null;
	flyInAvailable: boolean;
	transferAvailable: boolean;
	images: { url: string; role: string | null; altText: string | null; caption: string | null; category: string | null }[];
};

/**
 * The picture to lead with.
 *
 * Roles come from the source export and are ranked rather than trusted blindly:
 * a property with no `hero` still has a `cover` or a `card`, and one with none of
 * those still has gallery photographs. Ordering by role then sort order means a
 * card is never blank while images exist.
 */
const ROLE_RANK = sql`case ${schema.accommodationImages.role}
	when 'hero' then 0
	when 'cover' then 1
	when 'card' then 2
	when 'hero_mobile' then 3
	else 4 end`;

const live = () => and(eq(schema.accommodations.isActive, true), isNull(schema.accommodations.deletedAt));

/** One query for the lead image of many properties, rather than one per card. */
async function leadImages(ids: string[]): Promise<Map<string, { url: string; altText: string | null }>> {
	if (!ids.length) return new Map();
	const rows = await db()
		.select({
			accommodationId: schema.accommodationImages.accommodationId,
			url: schema.accommodationImages.url,
			altText: schema.accommodationImages.altText
		})
		.from(schema.accommodationImages)
		.where(inArray(schema.accommodationImages.accommodationId, ids))
		.orderBy(ROLE_RANK, asc(schema.accommodationImages.sortOrder));
	const lead = new Map<string, { url: string; altText: string | null }>();
	for (const row of rows) {
		if (!lead.has(row.accommodationId)) lead.set(row.accommodationId, { url: row.url, altText: row.altText });
	}
	return lead;
}

async function imageCounts(ids: string[]): Promise<Map<string, number>> {
	if (!ids.length) return new Map();
	const rows = await db()
		.select({ id: schema.accommodationImages.accommodationId, value: sql<number>`count(*)::int` })
		.from(schema.accommodationImages)
		.where(inArray(schema.accommodationImages.accommodationId, ids))
		.groupBy(schema.accommodationImages.accommodationId);
	return new Map(rows.map((r) => [r.id, Number(r.value)]));
}

type Row = {
	id: string;
	name: string;
	slug: string;
	shortDescription: string | null;
	description: string | null;
	accommodationLevel: string | null;
	lodgeType: string | null;
	bestFor: string[] | null;
	isFeatured: boolean;
	whyWeRecommend: string | null;
	websiteUrl: string | null;
	flyInAvailable: boolean;
	transferAvailable: boolean;
	destinationId: string | null;
	destinationName: string | null;
	destinationSlug: string | null;
	countryId: string | null;
	countryName: string | null;
	countrySlug: string | null;
};

const selectRow = {
	id: schema.accommodations.id,
	name: schema.accommodations.name,
	slug: schema.accommodations.slug,
	shortDescription: schema.accommodations.shortDescription,
	description: schema.accommodations.description,
	accommodationLevel: schema.accommodations.accommodationLevel,
	lodgeType: schema.accommodations.lodgeType,
	bestFor: schema.accommodations.bestFor,
	isFeatured: schema.accommodations.isFeatured,
	whyWeRecommend: schema.accommodations.whyWeRecommend,
	websiteUrl: schema.accommodations.websiteUrl,
	flyInAvailable: schema.accommodations.flyInAvailable,
	transferAvailable: schema.accommodations.transferAvailable,
	destinationId: schema.destinations.id,
	destinationName: schema.destinations.name,
	destinationSlug: schema.destinations.slug,
	countryId: schema.countries.id,
	countryName: schema.countries.name,
	countrySlug: schema.countries.slug
};

const toCard = (
	row: Row,
	lead: Map<string, { url: string; altText: string | null }>,
	counts: Map<string, number>
): AccommodationCard => ({
	id: row.id,
	name: row.name,
	slug: row.slug,
	shortDescription: row.shortDescription,
	level: row.accommodationLevel,
	// Rendered here so every reader says "Mid-range", not MID_RANGE.
	levelLabel: accommodationLevelLabel(row.accommodationLevel),
	lodgeType: row.lodgeType,
	lodgeTypeLabel: lodgeTypeLabel(row.lodgeType),
	bestFor: normaliseBestFor(row.bestFor),
	featured: row.isFeatured,
	destination:
		row.destinationId && row.destinationName && row.destinationSlug
			? { id: row.destinationId, name: row.destinationName, slug: row.destinationSlug }
			: null,
	country:
		row.countryId && row.countryName && row.countrySlug
			? { id: row.countryId, name: row.countryName, slug: row.countrySlug }
			: null,
	image: lead.get(row.id) ?? null,
	imageCount: counts.get(row.id) ?? 0
});

export async function listAccommodations(
	p: Pagination,
	filters: { search?: string; destination?: string; country?: string; level?: string; lodgeType?: string } = {}
): Promise<{ items: AccommodationCard[]; total: number }> {
	const conditions: SQL[] = [live() as SQL];
	const term = filters.search?.trim() || p.q;
	if (term) conditions.push(ilike(schema.accommodations.name, `%${term}%`) as SQL);
	if (filters.destination) conditions.push(eq(schema.destinations.slug, filters.destination));
	if (filters.country) conditions.push(eq(schema.countries.slug, filters.country));
	if (filters.level) conditions.push(eq(schema.accommodations.accommodationLevel, filters.level));
	if (filters.lodgeType) conditions.push(eq(schema.accommodations.lodgeType, filters.lodgeType));
	const where = and(...conditions);

	const [rows, [{ value: total }]] = await Promise.all([
		db()
			.select(selectRow)
			.from(schema.accommodations)
			.leftJoin(schema.destinations, eq(schema.destinations.id, schema.accommodations.destinationId))
			.leftJoin(schema.countries, eq(schema.countries.id, schema.accommodations.countryId))
			.where(where)
			.orderBy(asc(schema.accommodations.sortOrder), asc(schema.accommodations.name))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db()
			.select({ value: sql<number>`count(*)::int` })
			.from(schema.accommodations)
			.leftJoin(schema.destinations, eq(schema.destinations.id, schema.accommodations.destinationId))
			.leftJoin(schema.countries, eq(schema.countries.id, schema.accommodations.countryId))
			.where(where)
	]);

	const ids = rows.map((r) => r.id);
	const [lead, counts] = await Promise.all([leadImages(ids), imageCounts(ids)]);
	return { items: rows.map((r) => toCard(r, lead, counts)), total: Number(total) };
}

export async function getAccommodationBySlug(slug: string): Promise<AccommodationDetail | null> {
	const [row] = await db()
		.select(selectRow)
		.from(schema.accommodations)
		.leftJoin(schema.destinations, eq(schema.destinations.id, schema.accommodations.destinationId))
		.leftJoin(schema.countries, eq(schema.countries.id, schema.accommodations.countryId))
		.where(and(live(), eq(schema.accommodations.slug, slug)))
		.limit(1);
	if (!row) return null;

	const images = await db()
		.select({
			url: schema.accommodationImages.url,
			role: schema.accommodationImages.role,
			altText: schema.accommodationImages.altText,
			caption: schema.accommodationImages.caption,
			category: schema.accommodationImages.category
		})
		.from(schema.accommodationImages)
		.where(eq(schema.accommodationImages.accommodationId, row.id))
		.orderBy(ROLE_RANK, asc(schema.accommodationImages.sortOrder));

	const lead = new Map(images.length ? [[row.id, { url: images[0].url, altText: images[0].altText }]] : []);
	return {
		...toCard(row, lead, new Map([[row.id, images.length]])),
		description: row.description,
		whyWeRecommend: row.whyWeRecommend,
		websiteUrl: row.websiteUrl,
		flyInAvailable: row.flyInAvailable,
		transferAvailable: row.transferAvailable,
		images
	};
}

/**
 * Several pictures for each of many properties, in one query.
 *
 * The lead image alone is enough for a card; an itinerary day showing where the
 * night is spent wants a strip. Capped per property so a lodge with forty
 * photographs cannot make one page carry forty.
 */
export async function imagesForAccommodations(
	ids: string[],
	perProperty = 4
): Promise<Map<string, { url: string; altText: string | null }[]>> {
	if (!ids.length) return new Map();
	const rows = await db()
		.select({
			accommodationId: schema.accommodationImages.accommodationId,
			url: schema.accommodationImages.url,
			altText: schema.accommodationImages.altText
		})
		.from(schema.accommodationImages)
		.where(inArray(schema.accommodationImages.accommodationId, ids))
		.orderBy(ROLE_RANK, asc(schema.accommodationImages.sortOrder));

	const byId = new Map<string, { url: string; altText: string | null }[]>();
	for (const row of rows) {
		const list = byId.get(row.accommodationId) ?? [];
		if (list.length < perProperty) list.push({ url: row.url, altText: row.altText });
		byId.set(row.accommodationId, list);
	}
	return byId;
}

/* ------------------------------------------------------------------ tours ---- */

/**
 * The stays attached to a tour, in the order the operator arranged them.
 *
 * Used by the composer (to show what is attached) and by the public tour page
 * (to show where the traveller sleeps), so it is one function rather than two
 * that drift.
 */
export type TourStay = {
	/** The link row's own id — a tour can carry several one-off stays. */
	id: string;
	/** Null for a one-off the operator typed rather than a directory property. */
	accommodationId: string | null;
	name: string;
	slug: string | null;
	shortDescription: string | null;
	/** "Mid-range", "Tented camp" — what kind of night this is. */
	levelLabel: string | null;
	lodgeTypeLabel: string | null;
	destination: { id: string; name: string; slug: string } | null;
	country: { id: string; name: string; slug: string } | null;
	image: { url: string; altText: string | null } | null;
	/** Up to four, whichever kind of stay this is — a strip, not a single crop. */
	images: string[];
	imageCount: number;
	nights: number | null;
	note: string | null;
	custom: boolean;
};

export async function accommodationsForTours(tourIds: string[]): Promise<Map<string, TourStay[]>> {
	if (!tourIds.length) return new Map();
	// LEFT join, not inner: a one-off stay has no directory row to join to, and an
	// inner join silently dropped exactly the entries an operator typed by hand.
	const rows = await db()
		.select({
			linkId: schema.tourAccommodations.id,
			tourId: schema.tourAccommodations.tourId,
			nights: schema.tourAccommodations.nights,
			note: schema.tourAccommodations.note,
			sortOrder: schema.tourAccommodations.sortOrder,
			customName: schema.tourAccommodations.customName,
			customImages: schema.tourAccommodations.customImages,
			...selectRow
		})
		.from(schema.tourAccommodations)
		.leftJoin(schema.accommodations, eq(schema.accommodations.id, schema.tourAccommodations.accommodationId))
		.leftJoin(schema.destinations, eq(schema.destinations.id, schema.accommodations.destinationId))
		.leftJoin(schema.countries, eq(schema.countries.id, schema.accommodations.countryId))
		.where(and(inArray(schema.tourAccommodations.tourId, tourIds), isNull(schema.accommodations.deletedAt)))
		.orderBy(asc(schema.tourAccommodations.sortOrder));

	const ids = rows.map((r) => r.id).filter((id): id is string => Boolean(id));
	const [lead, counts, strips] = await Promise.all([
		leadImages(ids),
		imageCounts(ids),
		imagesForAccommodations(ids)
	]);

	const byTour = new Map<string, TourStay[]>();
	for (const row of rows) {
		const custom = !row.id;
		const images = custom
			? (row.customImages ?? []).slice(0, 4)
			: (strips.get(row.id!) ?? []).map((i) => i.url);
		const card = row.id ? toCard(row as Row, lead, counts) : null;
		const list = byTour.get(row.tourId) ?? [];
		list.push({
			id: row.linkId,
			accommodationId: row.id ?? null,
			name: card?.name ?? row.customName ?? 'Unnamed stay',
			slug: card?.slug ?? null,
			shortDescription: card?.shortDescription ?? null,
			levelLabel: card?.levelLabel ?? null,
			lodgeTypeLabel: card?.lodgeTypeLabel ?? null,
			destination: card?.destination ?? null,
			country: card?.country ?? null,
			image: card?.image ?? (images[0] ? { url: images[0], altText: null } : null),
			images,
			imageCount: card?.imageCount ?? images.length,
			nights: row.nights,
			note: row.note,
			custom
		});
		byTour.set(row.tourId, list);
	}
	return byTour;
}

/**
 * Replace a tour's stays as one ordered list.
 *
 * The same shape as replaceItinerary and the taxonomy writers: the browser holds
 * the finished list, so this is a delete-and-insert inside one transaction
 * rather than a diff the caller has to compute.
 */
export type TourStayInput = {
	/** A directory property... */
	accommodationId?: string | null;
	/** ...or a name the operator typed, with its own pictures. Never both. */
	customName?: string | null;
	customImages?: string[];
	nights?: number | null;
	note?: string | null;
};

/**
 * Only http(s) urls, and nothing enormous.
 *
 * These strings are rendered as image sources on a public page, so a
 * `javascript:` or `data:` url here is a script tag with extra steps.
 */
const IMAGE_URL = /^https:\/\/[^\s"'<>]{3,600}$/i;

export async function setTourAccommodations(tourId: string, entries: TourStayInput[]): Promise<void> {
	const seen = new Set<string>();
	const rows: (typeof schema.tourAccommodations.$inferInsert)[] = [];

	for (const entry of entries) {
		const id = entry.accommodationId?.trim() || null;
		const name = entry.customName?.trim() || null;
		// A row must be one kind or the other; the column CHECK says so too, but
		// failing here names the problem instead of surfacing a constraint.
		if (id && name) throw new AppError('VALIDATION_ERROR', 'A stay is either a listed place or one you typed, not both.');
		if (!id && !name) continue;
		// The same lodge twice is a mistake, not a two-night stay — that is what
		// `nights` is for. One-off entries are not deduplicated: two different
		// private houses can legitimately share a name.
		if (id) {
			if (seen.has(id)) continue;
			seen.add(id);
		}

		const images = (entry.customImages ?? [])
			.map((url) => url.trim())
			.filter((url) => IMAGE_URL.test(url))
			.slice(0, 12);

		rows.push({
			tourId,
			accommodationId: id,
			customName: id ? null : name,
			customImages: id ? [] : images,
			sortOrder: rows.length,
			nights: entry.nights ?? null,
			note: entry.note?.trim() || null
		});
	}

	const linked = rows.map((r) => r.accommodationId).filter((id): id is string => Boolean(id));
	if (linked.length) {
		// Every id must exist and be live, or the insert fails on the foreign key
		// with a message nobody can act on. Checked here so the error names the
		// problem instead.
		const found = await db()
			.select({ id: schema.accommodations.id })
			.from(schema.accommodations)
			.where(and(live(), inArray(schema.accommodations.id, linked)));
		if (found.length !== linked.length) {
			throw new AppError('VALIDATION_ERROR', 'One of those places is no longer listed. Reload and try again.');
		}
	}

	await db().transaction(async (tx) => {
		await tx.delete(schema.tourAccommodations).where(eq(schema.tourAccommodations.tourId, tourId));
		if (rows.length) await tx.insert(schema.tourAccommodations).values(rows);
	});
}

/** The picker's options: every live property, smallest possible payload. */
export async function accommodationOptions(): Promise<{ id: string; name: string; slug: string }[]> {
	return db()
		.select({ id: schema.accommodations.id, name: schema.accommodations.name, slug: schema.accommodations.slug })
		.from(schema.accommodations)
		.where(live())
		.orderBy(asc(schema.accommodations.name));
}
