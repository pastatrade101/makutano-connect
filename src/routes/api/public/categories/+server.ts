// WHAT kind of trip. Five broad product categories, platform-managed.
import type { RequestHandler } from './$types';
import { listCategories } from '$lib/server/marketplace';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-categories', limit: 120 }, async () =>
		publicJson(await listCategories(), CACHE_REFERENCE)
	);

export const OPTIONS: RequestHandler = async () => preflight();
