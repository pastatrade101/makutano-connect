// Platform moderation. The only place a review's visibility can change.
//
// Guarded by the admin layout, which requires `locals.user.isSuperAdmin` — a
// property of the USER, never of a tenant membership. That is what stops an
// operator reaching this screen, and it is the same guard the rest of /admin
// uses rather than a second scheme invented here.
import { fail, type Actions } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { paginationFrom } from '$lib/server/http';
import { toAppError } from '$lib/server/errors';
import { listReviewsForModeration, moderateReview, MODERATION_REASONS, type ModerationAction } from '$lib/server/reviews';
import type { PageServerLoad } from './$types';

const STATUSES = ['PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED'] as const;
const ACTIONS: ModerationAction[] = ['publish', 'hide', 'reject', 'restore'];

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('status') ?? 'PENDING';
	const status = (STATUSES as readonly string[]).includes(raw) ? (raw as (typeof STATUSES)[number]) : 'PENDING';
	const { items, total } = await listReviewsForModeration(paginationFrom(url), { status });
	return { items, total, status, statuses: STATUSES, reasons: MODERATION_REASONS, pagination: paginationFrom(url) };
};

export const actions: Actions = {
	moderate: async ({ locals, request }) => {
		// Belt and braces over the layout guard: a form POST reaches this action
		// directly, and "the layout checked it" is not a thing an action can assume.
		if (!locals.user?.isSuperAdmin) error(403, 'This area is restricted.');
		const data = await request.formData();
		const action = String(data.get('action') ?? '') as ModerationAction;
		if (!ACTIONS.includes(action)) return fail(400, { message: 'Unknown action.' });

		try {
			await moderateReview(String(data.get('reviewId') ?? ''), action, {
				userId: locals.user.id,
				reason: String(data.get('reason') ?? '') || null
			});
			return { success: true, notice: `Review ${action === 'restore' ? 'restored' : `${action}ed`}` };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
