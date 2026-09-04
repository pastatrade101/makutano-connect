/**
 * Setting up a tracker, and the ledger that decides who owns one.
 *
 * THE DIRECTION OF TRUST IS THE WHOLE DESIGN. Connect mints the reference for a
 * named vehicle of a named tenant, writes the ledger row, and only then asks the
 * provider to create a device. No endpoint anywhere accepts a reference from a
 * caller, so knowing one can never be the same as owning one.
 *
 * The first GPS fix therefore proves LIVENESS, not ownership — ownership was
 * settled at mint. That distinction is what stops an attacker who learns a
 * pending reference from claiming anything: they can make a phone report, but
 * the row it binds to already names somebody else's vehicle.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db, schema, txDb } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { enforce } from '$lib/server/rate-limit';
import { mintDeviceRef } from './identifier';
import { adminCredentials, providerBaseUrl, tenantCredentials } from './credentials';
import { ensureTenantAccount, findDeviceByRef, linkDeviceToTenant } from './traccar-admin';

/** How long a setup code lives. Sized by the honest path, not by optimism. */
export const PHONE_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Reporting presets, never raw fields.
 *
 * The app's own `Config.effective` couples these — highest accuracy forces
 * distance and interval to 0, and any distance forces interval to 0 — so
 * exposing them individually would offer combinations that silently rewrite each
 * other. Three named choices cannot.
 */
export const PROFILES = {
	SAFARI: { label: 'On safari', accuracy: 'medium', distance: 150, heartbeat: 900 },
	TOWN: { label: 'In town', accuracy: 'medium', distance: 100, heartbeat: 600 },
	BATTERY: { label: 'Save battery', accuracy: 'low', distance: 500, heartbeat: 1800 }
} as const;
export type ProfileKey = keyof typeof PROFILES;

/** A PENDING row past its expiry is expired, whatever the column still says. */
const isLive = (row: schema.TrackerEnrollment): boolean =>
	row.status === 'PENDING' && row.expiresAt.getTime() > Date.now();

/**
 * The configuration the driver's phone scans.
 *
 * The app stores only `origin + path` as its server URL and applies the query as
 * settings — verified in its source — which is what makes this safe. A query
 * string left ON the stored server URL would make the ingest decoder read the
 * URI parameters instead of the POST body and reject every report with a 400,
 * silently, forever.
 */
export function configurationUri(deviceRef: string, profile: ProfileKey): string {
	const p = PROFILES[profile] ?? PROFILES.SAFARI;
	const base = providerBaseUrl();
	const params = new URLSearchParams({
		id: deviceRef,
		accuracy: p.accuracy,
		distance: String(p.distance),
		heartbeat: String(p.heartbeat),
		buffer: 'true',
		stop_detection: 'true'
	});
	return `${base}/osmand?${params.toString()}`;
}

/** The live enrollment rows for a vehicle, with lazy expiry applied. */
export async function enrollmentFor(tenantId: string, vehicleId: string) {
	const rows = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(
			and(
				eq(schema.trackerEnrollments.tenantId, tenantId),
				eq(schema.trackerEnrollments.vehicleId, vehicleId)
			)
		);
	const active = rows.find((r) => r.status === 'ACTIVE') ?? null;
	const pendingRow = rows.find((r) => r.status === 'PENDING') ?? null;
	return { active, pending: pendingRow && isLive(pendingRow) ? pendingRow : null, expired: pendingRow && !isLive(pendingRow) ? pendingRow : null };
}

/**
 * Start a phone enrollment for one vehicle.
 *
 * The ledger row is written BEFORE the provider is touched, so there is never a
 * provider device that Connect cannot name. Stale PENDING rows are self-healed
 * in the same transaction: without that, an expired-but-unswept row collides
 * with the one-pending index and permanently locks the vehicle out of the single
 * most common action in the flow — letting a code expire and clicking "start
 * again". A security boundary must never wait on a sweeper.
 */
