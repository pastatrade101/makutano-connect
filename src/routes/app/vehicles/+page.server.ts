// The fleet list. A registry an operator maintains, not a fleet-management system.
//
// Tracking state is read for the whole page in ONE provider call rather than one
// per row. A list that fans out to a GPS server is a list that stops loading
// when the GPS server does.
import { fail } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { toAppError } from '$lib/server/errors';
import { clearVehicleTracker, createVehicle, listVehicles, updateVehicle } from '$lib/server/vehicles';
import { fleetSnapshot, TRACKING_LABEL, trackingEnabled, type TrackingState } from '$lib/server/tracking';
import { db, schema } from '$lib/server/db';
import { and, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	const vehicles = await listVehicles(tenant.id);

	/*
	 * Live state for the whole fleet in ONE provider call.
	 *
	 * This used to read a cached last_fix_at column on the vehicle row — and
	 * nothing ever wrote that column, so every tracked vehicle reported "Tracker
	 * offline" while its position was seconds old. The cache was the right idea
	 * and the wrong half of it: there was no writer.
	 *
	 * Asking the provider directly is correct here because it is ONE request for
	 * the page however long the list is, not one per row. If the provider is slow
	 * or down the call returns UNAVAILABLE for each vehicle and the page still
	 * renders — a fleet list must never fail because a GPS server did.
	 */
	const live = trackingEnabled() ? await fleetSnapshot(tenant.id) : new Map();

	// Which vehicles are out on a trip right now. One query for the page, keyed on
	// the ids we already have, so an operator can see "On trip" without the list
	// asking the database once per row.
	const ids = vehicles.map((v) => v.id);
	const assigned = ids.length
		? await db()
				.select({
					vehicleId: schema.trips.vehicleId,
					tripId: schema.trips.id,
					reference: schema.trips.tripReference,
					status: schema.trips.status
				})
				.from(schema.trips)
				/*
				 * Every trip this vehicle is committed to and has not finished.
				 *
				 * This asked only for READY and IN_PROGRESS, which excluded PREPARING —
				 * the DEFAULT status, and where nearly every upcoming trip sits. So the
				 * trip page showed a vehicle assigned while this page said "Not
				 * assigned" about the same vehicle. Excluding COMPLETED and CANCELLED is
				 * the real requirement: a trip that ran last year still names its
				 * vehicle, and calling that vehicle busy months later would be wrong.
				 */
				.where(
					and(
						inArray(schema.trips.vehicleId, ids),
						inArray(schema.trips.status, ['PREPARING', 'READY', 'IN_PROGRESS'])
					)
				)
		: [];
	const onTrip = new Map(assigned.map((a) => [a.vehicleId as string, a]));

	return {
		trackingEnabled: trackingEnabled(),
		canWrite: locals.permissions.includes('vehicles:write'),
		vehicles: vehicles.map((v) => {
			const snap = live.get(v.id);
			// No tracker mapped is NOT_CONFIGURED, and so is a mapped tracker the
			// service could not answer for — it answers for every vehicle it is
			// given, so a gap here means unconfigured, never an outage.
			const state: TrackingState = !v.trackerDeviceRef ? 'NOT_CONFIGURED' : (snap?.state ?? 'NOT_CONFIGURED');
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
				// A BOOLEAN, never the reference. The reference is credential material:
				// anyone holding it can configure a phone to post positions as this
				// vehicle, it needs no Connect session to use, and it used to be sent
				// to every VIEWER and baked into the SSR payload, where it survives
				// screenshots, screen shares and offboarding.
				tracked: Boolean(v.trackerDeviceRef),
				trackingState: state,
				trackingLabel: TRACKING_LABEL[state],
				lastFixAt: snap?.position?.recordedAt ?? v.lastFixAt,
				// Enough of the fix for the card to say something useful without
				// opening a map: how fast, and where.
				speedKph: snap?.position?.speedKph ?? null,
				latitude: snap?.position?.latitude ?? null,
				longitude: snap?.position?.longitude ?? null,
				assignment: trip ? { tripId: trip.tripId, reference: trip.reference, status: trip.status } : null
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
			// Only ever CLEARS. No route accepts a tracker reference from a caller.
			await clearVehicleTracker(tenant.id, str(d, 'id'));
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
