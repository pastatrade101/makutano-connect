// One destination: why go, what is there, which tours visit it, and what it is
// commonly combined with. Never vendor pricing — that belongs to a tour.
import type { RequestHandler } from './$types';
import { getDestinationBySlug } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_REFERENCE, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-destination', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const result = await getDestinationBySlug(slug);
		// A DRAFT or ARCHIVED destination answers exactly like an unknown one.
		if (!result) throw new AppError('NOT_FOUND', 'Not found.');
		return publicJson(result, CACHE_REFERENCE);
	});

export const OPTIONS: RequestHandler = async () => preflight();
