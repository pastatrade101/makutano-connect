// The endpoint the live map polls, and the only way a browser reaches a tracker.
//
// SECURITY SHAPE, which is the whole reason this route is thin:
//
//   session -> tenant -> trip (owned) -> vehicle_id -> vehicle (owned) -> device ref
//
// A device reference is NEVER accepted from the caller. There is deliberately no
// parameter here that could name one: the browser asks about a TRIP it can see,
// and the server walks to the device. Swapping the trip id for another tenant's
// returns 404 from the ownership query, indistinguishable from a trip that does
// not exist.
import { json } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { parseUuid } from '$lib/server/http';
import { tripHistory, tripSnapshot } from '$lib/server/tracking';
import type { RequestHandler } from './$types';

/** A day is enough to draw today's drive without asking for a year of fixes. */
const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const tenant = requireTenantPermission(locals, 'trips:read');
	const tripId = parseUuid(params.id, 'trip id');

	const snapshot = await tripSnapshot(tenant.id, tripId);

	// History only when asked for. The card polls the snapshot alone; the track is
	// fetched once when somebody opens the map.
	let history = null;
	if (url.searchParams.get('history') === '1') {
		const to = new Date();
		const from = new Date(to.getTime() - MAX_HISTORY_MS);
		const h = await tripHistory(tenant.id, tripId, from, to);
		history = {
			positions: h.positions.map((p) => ({ latitude: p.latitude, longitude: p.longitude, recordedAt: p.recordedAt })),
			truncated: h.truncated
		};
	}

	return json({
		success: true,
		data: {
			state: snapshot.state,
			position: snapshot.position
				? {
						latitude: snapshot.position.latitude,
						longitude: snapshot.position.longitude,
						speedKph: snapshot.position.speedKph,
						recordedAt: snapshot.position.recordedAt
					}
				: null,
			message: snapshot.message ?? null,
			history
		}
	});
};
