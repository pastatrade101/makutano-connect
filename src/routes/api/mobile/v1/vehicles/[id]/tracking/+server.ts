// Where one vehicle is.
//
// SECURITY SHAPE, identical to the trip endpoint:
//
//   session -> tenant -> vehicle (owned) -> device ref
//
// A device reference is NEVER accepted from the caller and there is no parameter
// here that could name one. The app asks about a VEHICLE it can see, and the
// server walks to the device. Another tenant's vehicle id resolves to
// NOT_CONFIGURED, indistinguishable from a vehicle with no tracker.
import type { RequestHandler } from './$types';
import { vehicleHistory, vehicleSnapshot, TRACKING_LABEL } from '$lib/server/tracking';
import { getVehicle } from '$lib/server/vehicles';
import { parseUuid } from '$lib/server/http';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

/** A day is enough to draw today's drive without asking for a year of fixes. */
const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'vehicles:read');
		const vehicleId = parseUuid(event.params.id, 'vehicle id');

		// Throws if this tenant does not own it, before any provider call.
		const vehicle = await getVehicle(viewer.tenantId, vehicleId);
		const snapshot = await vehicleSnapshot(viewer.tenantId, vehicleId);

		let history = null;
		if (event.url.searchParams.get('history') === '1') {
			const to = new Date();
			const from = new Date(to.getTime() - MAX_HISTORY_MS);
			const h = await vehicleHistory(viewer.tenantId, vehicleId, from, to);
			history = {
				// Triples, not objects: a 2000-point track is a quarter of the bytes,
				// and this is somebody's data bundle.
				points: h.positions.map((p) => [p.latitude, p.longitude, p.recordedAt.getTime()]),
				truncated: h.truncated
			};
		}

		return ok({
			state: snapshot.state,
			label: TRACKING_LABEL[snapshot.state],
			vehicle: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name,
			registration: vehicle.registration,
			linked: Boolean(vehicle.trackerDeviceRef),
			position: snapshot.position
				? {
						latitude: snapshot.position.latitude,
						longitude: snapshot.position.longitude,
						speedKph: snapshot.position.speedKph,
						recordedAt: snapshot.position.recordedAt.toISOString()
					}
				: null,
			checkedAt: new Date().toISOString(),
			history
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
