// One vehicle's route over a window.
//
// The vehicle id comes from the query, and is resolved UNDER THIS TENANT — an id
// belonging to somebody else returns an empty track, never their route. No
// device reference is accepted or returned.
import { json } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { errorResponse, toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { vehicleHistory } from '$lib/server/tracking';
import type { RequestHandler } from './$types';

/** The provider keeps a day. Anything longer belongs to retention, not here. */
const MAX_HOURS = 24;

export const GET: RequestHandler = async ({ locals, url }) => {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	try {
		const vehicleId = parseUuid(url.searchParams.get('vehicle') ?? '', 'vehicle id');

		// Clamped server-side. The UI offers 6 and 24 hours today and the shape
		// takes more ranges later without a backend change.
		const requested = Number(url.searchParams.get('hours') ?? MAX_HOURS);
		const hours = Math.min(MAX_HOURS, Math.max(1, Number.isFinite(requested) ? requested : MAX_HOURS));

		const to = new Date();
		const from = new Date(to.getTime() - hours * 3600_000);
		const history = await vehicleHistory(tenant.id, vehicleId, from, to);

		return json(
			{
				success: true,
				data: {
					hours,
					truncated: history.truncated,
					// Triples, not objects: a 2000-point track is a quarter of the bytes.
					points: history.positions.map((p) => [p.latitude, p.longitude, p.recordedAt.getTime()])
				}
			},
			{ headers: { 'Cache-Control': 'no-store, private' } }
		);
	} catch (err) {
		return errorResponse(toAppError(err), locals.requestId);
	}
};
