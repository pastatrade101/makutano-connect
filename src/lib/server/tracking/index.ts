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
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { TraccarProvider } from './traccar';
import { providerBaseUrl, tenantCredentials } from './credentials';
import type { TrackingHistory, TrackingProvider, TrackingSnapshot } from './types';

export * from './types';

/** Provider names this build knows how to speak to. */
const KNOWN_PROVIDERS = ['TRACCAR'] as const;

/**
 * The provider a vehicle is mapped to, SPEAKING AS THE TENANT THAT OWNS IT.
 *
 * There is no process-wide provider instance any more, and that is the whole
 * security change: an instance cannot exist without a tenant's own credential,
 * so there is no object lying around that can see the entire platform. A tenant
 * with no provider identity yet gets null — which is NOT_CONFIGURED, never an
 * outage.
 */
async function providerFor(
	tenantId: string,
	name: string | null | undefined
): Promise<TrackingProvider | null> {
	if (!name || !KNOWN_PROVIDERS.includes(name as (typeof KNOWN_PROVIDERS)[number])) return null;
	const credentials = await tenantCredentials(tenantId);
	if (!credentials) return null;
	return new TraccarProvider(credentials);
}

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
	const provider = await providerFor(tenantId, vehicle.trackerProvider);
	if (!provider || !provider.isConfigured()) return notConfigured;
	return provider.snapshot(vehicle.trackerDeviceRef);
}

/**
 * Latest state for every tracked vehicle a tenant owns, in one provider call.
 *
 * Ownership is still resolved here: the device references handed to the provider
 * come from rows read under this tenantId, never from a caller.
 */
export async function fleetSnapshot(tenantId: string): Promise<Map<string, TrackingSnapshot>> {
	const rows = await db()
		.select({ id: schema.vehicles.id, provider: schema.vehicles.trackerProvider, ref: schema.vehicles.trackerDeviceRef })
		.from(schema.vehicles)
		.where(and(eq(schema.vehicles.tenantId, tenantId), isNotNull(schema.vehicles.trackerDeviceRef)));

	const byVehicle = new Map<string, TrackingSnapshot>();
	if (!rows.length) return byVehicle;

	// A row naming a provider this build does not have is not an outage either.
	const known = new Set<string>(KNOWN_PROVIDERS);
	for (const r of rows) {
		if (!known.has(r.provider ?? '')) byVehicle.set(r.id, { state: 'NOT_CONFIGURED', position: null });
	}

	/*
	 * Grouped by provider so a second provider later costs one more call, not one
	 * per vehicle.
	 *
	 * A vehicle whose provider is missing or unconfigured is answered here as
	 * NOT_CONFIGURED rather than left absent. Left absent, the caller had to
	 * invent a default, and the default it invented was UNAVAILABLE — so a
	 * workspace that had simply never switched tracking on read "Tracking
	 * temporarily unavailable" on every vehicle, which sends somebody looking for
	 * an outage that does not exist.
	 */
	for (const name of KNOWN_PROVIDERS) {
		const mine = rows.filter((r) => r.provider === name && r.ref);
		if (!mine.length) continue;
		/*
		 * Resolved as THIS TENANT, which is what makes the two parameterless calls
		 * inside snapshotAll safe.
		 *
		 * They ask the provider for "every device you can see". Under the old
		 * shared administrator that was every device on the platform, and only
		 * Connect's own filtering kept one tenant out of another's positions.
		 * Under a tenant's read-only identity the provider itself answers with
		 * that tenant's devices and nothing else, so the fleet list keeps its
		 * one-request cost and isolation stops depending on us remembering.
		 */
		const provider = await providerFor(tenantId, name);
		if (!provider || !provider.isConfigured()) {
			for (const r of mine) byVehicle.set(r.id, { state: 'NOT_CONFIGURED', position: null });
			continue;
		}
		const snaps = await provider.snapshotAll(mine.map((r) => r.ref as string));
		for (const r of mine) {
			const s = snaps.get(r.ref as string);
			if (s) byVehicle.set(r.id, s);
		}
	}
	return byVehicle;
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

/**
 * A vehicle's track over a window, resolved under the tenant that owns it.
 *
 * Same shape as tripHistory and the same security walk — tenant, then owned
 * vehicle, then the tenant's own provider identity. A vehicle id from a caller
 * that this tenant does not own resolves to an empty track, never to somebody
 * else's route.
 */
export async function vehicleHistory(
	tenantId: string,
	vehicleId: string,
	from: Date,
	to: Date
): Promise<TrackingHistory> {
	const empty: TrackingHistory = { positions: [], from, to, truncated: false };
	const vehicle = await ownedVehicle(tenantId, vehicleId);
	if (!vehicle?.trackerDeviceRef) return empty;
	const provider = await providerFor(tenantId, vehicle.trackerProvider);
	if (!provider) return empty;
	return provider.history(vehicle.trackerDeviceRef, from, to);
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
	const provider = await providerFor(tenantId, vehicle.trackerProvider);
	if (!provider) return empty;
	return provider.history(vehicle.trackerDeviceRef, from, to);
}

/** Whether tracking is worth offering at all on this deployment. */
/**
 * Whether tracking exists on this deployment at all.
 *
 * Deliberately NOT "whether this tenant can track": that question needs a
 * tenant, and answering it here would have made a tenant without an identity
 * look like a broken deployment.
 */
export const trackingEnabled = (): boolean => Boolean(providerBaseUrl());
