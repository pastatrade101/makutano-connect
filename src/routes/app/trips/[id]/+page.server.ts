import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { changeTripStatus, getTripDetail, scopeFor, updateTrip } from '$lib/server/trips';
import { listAssignableMembers } from '$lib/server/team';
import { accommodationsForPicker, crewForPicker } from '$lib/server/crew';
import { can } from '$lib/server/auth/permissions';
import { AppError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';
import type { Trip } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'trips:read');
	const tenantId = requireTenant(locals).id;
	const scope = await scopeFor(tenantId, { userId: locals.user?.id, role: locals.role });
	const detail = await getTripDetail(tenantId, params.id, scope);

	// Passports are gated on the trip exactly as they are on the booking. More
	// people see a trip than see a booking, so relaxing it here would quietly
	// widen who can read a customer's passport number.
	const sensitive = can(locals.permissions, 'travelers:read_sensitive');

	// Who a trip can be handed to. Anyone who can prepare one.
	const [members, crew, accommodations] = await Promise.all([
		can(locals.permissions, 'trips:assign') ? listAssignableMembers(tenantId) : Promise.resolve([]),
		crewForPicker(tenantId),
		accommodationsForPicker(tenantId)
	]);

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
		members,
		// Who and what a trip can be assigned: the tenant's own crew list and the
		// accommodations in its catalog. Free text stays available — not every
		// driver is registered yet, and a trip must never be blocked on
		// bookkeeping somebody has not done.
		crew,
		accommodations
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

		// A registry pick and free text are mutually exclusive: the service clears
		// the link when free text arrives, so the trip never claims a registered
		// person it does not actually have.
		const pickId = (k: string) => (form.has(k) ? String(form.get(k) ?? '') || null : undefined);

		const patch = {
			driverCrewId: pickId('driverCrewId'),
			guideCrewId: pickId('guideCrewId'),
			specialistCrewId: pickId('specialistCrewId'),
			accommodationItemId: pickId('accommodationItemId'),
			title: text('title') ?? undefined,
			vehicle: text('vehicle'),
			driver: text('driver'),
			guide: text('guide'),
			specialist: text('specialist'),
			accommodation: text('accommodation'),
			notes: text('notes'),
			hotelConfirmed: form.has('hotelConfirmed') ? form.get('hotelConfirmed') === 'on' : undefined,
			operationsUserId: form.has('operationsUserId') ? text('operationsUserId') : undefined
		};

		try {
			const scope = await scopeFor(tenantId, { userId: locals.user?.id, role: locals.role });
			await updateTrip(tenantId, params.id, patch, { userId: locals.user?.id }, scope);
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
			const scope = await scopeFor(tenantId, { userId: locals.user?.id, role: locals.role });
			await changeTripStatus(tenantId, params.id, status, { userId: locals.user?.id }, reason, scope);
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
