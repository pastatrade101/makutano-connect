// The accommodation directory, for anyone.
//
// Names and photographs of places people stay. Deliberately not filtered by
// tenant: a lodge is a place, and the marketplace shows one record for it
// however many operators sell it.
import { z } from 'zod';
import { listAccommodations } from '$lib/server/accommodations';
import { tourCountsForAccommodations } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_REFERENCE, handlePublic, pageMeta, preflight, publicJson, publicPagination } from '$lib/server/public-api';
import type { RequestHandler } from './$types';

const filterSchema = z.object({
	search: z.string().trim().max(120).optional(),
	destination: z.string().trim().max(120).optional(),
	country: z.string().trim().max(120).optional(),
	/* Closed lists, so an unknown value is a 400 rather than an empty page. */
	level: z.enum(['LUXURY', 'MID_RANGE', 'BUDGET']).optional(),
	lodgeType: z
		.enum(['SAFARI_LODGE', 'HOTEL', 'TENTED_CAMP', 'BEACH_RESORT', 'ECO_LODGE', 'BOUTIQUE_HOTEL'])
		.optional()
});

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-stays', limit: 120 }, async () => {
		const parsed = filterSchema.safeParse(Object.fromEntries(event.url.searchParams.entries()));
		if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid filter.');

		const pagination = publicPagination(event.url);
		const { items, total } = await listAccommodations(pagination, parsed.data);
		// One grouped query for the page, not one per card.
		const counts = await tourCountsForAccommodations(items.map((i) => i.id));
		return publicJson(
			items.map((item) => ({ ...item, tourCount: counts.get(item.id) ?? 0 })),
			CACHE_REFERENCE,
			pageMeta(pagination.page, pagination.limit, total)
		);
	});
