// Published destinations, optionally narrowed to one country or one kind of place.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { listDestinations } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';

// The destination taxonomy, restated as an input allow-list so an unknown value
// is refused rather than reaching the query.
const TYPES = [
	'NATIONAL_PARK', 'GAME_RESERVE', 'CONSERVATION_AREA', 'MOUNTAIN', 'ISLAND',
	'BEACH', 'CITY', 'CULTURAL_AREA', 'LAKE', 'OTHER'
] as const;

const filterSchema = z.object({
	country: z.string().trim().max(120).optional(),
	type: z.enum(TYPES).optional()
});

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-destinations', limit: 120 }, async () => {
		const parsed = filterSchema.safeParse({
			country: event.url.searchParams.get('country') ?? undefined,
			type: event.url.searchParams.get('type') ?? undefined
		});
		if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid filter.');

		const { items, total } = await listDestinations({
			countrySlug: parsed.data.country,
			type: parsed.data.type
		});
		return publicJson(items, CACHE_REFERENCE, { total });
	});

export const OPTIONS: RequestHandler = async () => preflight();
