// The public operator profile: who runs these tours. Built from operator_profiles,
// which exists so a tenant row — plan, billing, credentials — is never the thing
// being projected into a browser.
import type { RequestHandler } from './$types';
import { getOperatorBySlug } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, parseSlug, preflight, publicJson } from '$lib/server/public-api';

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-operator', limit: 240 }, async () => {
		const slug = parseSlug(event.params.slug);
		const result = await getOperatorBySlug(slug);
		if (!result) throw new AppError('NOT_FOUND', 'Not found.');
		return publicJson(result, CACHE_LISTING);
	});

export const OPTIONS: RequestHandler = async () => preflight();
