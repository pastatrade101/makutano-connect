import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listPayments, paymentStats } from '$lib/server/payments';
import { paymentNotFound, reportedRequests, verifyPaymentRequest } from '$lib/server/payment-requests';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { fail, type Actions } from '@sveltejs/kit';
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
	return {
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
		try {
			const updated = await verifyPaymentRequest(
				requireTenant(locals).id,
				parseUuid(String(data.get('requestId') ?? ''), 'request id'),
				{
					amountReceived: String(data.get('amount') ?? '') || undefined,
					paymentReference: String(data.get('paymentReference') ?? '') || null,
					note: String(data.get('note') ?? '') || null,
					userId: locals.user!.id
				}
			);
			return { verified: { status: updated.status, received: updated.amountReceived, currency: updated.currency } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
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
