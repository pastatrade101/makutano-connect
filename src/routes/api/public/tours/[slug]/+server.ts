// One listing, with everything the tour page renders: itinerary, gallery, the
// derived route, the operator, and related tours.
import type { RequestHandler } from './$types';
import { getPublishedTourBySlug } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-tour', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const result = await getPublishedTourBySlug(slug);
		// A draft, a listing awaiting review and a slug that never existed all give
		// the same answer. Anything else would confirm that a private listing is there.
		if (!result) throw new AppError('NOT_FOUND', 'Not found.');
		return publicJson(result, CACHE_LISTING);
	});

export const OPTIONS: RequestHandler = async () => preflight();
