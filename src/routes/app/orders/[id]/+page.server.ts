import { error, fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { changeOrderStatus, getOrderDetail } from '$lib/server/orders';
import { createPayment } from '$lib/server/payments';
import {
	createPaymentRequest,
	isUsablePaymentMethod,
	methodInstructions,
	paymentMethods,
	paymentRequestTemplateReady,
	remindPaymentRequest,
	requestsForTransaction
} from '$lib/server/payment-requests';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'order id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'orders:read');
	try {
		const tenant = requireTenant(locals);
		const orderId = idOf(params);
		const [detail, paymentRequests, requestTemplateReady] = await Promise.all([
			getOrderDetail(tenant.id, orderId),
			requestsForTransaction(tenant.id, { orderId }),
			paymentRequestTemplateReady(tenant.id)
		]);
		const payMethods = paymentMethods(tenant.settings as Record<string, unknown>)
			.filter(isUsablePaymentMethod)
			.map((method) => ({ ...method, summary: methodInstructions(method) }));
		return { ...detail, paymentRequests, requestTemplateReady, payMethods };
	} catch {
		error(404, 'Order not found');
	}
};

export const actions: Actions = {
	requestPayment: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'payments:write');
		const data = await request.formData();
		try {
			const result = await createPaymentRequest(requireTenant(locals).id, {
				orderId: idOf(params),
				amount: String(data.get('amount') ?? '') || undefined,
				methodKey: String(data.get('methodKey') ?? '') || null,
				note: String(data.get('note') ?? '') || null,
				requestedByUserId: locals.user!.id
			});
			return {
				success: true,
				requested: {
					amount: result.request.amountRequested,
					currency: result.request.currency,
					reused: result.reused,
					notificationQueued: result.notificationQueued
				},
				...(!result.notificationQueued
					? {
							warning:
								'The request was recorded, but WhatsApp could not be queued. Check connection and compliance status.'
						}
					: {})
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	remindPayment: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'payments:write');
		const data = await request.formData();
		try {
			const queued = await remindPaymentRequest(
				requireTenant(locals).id,
				parseUuid(String(data.get('requestId') ?? ''), 'request id'),
				{ userId: locals.user!.id }
			);
			return queued
				? { success: true, reminded: true }
				: fail(400, { message: 'No approved payment reminder template is ready to send.' });
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	status: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const data = await request.formData();
		try {
			await changeOrderStatus(
				requireTenant(locals).id,
				idOf(params),
				String(data.get('status')) as never,
				{ userId: locals.user!.id },
				String(data.get('reason') ?? '') || undefined
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	payment: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'payments:write');
		const data = await request.formData();
		const amount = String(data.get('amount') ?? '');
		if (!/^\d+(\.\d{1,2})?$/.test(amount)) return fail(400, { message: 'Enter a valid amount.' });
		try {
			await createPayment(
				requireTenant(locals).id,
				{
					orderId: idOf(params),
					amount,
					provider: String(data.get('provider') ?? 'MANUAL'),
					description: String(data.get('description') ?? '') || null
				},
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
