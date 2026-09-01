// The traveller's own review, reached by the token in their invitation.
//
// The token IS the credential — there is no traveller login in this product —
// so this route is deliberately narrow: one review, never listable, never
// cached, and it returns nothing about the tenant, the customer record or the
// booking beyond what the traveller already knows about their own trip.
import { z } from 'zod';
import { getOwnReview, submitReview, updateCustomerReview } from '$lib/server/reviews';
import { AppError } from '$lib/server/errors';
import { handlePublic, preflight, publicJson } from '$lib/server/public-api';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	rating: z.coerce.number().int().min(1).max(5),
	title: z.string().trim().max(120).optional().nullable(),
	body: z.string().trim().min(1).max(4000)
});

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	// Rate-limited hard: a token is 40 hex characters, and this is the one public
	// route where guessing would be worth something.
	handlePublic(event, { scope: 'pub-review', limit: 30 }, async () => {
		const review = await getOwnReview(event.params.token ?? '');
		if (!review) throw new AppError('NOT_FOUND', 'That review link is not valid.');
		return publicJson(review, 'no-store');
	});

export const POST: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-review-write', limit: 10 }, async () => {
		const raw = await event.request.json().catch(() => null);
		const parsed = bodySchema.safeParse(raw);
		if (!parsed.success) {
			throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the review and try again.');
		}
		await submitReview(event.params.token ?? '', parsed.data);
		// Deliberately returns the traveller's own view, which says PENDING. The
		// page must never tell somebody their words are live when they are not.
		return publicJson(await getOwnReview(event.params.token ?? ''), 'no-store');
	});

export const PATCH: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-review-write', limit: 10 }, async () => {
		const raw = await event.request.json().catch(() => null);
		const parsed = bodySchema.safeParse(raw);
		if (!parsed.success) {
			throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the review and try again.');
		}
		await updateCustomerReview(event.params.token ?? '', parsed.data);
		return publicJson(await getOwnReview(event.params.token ?? ''), 'no-store');
	});
