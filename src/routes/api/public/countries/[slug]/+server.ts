// One country, with the destinations inside it. "Where can I go in this country?"
import type { RequestHandler } from './$types';
import { getCountryBySlug } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_REFERENCE, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-country', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const result = await getCountryBySlug(slug);
		// An inactive country and an unknown one answer identically.
		if (!result) throw new AppError('NOT_FOUND', 'Not found.');
		return publicJson(result, CACHE_REFERENCE);
	});

export const OPTIONS: RequestHandler = async () => preflight();