export async function startEnrollment(input: {
	tenantId: string;
	vehicleId: string;
	userId: string;
	profile?: ProfileKey;
	label?: string | null;
}): Promise<schema.TrackerEnrollment> {
	const { tenantId, vehicleId, userId } = input;
	const profile = input.profile && PROFILES[input.profile] ? input.profile : 'SAFARI';

	// These limits, not any provider-side cap, are what bound how many devices a
	// compromised session can create. enforce() throws; consume() would not.
	await enforce(`tracker_enroll:v:${vehicleId}`, 5, 3600);
	await enforce(`tracker_enroll:t:${tenantId}`, 20, 86400);

	const vehicle = await db()
		.select({ id: schema.vehicles.id, name: schema.vehicles.name, registration: schema.vehicles.registration })
		.from(schema.vehicles)
		.where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.tenantId, tenantId)))
		.limit(1);
	if (!vehicle.length) throw new AppError('NOT_FOUND', 'That vehicle could not be found.');

	const deviceRef = mintDeviceRef();
	const expiresAt = new Date(Date.now() + PHONE_EXPIRY_MS);

	const row = await txDb().transaction(async (tx) => {
		// Self-heal anything stale, then take the pending slot.
		await tx
			.update(schema.trackerEnrollments)
			.set({ status: 'CLOSED', closedReason: 'EXPIRED', closedAt: new Date(), providerDeleteAfter: new Date() })
			.where(
				and(
					eq(schema.trackerEnrollments.vehicleId, vehicleId),
					eq(schema.trackerEnrollments.status, 'PENDING'),
					lt(schema.trackerEnrollments.expiresAt, new Date())
				)
			);

		// A live pending row means somebody already started; retrying supersedes it
		// so the old code dies the instant the new one appears.
		await tx
			.update(schema.trackerEnrollments)
			.set({ status: 'CLOSED', closedReason: 'SUPERSEDED', closedAt: new Date(), providerDeleteAfter: new Date() })
			.where(
				and(eq(schema.trackerEnrollments.vehicleId, vehicleId), eq(schema.trackerEnrollments.status, 'PENDING'))
			);

		const [created] = await tx
			.insert(schema.trackerEnrollments)
			.values({
				tenantId,
				vehicleId,
				provider: 'TRACCAR',
				deviceRef,
				identifierSource: 'MINTED',
				kind: 'PHONE',
				profile,
				label: input.label?.trim() || null,
				status: 'PENDING',
				createdByUserId: userId,
				expiresAt
			})
			.returning();
		return created;
	});

	// Only now does the provider learn anything. A failure here leaves a PENDING
	// row with no device, which reads as "waiting" and expires harmlessly.
	try {
		const account = await ensureTenantAccount(tenantId);
		const device = await createProviderDevice(deviceRef, vehicle[0].registration || vehicle[0].name);
		if (device?.id && account.providerUserId) {
			await linkDeviceToTenant(account.providerUserId, device.id);
			await db()
				.update(schema.trackerEnrollments)
				.set({ providerDeviceId: device.id })
				.where(eq(schema.trackerEnrollments.id, row.id));
		}
	} catch (err) {
		log.error('tracker_enrollment_provider_failed', { vehicleId, reason: String(err).slice(0, 140) });
		throw new AppError('NOT_CONFIGURED', 'Tracking setup could not start just now. Please try again in a moment.');
	}

	return row;
}

/** Create the device on the provider. Provisioning credential, never runtime. */
async function createProviderDevice(deviceRef: string, name: string): Promise<{ id?: number } | null> {
	const creds = adminCredentials();
	if (!creds) throw new Error('provisioning_not_configured');
	const res = await fetch(`${creds.baseUrl}/api/devices`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({ name: `${name} tracker`, uniqueId: deviceRef })
	});
	if (res.ok) return (await res.json()) as { id?: number };
	// A create that may have succeeded server-side before timing out: adopt our
	// own half-finished write rather than minting again. The reference is 75-bit
	// and ours by ledger, so a match cannot be somebody else's device.
	return findDeviceByRef(deviceRef);
}

/**
 * Has the phone reported yet?
 *
 * Polled while the setup screen is open. Binding is a single conditional UPDATE,
 * so a replay — two polls racing, or the same fix seen twice — changes exactly
 * one row and creates exactly one binding.
 */
