import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { changeTripStatus, getTripDetail, updateTrip } from '$lib/server/trips';
import { listAssignableMembers } from '$lib/server/team';
import { can } from '$lib/server/auth/permissions';
import { AppError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';
import type { Trip } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'trips:read');
	const tenantId = requireTenant(locals).id;
	const detail = await getTripDetail(tenantId, params.id);

	// Passports are gated on the trip exactly as they are on the booking. More
	// people see a trip than see a booking, so relaxing it here would quietly
	// widen who can read a customer's passport number.
	const sensitive = can(locals.permissions, 'travelers:read_sensitive');

	// Who a trip can be handed to. Anyone who can prepare one.
	const members = can(locals.permissions, 'trips:assign') ? await listAssignableMembers(tenantId) : [];

	// The same projection the public API applies. getTripDetail returns the whole
	// booking (subtotal, discount, tax, metadata) and the whole customer (email,
	// phone, notes); a trips:read holder gets the fact of a balance, not the sale.
	const commercial = can(locals.permissions, 'bookings:read');
	const booking = commercial
		? detail.booking
		: {
				id: detail.booking.id,
				bookingReference: detail.booking.bookingReference,
				status: detail.booking.status,
				currency: detail.booking.currency,
				balanceDue: detail.booking.balanceDue
			};
	const customer = !detail.customer
		? null
		: can(locals.permissions, 'customers:read')
			? detail.customer
			: { id: detail.customer.id, firstName: detail.customer.firstName, lastName: detail.customer.lastName };

	return {
		...detail,
		booking,
		customer,
		travelers: detail.travelers.map((t) =>
			sensitive ? t : { ...t, passportNumber: null, passportExpiry: null, dateOfBirth: null }
		),
		canWrite: can(locals.permissions, 'trips:write'),
		canAssign: can(locals.permissions, 'trips:assign'),
		canSeeSensitive: sensitive,
		// Already filtered to active members and shaped for the picker.
		members
	};
};

/** Turn a thrown AppError into a form failure rather than a 500 page. */
const asFailure = (error: unknown) =>
	error instanceof AppError
		? fail(400, { error: error.message })
		: fail(500, { error: 'Something went wrong. Please try again.' });

export const actions: Actions = {
	/** One action for every set-up field: the sheet posts only what it changed. */
	update: async ({ locals, params, request }) => {
		requireTenantPermission(locals, 'trips:write');
		const tenantId = requireTenant(locals).id;
		const form = await request.formData();

		const text = (k: string) => {
			const v = form.get(k);
			if (v === null) return undefined;
			const s = String(v).trim();
			return s.length ? s : null;
		};

		// Reassigning is a different act from editing set-up. The select is already
		// hidden without this permission; hidden is not authorization.
		if (form.has('operationsUserId')) requireTenantPermission(locals, 'trips:assign');

		const patch = {
			title: text('title') ?? undefined,
			vehicle: text('vehicle'),
			driver: text('driver'),
			guide: text('guide'),
			accommodation: text('accommodation'),
			notes: text('notes'),
			hotelConfirmed: form.has('hotelConfirmed') ? form.get('hotelConfirmed') === 'on' : undefined,
			operationsUserId: form.has('operationsUserId') ? text('operationsUserId') : undefined
		};

		try {
			await updateTrip(tenantId, params.id, patch, { userId: locals.user?.id });
			await audit(
				tenantId,
				'trip.updated',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'trip', id: params.id },
				{ after: patch }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	status: async ({ locals, params, request }) => {
		requireTenantPermission(locals, 'trips:write');
		const tenantId = requireTenant(locals).id;
		const form = await request.formData();
		const status = String(form.get('status') ?? '') as Trip['status'];
		const reason = String(form.get('reason') ?? '').trim() || undefined;

		try {
			await changeTripStatus(tenantId, params.id, status, { userId: locals.user?.id }, reason);
			await audit(
				tenantId,
				'trip.status_changed',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'trip', id: params.id },
				{ after: { status }, reason: reason ?? null }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	}
};
