import { error, fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { changeOrderStatus, getOrderDetail } from '$lib/server/orders';
import { createPayment } from '$lib/server/payments';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'order id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'orders:read');
	try {
		return await getOrderDetail(requireTenant(locals).id, idOf(params));
	} catch {
		error(404, 'Order not found');
	}
};

export const actions: Actions = {
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
				{ orderId: idOf(params), amount, provider: String(data.get('provider') ?? 'MANUAL'), description: String(data.get('description') ?? '') || null },
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
