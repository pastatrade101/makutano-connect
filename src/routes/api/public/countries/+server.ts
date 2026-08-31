// Every country the marketplace sells into. Platform reference data — no tenant
// is involved in reading it, and none can be named by the caller.
import type { RequestHandler } from './$types';
import { listCountries } from '$lib/server/marketplace';
import { CACHE_REFERENCE, handlePublic, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-countries', limit: 120 }, async () =>
		publicJson(await listCountries(), CACHE_REFERENCE)
	);

export const OPTIONS: RequestHandler = async () => preflight();
