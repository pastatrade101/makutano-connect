// One property, with every photograph we hold for it.
import { getAccommodationBySlug } from '$lib/server/accommodations';
import { publishedToursForAccommodation } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-stay', limit: 120 }, async () => {
		const detail = await getAccommodationBySlug(event.params.slug ?? '');
		// A deactivated property and a slug that never existed 404 the same way.
		if (!detail) throw new AppError('NOT_FOUND', 'That place could not be found.');

		// The way back into the catalogue: a lodge page that cannot tell you which
		// trips sleep there is a dead end, and this is a marketplace.
		const tours = await publishedToursForAccommodation(detail.id);
		return publicJson({ ...detail, tours }, CACHE_REFERENCE);
	});
