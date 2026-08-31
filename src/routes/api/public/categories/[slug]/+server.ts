// One category, with the tours filed under it and the places they visit.
import type { RequestHandler } from './$types';
import { destinationsForTours, listCategories, listPublishedTours } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-category', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const category = (await listCategories()).find((c) => c.slug === slug);
		// An inactive category answers exactly like one that never existed.
		if (!category) throw new AppError('NOT_FOUND', 'Not found.');

		const { items } = await listPublishedTours({ page: 1, limit: 24 } as never, { categorySlug: slug });
		// The destinations these tours actually visit, most-visited first — read
		// from the inventory rather than guessed at.
		const destinations = await destinationsForTours(items.map((t) => t.id));

		return publicJson({ category, tours: items, destinations }, CACHE_LISTING);
	});

export const OPTIONS: RequestHandler = async () => preflight();
