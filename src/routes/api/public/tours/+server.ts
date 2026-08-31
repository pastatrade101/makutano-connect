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
	style: z.string().trim().max(80).optional(),
	group: z.string().trim().max(80).optional(),
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
			travelStyle: f.style,
			groupType: f.group,
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
