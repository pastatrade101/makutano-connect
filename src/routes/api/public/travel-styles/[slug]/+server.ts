// One travel style, with the tours tagged with it.
import type { RequestHandler } from './$types';
import { destinationsForTours, listPublishedTours, listTravelStyles } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-style', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const style = (await listTravelStyles()).find((s) => s.slug === slug);
		if (!style) throw new AppError('NOT_FOUND', 'Not found.');

		const { items } = await listPublishedTours({ page: 1, limit: 24 } as never, { styleSlug: slug });
		const destinations = await destinationsForTours(items.map((t) => t.id));

		return publicJson({ style, tours: items, destinations }, CACHE_LISTING);
	});

export const OPTIONS: RequestHandler = async () => preflight();
