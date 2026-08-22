import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { acceptQuotation, declineQuotation, getQuotationDetail, sendQuotation } from '$lib/server/quotations';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'quotation id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requirePermission(locals.permissions, 'quotations:read');
	try {
		return await getQuotationDetail(locals.tenant!.id, idOf(params));
	} catch {
		error(404, 'Quotation not found');
	}
};

export const actions: Actions = {
	send: async ({ locals, params }) => {
		requirePermission(locals.permissions, 'quotations:write');
		try {
			await sendQuotation(locals.tenant!.id, idOf(params), locals.user!.id);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	accept: async ({ locals, params }) => {
		// Converting a quotation creates a booking, so it needs booking-write rights (§16).
		requirePermission(locals.permissions, 'bookings:write');
		let bookingId: string;
		try {
			const result = await acceptQuotation(locals.tenant!.id, idOf(params), { userId: locals.user!.id });
			bookingId = result.booking.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, `/app/bookings/${bookingId}`);
	},

	decline: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'quotations:write');
		const data = await request.formData();
		try {
			await declineQuotation(locals.tenant!.id, idOf(params), String(data.get('reason') ?? '') || undefined);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
