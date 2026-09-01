// Published reviews for one tour. Nothing else ever leaves the server.
import { getPublishedTourBySlug } from '$lib/server/marketplace';
import { getPublicTourReviews } from '$lib/server/reviews';
import { AppError } from '$lib/server/errors';
import { CACHE_LISTING, handlePublic, pageMeta, preflight, publicJson, publicPagination } from '$lib/server/public-api';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-tour-reviews', limit: 120 }, async () => {
		// Resolved through the published tour, so an unpublished listing's reviews
		// are unreachable even by id.
		const detail = await getPublishedTourBySlug(event.params.slug ?? '');
		if (!detail) throw new AppError('NOT_FOUND', 'That tour could not be found.');

		const pagination = publicPagination(event.url);
		const { items, total, summary } = await getPublicTourReviews(detail.tour.id, pagination);
		return publicJson({ items, summary }, CACHE_LISTING, pageMeta(pagination.page, pagination.limit, total));
	});
