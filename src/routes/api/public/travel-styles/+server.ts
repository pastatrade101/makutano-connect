// HOW a traveller wants to experience Tanzania.
import type { RequestHandler } from './$types';
import { listTravelStyles } from '$lib/server/marketplace';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-styles', limit: 120 }, async () => {
		// The homepage wants the curated set; the discovery page wants all of them.
		const featuredOnly = event.url.searchParams.get('featured') === 'true';
		return publicJson(await listTravelStyles(featuredOnly), CACHE_REFERENCE);
	});

export const OPTIONS: RequestHandler = async () => preflight();
