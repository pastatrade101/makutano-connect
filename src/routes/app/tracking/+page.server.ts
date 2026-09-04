// Fleet tracking: the map-first operations screen.
//
// Every vehicle here belongs to the authenticated tenant, resolved server-side
// from the session — the browser never names a tenant and never sees a tracker
// reference. The first paint carries state for the whole fleet so the page opens
// useful rather than empty; after that the client polls the positions endpoint.
import { requireTenantPermission } from '$lib/server/guards';
import { listVehicles } from '$lib/server/vehicles';
import { fleetSnapshot, TRACKING_LABEL, trackingEnabled, type TrackingState } from '$lib/server/tracking';
import { db, schema } from '$lib/server/db';
import { and, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	const vehicles = await listVehicles(tenant.id);

	// ONE provider call for the whole page, scoped by the provider to this
	// tenant's own devices. Never one request per row.
	const live = trackingEnabled() ? await fleetSnapshot(tenant.id) : new Map();

	const ids = vehicles.map((v) => v.id);
	const assigned = ids.length
		? await db()
				.select({
					vehicleId: schema.trips.vehicleId,
					tripId: schema.trips.id,
					reference: schema.trips.tripReference,
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

	const rows = vehicles.map((v) => {
		const snap = live.get(v.id);
		const state: TrackingState = !v.trackerDeviceRef ? 'NOT_CONFIGURED' : (snap?.state ?? 'NOT_CONFIGURED');
		const trip = onTrip.get(v.id);
		return {
			id: v.id,
			name: v.name,
			registration: v.registration,
			make: v.make,
			model: v.model,
			// A BOOLEAN. The tracker reference is credential material and never
			// leaves the server.
			tracked: Boolean(v.trackerDeviceRef),
			state,
			label: TRACKING_LABEL[state],
			recordedAt: snap?.position?.recordedAt ?? null,
			speedKph: snap?.position?.speedKph ?? null,
			latitude: snap?.position?.latitude ?? null,
			longitude: snap?.position?.longitude ?? null,
			driver: trip ? null : null,
			trip: trip ? { id: trip.tripId, reference: trip.reference, title: trip.title, status: trip.status } : null
		};
	});

	const requested = url.searchParams.get('vehicle');
	const selected =
		rows.find((r) => r.id === requested)?.id ??
		// Otherwise open on something worth looking at: a vehicle that is actually
		// reporting beats the alphabetically first one.
		rows.find((r) => r.state === 'LIVE' || r.state === 'RECENT')?.id ??
		rows.find((r) => r.tracked)?.id ??
		rows[0]?.id ??
		null;

	return {
		trackingEnabled: trackingEnabled(),
		canWrite: locals.permissions.includes('vehicles:write'),
		vehicles: rows,
		selectedId: selected,
		checkedAt: new Date().toISOString()
	};
};
