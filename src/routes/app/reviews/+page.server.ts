// The operator's reviews: read them, and answer them.
//
// There is no publish, hide, reject or delete action in this file, and that is
// the point. A review is the traveller's, and the only thing an operator owns
// is their reply — see PLATFORM_ONLY in auth/permissions.ts, which keeps
// `reviews:moderate` out of every tenant role including OWNER.
import { fail, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import { listTenantReviews, respondToReview } from '$lib/server/reviews';
import type { PageServerLoad } from './$types';

const TABS = ['all', 'published', 'awaiting'] as const;
type Tab = (typeof TABS)[number];

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'reviews:read');
	const raw = url.searchParams.get('tab') ?? 'all';
	const tab: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'all';

	const { items, total } = await listTenantReviews(requireTenant(locals).id, paginationFrom(url), {
		status: tab === 'published' ? 'PUBLISHED' : undefined,
		awaitingResponse: tab === 'awaiting'
	});
	return { items, total, tab, pagination: paginationFrom(url) };
};

export const actions: Actions = {
	respond: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'reviews:respond');
		const data = await request.formData();
		try {
			// The tenant comes from the authenticated session, never the form — a
			// posted review id from another tenant simply will not be found.
			await respondToReview(
				requireTenant(locals).id,
				String(data.get('reviewId') ?? ''),
				String(data.get('response') ?? ''),
				{ userId: locals.user?.id }
			);
			return { success: true, notice: 'Response published' };
		} catch (error) {
			return fail(400, { message: toAppError(error).message });
		}
	}
};
