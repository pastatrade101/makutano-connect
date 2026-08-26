import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listPayments, paymentStats } from '$lib/server/payments';
import {
	paymentNotFound,
	requestWithContext,
	reportedRequests,
	verifyPaymentRequest
} from '$lib/server/payment-requests';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'payments:read');
	const pagination = paginationFrom(url);
	const [{ items, total }, stats, reported] = await Promise.all([
		listPayments(requireTenant(locals).id, pagination, {
			status: (url.searchParams.get('status') || undefined) as never
		}),
		paymentStats(requireTenant(locals).id),
		reportedRequests(requireTenant(locals).id)
	]);
	const verifyId = url.searchParams.get('verify');

	// What did the money we just confirmed belong to? Whatever it was, that is where
	// the person should go next — the request itself is a receipt, not a destination.
	const verifiedId = url.searchParams.get('verified');
	const verified = verifiedId
		? ((await requestWithContext(requireTenant(locals).id, verifiedId).catch(() => null)) ?? null)
		: null;

	return {
		verified,
		items,
		total,
		pagination,
		stats,
		reported:
			verifyId && verifyId !== '1'
				? [...reported].sort((a, b) => Number(b.request.id === verifyId) - Number(a.request.id === verifyId))
				: reported,
		verifyId: verifyId && verifyId !== '1' && reported.some((row) => row.request.id === verifyId) ? verifyId : null
	};
};

export const actions: Actions = {
	/** §12: staff confirms money actually arrived — the only path to PAID. */
	confirmRequest: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'payments:verify');
		const data = await request.formData();
		let verifiedId = '';
		try {
			const requestId = parseUuid(String(data.get('requestId') ?? ''), 'request id');
			const updated = await verifyPaymentRequest(requireTenant(locals).id, requestId, {
				amountReceived: String(data.get('amount') ?? '') || undefined,
				paymentReference: String(data.get('paymentReference') ?? '') || null,
				note: String(data.get('note') ?? '') || null,
				userId: locals.user!.id
			});
			verifiedId = requestId;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		// Verified money is a hand-off, not a full stop: the URL carries which request
		// was confirmed so the page can point at the order or booking it belongs to —
		// and still do so after a refresh.
		redirect(303, `/app/payments?verified=${verifiedId}`);
	},

	/** §13: not found — back to outstanding, never punitive. */
	requestNotFound: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'payments:verify');
		const data = await request.formData();
		try {
			await paymentNotFound(requireTenant(locals).id, parseUuid(String(data.get('requestId') ?? ''), 'request id'), {
				userId: locals.user!.id
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
