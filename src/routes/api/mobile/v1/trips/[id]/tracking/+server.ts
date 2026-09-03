// Where a trip's vehicle is, for the phone.
//
// SECURITY SHAPE, deliberately identical to the browser's endpoint:
//
//   session -> tenant -> trip (owned) -> vehicle_id -> vehicle (owned) -> device ref
//
// A device reference is NEVER accepted from the caller, and there is no parameter
// here that could name one. The phone asks about a TRIP it can see and the server
// walks to the device. Asking about another tenant's trip returns the same empty
// answer as a trip that does not exist.
//
// The trip is ALSO scope-checked, not merely tenant-checked: a CREW member holds
// trips:read but must not open a trip that is not theirs by knowing its id. The
// browser page gets that from its own load; this route has to do it itself.
import type { RequestHandler } from './$types';
import { getTripDetail, scopeFor } from '$lib/server/trips';
import { tripHistory, tripSnapshot, TRACKING_LABEL } from '$lib/server/tracking';
import { parseUuid } from '$lib/server/http';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

/** A day is enough to draw today's drive without asking for a year of fixes. */
const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'trips:read');
		const tripId = parseUuid(event.params.id, 'trip id');

		// Throws if this viewer may not see this trip. Done BEFORE any tracking
		// call, so an unauthorised id never reaches the provider at all.
		const scope = await scopeFor(viewer.tenantId, { userId: viewer.userId, role: event.locals.role });
		const detail = await getTripDetail(viewer.tenantId, tripId, scope);

		const snapshot = await tripSnapshot(viewer.tenantId, tripId);

		// History only when asked for. The card polls the snapshot alone; the track
		// is fetched once, when somebody actually opens the map.
		let history = null;
		if (event.url.searchParams.get('history') === '1') {
			const to = new Date();
			const from = new Date(to.getTime() - MAX_HISTORY_MS);
			const h = await tripHistory(viewer.tenantId, tripId, from, to);
			history = {
				// Triples, not objects: a 2000-point track is a quarter of the bytes,
				// and this is a phone on someone else's data bundle.
				points: h.positions.map((p) => [p.latitude, p.longitude, p.recordedAt.getTime()]),
				truncated: h.truncated
			};
		}

		return ok({
			// The label the operator reads comes from the server, so the phone and
			// the browser can never disagree about what a state is called.
			state: snapshot.state,
			label: TRACKING_LABEL[snapshot.state],
			vehicle: detail.trip.vehicle,
			// Whether a REGISTRY vehicle is linked. Free text alone cannot be tracked,
			// and the app needs to tell those apart to say something useful.
			linked: Boolean(detail.trip.vehicleId),
			position: snapshot.position
				? {
						latitude: snapshot.position.latitude,
						longitude: snapshot.position.longitude,
						speedKph: snapshot.position.speedKph,
						recordedAt: snapshot.position.recordedAt.toISOString()
					}
				: null,
			// When the SERVER last knew this. The phone shows the age of the fix and
			// the age of our knowledge separately; conflating them is how a screen
			// claims to be live while nothing has been fetched for ten minutes.
			checkedAt: new Date().toISOString(),
			history
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
