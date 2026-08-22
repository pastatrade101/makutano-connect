import { error, fail, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { changeBookingStatus, getBookingDetail } from '$lib/server/bookings';
import { createPayment } from '$lib/server/payments';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'booking id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requirePermission(locals.permissions, 'bookings:read');
	try {
		const detail = await getBookingDetail(locals.tenant!.id, idOf(params));
		// §15: passport fields carry stricter access controls than the rest of a booking.
		const canSeeSensitive = locals.permissions.includes('travelers:read_sensitive');
		return {
			...detail,
			travelers: detail.travelers.map((t) =>
				canSeeSensitive ? t : { ...t, passportNumber: null, passportExpiry: null }
			),
			canSeeSensitive
		};
	} catch {
		error(404, 'Booking not found');
	}
};

export const actions: Actions = {
	status: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'bookings:write');
		const data = await request.formData();
		try {
			await changeBookingStatus(
				locals.tenant!.id,
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
			// Recording a payment recomputes the booking balance and may confirm it (§19).
			await createPayment(
				locals.tenant!.id,
				{
					bookingId: idOf(params),
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