export async function checkForFirstFix(
	tenantId: string,
	enrollmentId: string
): Promise<{ status: string; firstFixAt: Date | null }> {
	const [row] = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(and(eq(schema.trackerEnrollments.id, enrollmentId), eq(schema.trackerEnrollments.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'That setup could not be found.');
	if (row.status === 'ACTIVE') return { status: 'ACTIVE', firstFixAt: row.firstFixAt };
	if (!isLive(row)) return { status: 'EXPIRED', firstFixAt: null };

	const creds = await tenantCredentials(tenantId);
	if (!creds || !row.providerDeviceId) return { status: 'PENDING', firstFixAt: null };

	await db()
		.update(schema.trackerEnrollments)
		.set({ pollAttempts: sql`poll_attempts + 1`, lastPolledAt: new Date() })
		.where(eq(schema.trackerEnrollments.id, row.id));

	// Asked as the TENANT, scoped by device id. Never unscoped, never by name.
	const res = await fetch(`${creds.baseUrl}/api/positions?deviceId=${row.providerDeviceId}`, {
		headers: {
			Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
			Accept: 'application/json'
		}
	}).catch(() => null);
	if (!res?.ok) return { status: 'PENDING', firstFixAt: null };

	const positions = (await res.json()) as { latitude?: number; longitude?: number; fixTime?: string; deviceId?: number }[];
	const fix = positions.find(
		(p) =>
			p.deviceId === row.providerDeviceId &&
			Number.isFinite(p.latitude) &&
			Number.isFinite(p.longitude) &&
			!(p.latitude === 0 && p.longitude === 0)
	);
	if (!fix) return { status: 'PENDING', firstFixAt: null };

	const at = new Date(fix.fixTime ?? Date.now());
	const bound = await bindEnrollment(row.id, at, fix.latitude as number, fix.longitude as number);
	return { status: bound ? 'ACTIVE' : 'PENDING', firstFixAt: bound ? at : null };
}

/**
 * Bind the enrollment and point the vehicle at it.
 *
 * One transaction, and the UPDATE is conditional on the row still being PENDING
 * — so a double-bind returns zero rows rather than creating a second binding.
 */
async function bindEnrollment(id: string, at: Date, lat: number, lng: number): Promise<boolean> {
	return txDb().transaction(async (tx) => {
		const [bound] = await tx
			.update(schema.trackerEnrollments)
			.set({
				status: 'ACTIVE',
				boundAt: new Date(),
				firstFixAt: at,
				firstFixLat: String(lat),
				firstFixLng: String(lng)
			})
			.where(and(eq(schema.trackerEnrollments.id, id), eq(schema.trackerEnrollments.status, 'PENDING')))
			.returning();
		if (!bound) return false;

		// Replacing: the outgoing tracker keeps working until this moment, then
		// closes in the same transaction. Nothing goes dark.
		await tx
			.update(schema.trackerEnrollments)
			.set({ status: 'CLOSED', closedReason: 'REPLACED', closedAt: new Date(), providerDeleteAfter: new Date() })
			.where(
				and(
					eq(schema.trackerEnrollments.vehicleId, bound.vehicleId),
					eq(schema.trackerEnrollments.status, 'ACTIVE'),
					sql`id <> ${bound.id}`
				)
			);

		await tx
			.update(schema.vehicles)
			.set({
				trackerProvider: bound.provider,
				trackerDeviceRef: bound.deviceRef,
				trackerEnrollmentId: bound.id,
				trackerLinkedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(schema.vehicles.id, bound.vehicleId));
		return true;
	});
}

/** Give up on a setup. The reference is burned, not returned to a pool. */
export async function cancelEnrollment(tenantId: string, enrollmentId: string): Promise<void> {
	await db()
		.update(schema.trackerEnrollments)
		.set({ status: 'CLOSED', closedReason: 'CANCELLED', closedAt: new Date(), providerDeleteAfter: new Date() })
		.where(
			and(
				eq(schema.trackerEnrollments.id, enrollmentId),
				eq(schema.trackerEnrollments.tenantId, tenantId),
				eq(schema.trackerEnrollments.status, 'PENDING')
			)
		);
}

/** One more window, on a fresh authenticated click. The reference does not change. */
export async function extendEnrollment(tenantId: string, enrollmentId: string): Promise<void> {
	const [row] = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(and(eq(schema.trackerEnrollments.id, enrollmentId), eq(schema.trackerEnrollments.tenantId, tenantId)))
		.limit(1);
	if (!row || row.status !== 'PENDING') throw new AppError('CONFLICT', 'That setup can no longer be extended.');
	const extensions = Number((row.metadata as Record<string, unknown>)?.extensions ?? 0);
	if (extensions >= 1) throw new AppError('CONFLICT', 'This code has already been extended once. Start again for a new one.');
	await db()
		.update(schema.trackerEnrollments)
		.set({
			expiresAt: new Date(Date.now() + PHONE_EXPIRY_MS),
			metadata: sql`jsonb_set(metadata, '{extensions}', to_jsonb(${extensions + 1}::int))`
		})
		.where(eq(schema.trackerEnrollments.id, row.id));
}

/**
 * Stop tracking this vehicle.
 *
 * The ledger row stays CLOSED rather than being deleted, which is what keeps the
 * reference burned: the forever-unique index covers every status but RELEASED.
 */
export async function removeTracking(tenantId: string, vehicleId: string): Promise<void> {
	await txDb().transaction(async (tx) => {
		await tx
			.update(schema.trackerEnrollments)
			.set({ status: 'CLOSED', closedReason: 'REMOVED', closedAt: new Date(), providerDeleteAfter: new Date() })
			.where(
				and(
					eq(schema.trackerEnrollments.tenantId, tenantId),
					eq(schema.trackerEnrollments.vehicleId, vehicleId),
					sql`status IN ('ACTIVE','PENDING')`
				)
			);
		await tx
			.update(schema.vehicles)
			.set({
				trackerProvider: null,
				trackerDeviceRef: null,
				trackerEnrollmentId: null,
				trackerLinkedAt: null,
				lastFixAt: null,
				lastFixLat: null,
				lastFixLng: null,
				updatedAt: new Date()
			})
			.where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.tenantId, tenantId)));
	});
}
