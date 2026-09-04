// The tenant's fleet, with live tracking state — for the app's vehicle switcher.
//
// An operator tracks a fleet, not one trip, so the map needs to offer every
// vehicle this tenant owns. Ownership is resolved server-side from the session:
// the app never names a tenant, never sends a vehicle filter, and never receives
// a tracker reference.
//
// ONE provider call for the whole list, scoped by the provider to this tenant's
// own devices. A list that fans out per row is a list that stops loading when a
// GPS server slows down.
import type { RequestHandler } from './$types';
import { listVehicles } from '$lib/server/vehicles';
import { fleetSnapshot, TRACKING_LABEL, trackingEnabled, type TrackingState } from '$lib/server/tracking';
import { db, schema } from '$lib/server/db';
import { and, inArray } from 'drizzle-orm';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'vehicles:read');

		const vehicles = await listVehicles(viewer.tenantId);
		const live = trackingEnabled() ? await fleetSnapshot(viewer.tenantId) : new Map();

		const ids = vehicles.map((v) => v.id);
		const assigned = ids.length
			? await db()
					.select({
						vehicleId: schema.trips.vehicleId,
						tripId: schema.trips.id,
						title: schema.trips.title,
						status: schema.trips.status
					})
					.from(schema.trips)
					.where(
						and(
							inArray(schema.trips.vehicleId, ids),
							inArray(schema.trips.status, ['PREPARING', 'READY', 'IN_PROGRESS'])
						)
					)
			: [];
		const onTrip = new Map(assigned.map((a) => [a.vehicleId as string, a]));

		return ok({
			// When the SERVER last asked. The age of a fix and the age of our
			// knowledge are different numbers, and the app shows them apart.
			checkedAt: new Date().toISOString(),
			vehicles: vehicles.map((v) => {
				const snap = live.get(v.id);
				const state: TrackingState = !v.trackerDeviceRef ? 'NOT_CONFIGURED' : (snap?.state ?? 'NOT_CONFIGURED');
				const trip = onTrip.get(v.id);
				return {
					id: v.id,
					name: v.name,
					registration: v.registration,
					label: [v.make, v.model].filter(Boolean).join(' ') || v.name,
					// A BOOLEAN. The tracker reference is credential material and never
					// leaves the server.
					tracked: Boolean(v.trackerDeviceRef),
					state,
					stateLabel: TRACKING_LABEL[state],
					recordedAt: snap?.position?.recordedAt?.toISOString() ?? null,
					speedKph: snap?.position?.speedKph ?? null,
					latitude: snap?.position?.latitude ?? null,
					longitude: snap?.position?.longitude ?? null,
					trip: trip ? { id: trip.tripId, title: trip.title, status: trip.status } : null
				};
			})
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
