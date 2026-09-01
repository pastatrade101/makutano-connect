// The marketplace listing feed: PUBLISHED tours only, filtered and sorted the way
// the public site filters and sorts them.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { TOUR_SORTS, listPublishedTours } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, pageMeta, preflight, publicJson, publicPagination } from '$lib/server/public-api';

const filterSchema = z.object({
	country: z.string().trim().max(120).optional(),
	destination: z.string().trim().max(120).optional(),
	category: z.string().trim().max(120).optional(),
	style: z.string().trim().max(80).optional(),
	group: z.string().trim().max(80).optional(),
	/* Bounded: a party of forty is a coach tour, not a safari, and an unbounded
	   integer here is a free scan of the catalogue. */
	travellers: z.coerce.number().int().min(1).max(40).optional(),
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
		.optional(),
	minDays: z.coerce.number().int().min(1).max(365).optional(),
	maxDays: z.coerce.number().int().min(1).max(365).optional(),
	// Bounded so a price filter cannot be used to binary-search the catalogue at
	// absurd precision, and coerced through a string so no price meets a float.
	priceMin: z.coerce.number().min(0).max(10_000_000).optional(),
	priceMax: z.coerce.number().min(0).max(10_000_000).optional(),
	featured: z
		.enum(['true', 'false'])
		.transform((v) => v === 'true')
		.optional(),
	search: z.string().trim().max(120).optional(),
	sort: z.enum(TOUR_SORTS as unknown as [string, ...string[]]).optional()
});

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-tours', limit: 120 }, async () => {
		const raw = Object.fromEntries(event.url.searchParams.entries());
		const parsed = filterSchema.safeParse(raw);
		if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid filter.');

		const f = parsed.data;
		if (f.minDays !== undefined && f.maxDays !== undefined && f.minDays > f.maxDays) {
			throw new AppError('VALIDATION_ERROR', 'minDays cannot be greater than maxDays.');
		}

		const pagination = publicPagination(event.url);
		const { items, total } = await listPublishedTours(pagination as never, {
			countrySlug: f.country,
			destinationSlug: f.destination,
			categorySlug: f.category,
			/*
			 * The join table, and ONLY the join table.
			 *
			 * `travelStyle` was passed the same value, and it filters the legacy
			 * `tours.travel_style` TEXT column. The two conditions are ANDed, so a
			 * tour tagged through `tour_travel_styles` — every tour the composer
			 * creates — was excluded by a text column it never fills in.
			 * ?style=adventure returned nothing while ?category=safari worked.
			 *
			 * No live tour sets the text column; three rows use the join table.
			 */
			styleSlug: f.style,
			groupType: f.group,
			travellers: f.travellers,
			date: f.date,
			minDays: f.minDays,
			maxDays: f.maxDays,
			priceMin: f.priceMin,
			priceMax: f.priceMax,
			featured: f.featured,
			search: f.search,
			sort: f.sort as never
		});

		return publicJson(items, CACHE_LISTING, pageMeta(pagination.page, pagination.limit, total));
	});

export const OPTIONS: RequestHandler = async () => preflight();
