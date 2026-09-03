/**
 * The tracking service. What the rest of Connect calls.
 *
 * Everything above this line speaks Connect's language; everything below it is
 * one provider's problem. Swapping Traccar for something else is a new class in
 * this folder and a changed line here — no trip logic, no route, no UI.
 *
 * Two rules hold this together and both matter more than the abstraction:
 *
 *   OWNERSHIP IS RESOLVED HERE, NOT ASKED FOR. Every entry point takes a
 *   tenantId as its first positional argument and looks the vehicle up under it.
 *   A device reference NEVER arrives from a browser — it is read from a row the
 *   tenant provably owns. There is deliberately no function in this module that
 *   accepts a device reference from a caller.
 *
 *   TRACKING FAILS ALONE. Every path returns a state, never throws. A trip page
 *   whose tracking card says "unavailable" is a working trip page; a trip page
 *   that 500s because a GPS server is slow is a broken product.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { TraccarProvider } from './traccar';
import type { TrackingHistory, TrackingProvider, TrackingSnapshot } from './types';

export * from './types';

const providers: Record<string, TrackingProvider> = {
	TRACCAR: new TraccarProvider()
};

/** The provider a vehicle is mapped to, or none. */
const providerFor = (name: string | null | undefined): TrackingProvider | null =>
	name ? (providers[name] ?? null) : null;

/** A vehicle, looked up under the tenant that claims it. */
async function ownedVehicle(tenantId: string, vehicleId: string) {
	const [row] = await db()
		.select({
			id: schema.vehicles.id,
			name: schema.vehicles.name,
			registration: schema.vehicles.registration,
			isActive: schema.vehicles.isActive,
			trackerProvider: schema.vehicles.trackerProvider,
			trackerDeviceRef: schema.vehicles.trackerDeviceRef
		})
		.from(schema.vehicles)
		// tenantId is a positional argument, never a field on the request. A vehicle
		// id belonging to another tenant returns nothing here and therefore cannot
		// reach a provider — the isolation is the query, not a later check.
		.where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.tenantId, tenantId)))
		.limit(1);
	return row ?? null;
}

const notConfigured: TrackingSnapshot = { state: 'NOT_CONFIGURED', position: null };

/*
 * The precedence, in one place.
 *
 *   provider not configured        -> NOT_CONFIGURED
 *   no tracker mapped              -> NOT_CONFIGURED
 *   provider request failed        -> UNAVAILABLE
 *   request fine, no position      -> OFFLINE
 *   position                       -> LIVE / RECENT / STALE by age
 *
 * The distinction that matters: UNAVAILABLE means WE tried and could not get an
 * answer, so it is a temporary fault worth showing as one. A deployment with no
 * tracking backend has not failed at anything — it simply does not have the
 * feature, and telling an operator their tracking is "temporarily unavailable"
 * when it was never configured sends them looking for an outage that is not
 * there. Checked HERE rather than in the adapter, because "is this product
 * configured for tracking" is the service's question, not one provider's.
 */
export async function vehicleSnapshot(tenantId: string, vehicleId: string): Promise<TrackingSnapshot> {
	const vehicle = await ownedVehicle(tenantId, vehicleId);
	if (!vehicle?.trackerDeviceRef) return notConfigured;
	const provider = providerFor(vehicle.trackerProvider);
	if (!provider || !provider.isConfigured()) return notConfigured;
	return provider.snapshot(vehicle.trackerDeviceRef);
}

/** Where a tenant's TRIP is now, resolved through the vehicle assigned to it. */
export async function tripSnapshot(tenantId: string, tripId: string): Promise<TrackingSnapshot> {
	const [trip] = await db()
		.select({ vehicleId: schema.trips.vehicleId })
		.from(schema.trips)
		.where(and(eq(schema.trips.id, tripId), eq(schema.trips.tenantId, tenantId)))
		.limit(1);
	if (!trip?.vehicleId) return notConfigured;
	return vehicleSnapshot(tenantId, trip.vehicleId);
}

/** A trip's track over a window. Empty rather than an error when unavailable. */
export async function tripHistory(
	tenantId: string,
	tripId: string,
	from: Date,
	to: Date
): Promise<TrackingHistory> {
	const empty: TrackingHistory = { positions: [], from, to, truncated: false };
	const [trip] = await db()
		.select({ vehicleId: schema.trips.vehicleId })
		.from(schema.trips)
		.where(and(eq(schema.trips.id, tripId), eq(schema.trips.tenantId, tenantId)))
		.limit(1);
	if (!trip?.vehicleId) return empty;
	const vehicle = await ownedVehicle(tenantId, trip.vehicleId);
	if (!vehicle?.trackerDeviceRef) return empty;
	const provider = providerFor(vehicle.trackerProvider);
	if (!provider) return empty;
	return provider.history(vehicle.trackerDeviceRef, from, to);
}

/** Whether tracking is worth offering at all on this deployment. */
export const trackingEnabled = (): boolean => Object.values(providers).some((p) => p.isConfigured());
