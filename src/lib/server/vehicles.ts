// The vehicles a tenant runs — the peer of the crew registry.
//
// A registry, not a fleet-management system. It exists so a trip can name a
// PHYSICAL vehicle rather than a string, and so a tracker can be mapped to that
// vehicle. Everything a fleet product would add next — fuel, maintenance,
// utilisation, driver scoring — is deliberately absent.
//
// Vehicles are DEACTIVATED, never deleted, for the same reason as crew: a trip
// that ran last year still names the vehicle that ran it.
import { and, asc, eq, ne, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { assertAllowed } from './entitlements';
import { AppError } from './errors';

export type VehicleInput = {
	name: string;
	registration?: string | null;
	make?: string | null;
	model?: string | null;
	type?: string | null;
	seats?: number | null;
	notes?: string | null;
};



/**
 * The one line a trip stores as its snapshot.
 *
 * `trips.vehicle` is free text that a readiness check and a raw SQL aggregate
 * both read, and a shipped Flutter client renders as a plain String. So the
 * snapshot must always be a stable, human-readable string — never JSON, never
 * an id. Registration leads because that is what an operator says on the radio
 * and what is painted on the door.
 */
export function vehicleSnapshotText(v: {
	name: string;
	registration?: string | null;
	make?: string | null;
	model?: string | null;
}): string {
	const descriptor = [v.make, v.model].map((s) => s?.trim()).filter(Boolean).join(' ') || v.name.trim();
	const plate = v.registration?.trim();
	return plate ? `${descriptor} ${plate}`.trim() : descriptor;
}

export async function listVehicles(
	tenantId: string,
	filters: { activeOnly?: boolean } = {}
): Promise<schema.Vehicle[]> {
	const clauses: SQL[] = [eq(schema.vehicles.tenantId, tenantId)];
	if (filters.activeOnly) clauses.push(eq(schema.vehicles.isActive, true));
	return db()
		.select()
		.from(schema.vehicles)
		.where(and(...clauses))
		.orderBy(asc(schema.vehicles.name));
}

export async function getVehicle(tenantId: string, id: string): Promise<schema.Vehicle> {
	const [row] = await db()
		.select()
		.from(schema.vehicles)
		// tenantId is positional and never comes from the request body. A vehicle id
		// from another tenant simply does not match, so there is no second check to
		// forget.
		.where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'That vehicle could not be found.');
	return row;
}

export async function createVehicle(tenantId: string, input: VehicleInput): Promise<schema.Vehicle> {
	await assertAllowed(tenantId, { feature: 'bookings.enabled' });
	const name = input.name?.trim();
	if (!name) throw new AppError('VALIDATION_ERROR', 'Give the vehicle a name you would recognise.');

	const [row] = await db()
		.insert(schema.vehicles)
		.values({
			tenantId,
			name,
			registration: input.registration?.trim() || null,
			make: input.make?.trim() || null,
			model: input.model?.trim() || null,
			type: input.type?.trim() || null,
			seats: Number.isFinite(input.seats) ? (input.seats as number) : null,
			notes: input.notes?.trim() || null
		})
		.returning();
	return row;
}

export async function updateVehicle(
	tenantId: string,
	id: string,
	input: Partial<VehicleInput> & { isActive?: boolean }
): Promise<schema.Vehicle> {
	await assertAllowed(tenantId);
	await getVehicle(tenantId, id);

	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) {
		const name = input.name?.trim();
		if (!name) throw new AppError('VALIDATION_ERROR', 'Give the vehicle a name you would recognise.');
		patch.name = name;
	}
	for (const key of ['registration', 'make', 'model', 'type', 'notes'] as const) {
		if (input[key] !== undefined) patch[key] = input[key]?.trim() || null;
	}
	if (input.seats !== undefined) patch.seats = Number.isFinite(input.seats) ? input.seats : null;
	if (input.isActive !== undefined) patch.isActive = input.isActive;

	const [row] = await db()
		.update(schema.vehicles)
		.set(patch)
		.where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.tenantId, tenantId)))
		.returning();
	return row;
}

/**
 * Map a tracker to a vehicle, or clear it.
 *
 * Stop tracking a vehicle.
 *
 * There is deliberately no counterpart here that STARTS tracking from a caller-
 * supplied reference. That was the claim-by-guessing weakness: the only check
 * was that no other Connect row already held the string, so knowing a tracker's
 * identifier was indistinguishable from owning it. Ownership is established
 * where Connect mints the identity for a named vehicle of a named tenant.
 *
 * The globally unique index on (tracker_provider, tracker_device_ref) stays as
 * defence in depth. It is no longer the authority on who owns a tracker.
 */
export async function clearVehicleTracker(tenantId: string, id: string): Promise<schema.Vehicle> {
	await assertAllowed(tenantId);
	await getVehicle(tenantId, id);

	/*
	 * This function can now only ever CLEAR a mapping.
	 *
	 * Setting one by typing a reference was the claim-by-guessing weakness: the
	 * only check was that no other Connect row already held the string, so
	 * knowing a tracker's identifier was the same thing as owning it. Ownership
	 * is now decided when Connect MINTS an identity for a specific vehicle of a
	 * specific tenant, which is enrollment's job, not this one.
	 *
	 * Clearing stays here and stays reachable: an operator must always be able to
	 * stop tracking a vehicle, and doing so supplies no secret to anybody.
	 */
	const [row] = await db()
		.update(schema.vehicles)
		.set({
			trackerProvider: null,
			trackerDeviceRef: null,
			trackerLinkedAt: null,
			// A position from a tracker this vehicle no longer carries is worse than
			// no position at all.
			lastFixAt: null,
			lastFixLat: null,
			lastFixLng: null,
			updatedAt: new Date()
		})
		.where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.tenantId, tenantId)))
		.returning();
	return row;
}

/** Active vehicles, shaped for the trip picker. */
export async function vehiclesForPicker(tenantId: string) {
	const rows = await listVehicles(tenantId, { activeOnly: true });
	return rows.map((v) => ({
		id: v.id,
		name: v.name,
		registration: v.registration,
		label: vehicleSnapshotText(v),
		tracked: Boolean(v.trackerDeviceRef)
	}));
}

/**
 * Resolve a vehicle for assignment to a trip.
 *
 * Mirrors resolveCrew in trips.ts, including the two refusals that matter: a
 * vehicle belonging to another tenant is indistinguishable from one that does
 * not exist, and a deactivated vehicle cannot be NEWLY assigned.
 *
 * Returns the snapshot text alongside the id because callers must write BOTH —
 * writing only the id would leave trips.vehicle empty, and that column is what
 * the readiness check and the blocked-trip SQL read.
 */
export async function resolveVehicle(
	tenantId: string,
	id: string | null | undefined
): Promise<{ id: string | null; snapshot: string | null }> {
	if (!id) return { id: null, snapshot: null };
	const [row] = await db()
		.select({
			id: schema.vehicles.id,
			name: schema.vehicles.name,
			registration: schema.vehicles.registration,
			make: schema.vehicles.make,
			model: schema.vehicles.model,
			isActive: schema.vehicles.isActive
		})
		.from(schema.vehicles)
		.where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('VALIDATION_ERROR', 'That vehicle is not on your fleet list.');
	if (!row.isActive) throw new AppError('VALIDATION_ERROR', `${row.name} is no longer active.`);
	return { id: row.id, snapshot: vehicleSnapshotText(row) };
}
