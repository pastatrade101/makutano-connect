// Published reviews for one operator — every trip they have run, not one listing.
import { resolveOperatorOwner } from '$lib/server/marketplace';
import { getPublicOperatorReviews } from '$lib/server/reviews';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, pageMeta, preflight, publicJson, publicPagination } from '$lib/server/public-api';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-operator-reviews', limit: 120 }, async () => {
		// The public names a slug; the server resolves who owns it. A tenant id is
		// never accepted from a caller.
		const owner = await resolveOperatorOwner(event.params.slug ?? '');
		if (!owner) throw new AppError('NOT_FOUND', 'That operator could not be found.');

		const pagination = publicPagination(event.url);
		const { items, total, summary } = await getPublicOperatorReviews(owner.tenantId, pagination);
		return publicJson({ items, summary }, CACHE_LISTING, pageMeta(pagination.page, pagination.limit, total));
	});
