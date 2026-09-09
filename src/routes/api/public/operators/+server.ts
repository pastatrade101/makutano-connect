// Every operator on the marketplace. The index behind /operators, which until now
// could only be reached one storefront at a time from a tour card.
import type { RequestHandler } from './$types';
import { listOperators } from '$lib/server/marketplace';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-operators', limit: 120 }, async () => {
		const items = await listOperators();
		return publicJson(items, CACHE_REFERENCE, { total: items.length });
	});

export const OPTIONS: RequestHandler = async (event) => preflight(event);
