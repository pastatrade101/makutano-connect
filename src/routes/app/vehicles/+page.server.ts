// The fleet list. A registry an operator maintains, not a fleet-management system.
//
// Tracking state is read for the whole page in ONE pass rather than per row, and
// it is read from the cached last fix on the vehicle row — never by calling the
// provider once per vehicle. A list that fans out to a GPS server is a list that
// stops loading when the GPS server does.
import { fail } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { toAppError } from '$lib/server/errors';
import { createVehicle, listVehicles, setVehicleTracker, updateVehicle } from '$lib/server/vehicles';
import { stateForAge, TRACKING_LABEL, trackingEnabled } from '$lib/server/tracking';
import { db, schema } from '$lib/server/db';
import { and, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	const vehicles = await listVehicles(tenant.id);

	// Which vehicles are out on a trip right now. One query for the page, keyed on
	// the ids we already have, so an operator can see "On trip" without the list
	// asking the database once per row.
	const ids = vehicles.map((v) => v.id);
	const assigned = ids.length
		? await db()
				.select({ vehicleId: schema.trips.vehicleId, tripId: schema.trips.id, reference: schema.trips.tripReference })
				.from(schema.trips)
				// Only trips actually running or about to. A COMPLETED trip still names
				// its vehicle, and saying that vehicle is "on trip" months later would
				// be wrong.
				.where(and(inArray(schema.trips.vehicleId, ids), inArray(schema.trips.status, ['READY', 'IN_PROGRESS'])))
		: [];
	const onTrip = new Map(assigned.map((a) => [a.vehicleId as string, a]));

	return {
		trackingEnabled: trackingEnabled(),
		canWrite: locals.permissions.includes('vehicles:write'),
		vehicles: vehicles.map((v) => {
			// Derived from the cached fix, so the list never waits on a third party.
			const state = v.trackerDeviceRef ? stateForAge(v.lastFixAt) : 'NOT_CONFIGURED';
			const trip = onTrip.get(v.id);
			return {
				id: v.id,
				name: v.name,
				registration: v.registration,
				make: v.make,
				model: v.model,
				type: v.type,
				seats: v.seats,
				isActive: v.isActive,
				tracked: Boolean(v.trackerDeviceRef),
				trackerDeviceRef: v.trackerDeviceRef,
				trackingState: state,
				trackingLabel: TRACKING_LABEL[state],
				lastFixAt: v.lastFixAt,
				assignment: trip ? { tripId: trip.tripId, reference: trip.reference } : null
			};
		})
	};
};

const str = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'vehicles:write');
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		const d = await request.formData();
		try {
			await createVehicle(tenant.id, {
				name: str(d, 'name'),
				registration: str(d, 'registration') || null,
				make: str(d, 'make') || null,
				model: str(d, 'model') || null,
				type: str(d, 'type') || null,
				seats: Number(d.get('seats')) || null
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	update: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'vehicles:write');
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		const d = await request.formData();
		try {
			await updateVehicle(tenant.id, str(d, 'id'), {
				name: str(d, 'name'),
				registration: str(d, 'registration') || null,
				make: str(d, 'make') || null,
				model: str(d, 'model') || null,
				seats: Number(d.get('seats')) || null
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Map or clear the tracker. The operator supplies only the device reference. */
	tracker: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'vehicles:write');
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		const d = await request.formData();
		try {
			await setVehicleTracker(tenant.id, str(d, 'id'), { deviceRef: str(d, 'deviceRef') || null });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	setActive: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'vehicles:write');
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		const d = await request.formData();
		try {
			// Deactivated, never deleted — a trip that ran last year still names it.
			await updateVehicle(tenant.id, str(d, 'id'), { isActive: str(d, 'active') === 'true' });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
