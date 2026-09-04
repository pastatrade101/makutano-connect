/**
 * The only process that holds a privileged tracking credential.
 *
 * The web container deliberately cannot create a device — Phase 1 removed
 * platform-wide provider administration from the request-serving process and
 * this keeps it removed. An operator's click writes a ledger row; this worker
 * turns that row into a real device and grants it to the tenant's read-only
 * identity.
 *
 * The database is the whole coordination mechanism. No queue, no broker, no
 * scheduler: at this scale a claim with a lease over one indexed table is both
 * sufficient and far easier to reason about when something goes wrong at 3am.
 *
 * OWNERSHIP IS NEVER INFERRED FROM A TRACKER IDENTITY. Every field the worker
 * acts on — tenant, vehicle, reference — is read from the ledger row, which was
 * written by an authenticated operator against a vehicle they own.
 */
import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { db, schema, txDb } from '$lib/server/db';
import { log } from '$lib/server/logger';
import { adminCredentials, tenantCredentials } from './credentials';
import { ensureTenantAccount, findDeviceByRef, linkDeviceToTenant, unlinkDeviceFromTenant, deleteProviderDevice } from './traccar-admin';

/** How long a claim is honoured before another run may take the row. */
const LEASE_MS = 2 * 60 * 1000;
/** Give up after this many attempts and let a human look. */
const MAX_ATTEMPTS = 6;
/** Bounded backoff: 5s, 20s, 45s, 80s, 125s, 180s. Never unbounded. */
const backoffMs = (attempt: number) => Math.min(180_000, 5_000 * attempt * attempt);

/** Identifies this run in the claim, so a stuck lease is traceable to a process. */
const RUN_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Take one unit of work, atomically.
 *
 * A single conditional UPDATE ... RETURNING is the entire concurrency story:
 * two workers racing issue the same statement and exactly one of them gets the
 * row, because the second sees the claim the first wrote. `FOR UPDATE SKIP
 * LOCKED` would do the same job with more moving parts and the same guarantee.
 */
async function claimOne(): Promise<schema.TrackerEnrollment | null> {
	const [row] = await db()
		.update(schema.trackerEnrollments)
		.set({ claimedAt: new Date(), claimedBy: RUN_ID, attempts: sql`attempts + 1` })
		.where(
			sql`id = (
				SELECT id FROM tracker_enrollments
				WHERE status = 'PENDING'
				  AND expires_at > now()
				  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
				  AND (claimed_at IS NULL OR claimed_at < now() - interval '${sql.raw(String(LEASE_MS))} milliseconds')
				ORDER BY created_at
				LIMIT 1
				FOR UPDATE SKIP LOCKED
			)`
		)
		.returning();
	return row ?? null;
}

/**
 * Provision one enrollment.
 *
 * Idempotent at every step, because a retry after a timeout must not create a
 * second device: the reference is 75-bit and ours by ledger, so a device already
 * carrying it can only be our own half-finished write.
 */
async function provision(row: schema.TrackerEnrollment): Promise<void> {
	const [vehicle] = await db()
		.select({ name: schema.vehicles.name, registration: schema.vehicles.registration })
		.from(schema.vehicles)
		.where(eq(schema.vehicles.id, row.vehicleId))
		.limit(1);

	// The tenant's read-only identity. Created here if this is their first tracker.
	const account = await ensureTenantAccount(row.tenantId);
	if (!account.providerUserId) throw new Error('tenant_identity_incomplete');

	// Adopt before creating. A create that timed out may well have succeeded.
	let deviceId = row.providerDeviceId ?? (await findDeviceByRef(row.deviceRef))?.id ?? null;
	if (!deviceId) {
		const created = await createDevice(row.deviceRef, vehicle?.registration || vehicle?.name || 'Vehicle');
		deviceId = created?.id ?? (await findDeviceByRef(row.deviceRef))?.id ?? null;
	}
	if (!deviceId) throw new Error('device_not_created');

	// Granting twice is harmless — the provider treats the link as a set — but
	// the adopt-first path above means it usually happens once.
	await linkDeviceToTenant(account.providerUserId, deviceId);

	// PROVISIONED is only reachable with a real device id, and the database
	// enforces that too (te_prov_chk).
	await db()
		.update(schema.trackerEnrollments)
		.set({
			status: 'PROVISIONED',
			providerDeviceId: deviceId,
			provisionedAt: new Date(),
			claimedAt: null,
			claimedBy: null,
			lastError: null
		})
		.where(and(eq(schema.trackerEnrollments.id, row.id), eq(schema.trackerEnrollments.status, 'PENDING')));
}

async function createDevice(deviceRef: string, name: string): Promise<{ id?: number } | null> {
	const creds = adminCredentials();
	if (!creds) throw new Error('provisioning_not_configured');
	const res = await fetch(`${creds.baseUrl}/api/devices`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({ name: `${name} tracker`, uniqueId: deviceRef }),
		signal: AbortSignal.timeout(8000)
	});
	return res.ok ? ((await res.json()) as { id?: number }) : null;
}

/** Record a failure without losing the enrollment. The operator can retry. */
async function recordFailure(row: schema.TrackerEnrollment, err: unknown): Promise<void> {
	const attempts = row.attempts + 1;
	const terminal = attempts >= MAX_ATTEMPTS;
	await db()
		.update(schema.trackerEnrollments)
		.set({
			// FAILED is a distinct state, not a silent PENDING that never moves —
			// otherwise a permanently broken row is indistinguishable from a slow one.
			status: terminal ? 'FAILED' : 'PENDING',
			claimedAt: null,
			claimedBy: null,
			nextAttemptAt: terminal ? null : new Date(Date.now() + backoffMs(attempts)),
			lastError: String(err).slice(0, 200)
		})
		.where(eq(schema.trackerEnrollments.id, row.id));
	log.warn('tracker_provisioning_failed', { enrollmentId: row.id, attempts, terminal });
}

/**
 * Expire what the driver never used, and hand the device back.
 *
 * The ledger row is NOT deleted and the reference stays locked forever — a
 * retired phone can still flush a buffer, and that must never land on another
 * vehicle. Only the provider-side artefacts go.
 */
async function sweepExpired(): Promise<number> {
	const stale = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(and(sql`status IN ('PENDING','PROVISIONED')`, lt(schema.trackerEnrollments.expiresAt, new Date())))
		.limit(50);

	for (const row of stale) {
		await db()
			.update(schema.trackerEnrollments)
			.set({
				status: 'CLOSED',
				closedReason: 'EXPIRED',
				closedAt: new Date(),
				providerDeleteAfter: new Date(),
				claimedAt: null,
				claimedBy: null
			})
			.where(eq(schema.trackerEnrollments.id, row.id));
	}
	return stale.length;
}

/**
 * Remove provider artefacts for closed enrollments. LEDGER-DRIVEN ONLY.
 *
 * Never a diff of "every device the ledger does not name": that is an
 * irreversible destructive operation whose failure mode is deleting more than
 * intended, against the one datastore with no backup story. Every device touched
 * here is named by a row we wrote, so another tenant's device cannot be reached.
 */
async function cleanupProvider(): Promise<number> {
	const due = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(
			and(
				isNotNull(schema.trackerEnrollments.providerDeleteAfter),
				lt(schema.trackerEnrollments.providerDeleteAfter, new Date()),
				isNotNull(schema.trackerEnrollments.providerDeviceId),
				or(sql`cleanup_state IS NULL`, eq(schema.trackerEnrollments.cleanupState, 'RETRY'))
			)
		)
		.limit(50);

	for (const row of due) {
		let state = 'DONE';
		try {
			const account = await ensureTenantAccount(row.tenantId);
			if (account.providerUserId) await unlinkDeviceFromTenant(account.providerUserId, row.providerDeviceId as number);
			/*
			 * DELETE, always. Never "disable".
			 *
			 * Proven against the deployed 6.15.3, not assumed: a device with
			 * disabled=true KEEPS INGESTING. Positions posted to a disabled device
			 * are still stored and the device's current-position pointer still
			 * advances. Disabling affects what the provider's own UI and permissions
			 * do; it is not revocation, and treating it as revocation would have
			 * left every retired tracker able to keep writing.
			 *
			 * Deleting the device is the only thing that stops ingestion. Its past
			 * positions are then orphaned rather than removed — there is no foreign
			 * key from positions to devices in this schema — so trip history that
			 * has already been read stays readable, and retention has to find those
			 * rows by scanning positions rather than by walking devices.
			 */
			await deleteProviderDevice(row.providerDeviceId as number, { disableOnly: false });
		} catch (err) {
			state = 'RETRY';
			log.warn('tracker_cleanup_failed', { enrollmentId: row.id, reason: String(err).slice(0, 120) });
		}
		await db()
			.update(schema.trackerEnrollments)
			.set({ cleanupState: state, cleanupAt: new Date(), providerDeleteAfter: state === 'DONE' ? null : new Date(Date.now() + 300_000) })
			.where(eq(schema.trackerEnrollments.id, row.id));
	}
	return due.length;
}


/**
 * Has the phone reported yet?
 *
 * Runs here, not in the web process, and deliberately uses the TENANT'S
 * READ-ONLY identity rather than the privileged one this worker also holds. The
 * worker having a privileged credential is not a reason to read positions with
 * it: the tenant identity is scoped by the provider to that tenant's own
 * devices, so even a bug in this function cannot reach another tenant's data.
 *
 * The device is derived from the ledger row — never from a caller, never by
 * name, never by an unscoped listing.
 */
async function detectFirstFixes(): Promise<number> {
	const rows = await db()
		.select()
		.from(schema.trackerEnrollments)
		.where(and(eq(schema.trackerEnrollments.status, 'PROVISIONED'), sql`expires_at > now()`, isNotNull(schema.trackerEnrollments.providerDeviceId)))
		.limit(50);

	let activated = 0;
	for (const row of rows) {
		try {
			const creds = await tenantCredentials(row.tenantId);
			// No identity yet is not a failure: the enrollment simply waits.
			if (!creds) continue;

			const res = await fetch(`${creds.baseUrl}/api/positions?deviceId=${row.providerDeviceId}`, {
				headers: {
					Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(6000)
			});
			await db()
				.update(schema.trackerEnrollments)
				.set({ pollAttempts: sql`poll_attempts + 1`, lastPolledAt: new Date() })
				.where(eq(schema.trackerEnrollments.id, row.id));
			// A provider that will not answer leaves the row PROVISIONED and
			// retryable. An enrollment must never fail because a GPS server did.
			if (!res.ok) continue;

			const positions = (await res.json()) as {
				latitude?: number;
				longitude?: number;
				fixTime?: string;
				deviceId?: number;
			}[];
			const fix = positions.find(
				(p) =>
					// Belt and braces: even a provider that ignored our deviceId filter
					// cannot activate this enrollment with another device's position.
					p.deviceId === row.providerDeviceId &&
					Number.isFinite(p.latitude) &&
					Number.isFinite(p.longitude) &&
					!(p.latitude === 0 && p.longitude === 0)
			);
			if (!fix) continue;

			if (await bindEnrollment(row.id, new Date(fix.fixTime ?? Date.now()), fix.latitude as number, fix.longitude as number)) {
				activated++;
			}
		} catch (err) {
			log.warn('tracker_first_fix_check_failed', { enrollmentId: row.id, reason: String(err).slice(0, 120) });
		}
	}
	return activated;
}

/**
 * Bind the enrollment and point the vehicle at it.
 *
 * One transaction, and the UPDATE is conditional on the row still being
 * PROVISIONED — so two workers checking the same enrollment produce exactly one
 * transition, and the loser simply sees zero rows.
 *
 * Replacement lives here too: the outgoing tracker stays ACTIVE right up to this
 * moment and is closed in the SAME transaction that activates its replacement,
 * so a vehicle is never briefly untracked. The outgoing device is then handed to
 * cleanup for deletion — the only thing that actually stops it reporting.
 */
async function bindEnrollment(id: string, at: Date, lat: number, lng: number): Promise<boolean> {
	return txDb().transaction(async (tx) => {
		/*
		 * The outgoing tracker is closed BEFORE the incoming one is activated.
		 *
		 * te_one_active_key permits a single ACTIVE row per vehicle and Postgres
		 * checks it per statement, not at commit. Activating first and closing
		 * second therefore cannot commit during a replacement: the statement is
		 * rejected, the pass retries, and the new phone stays on PROVISIONED
		 * forever while the old one keeps reporting. That is a live-lock, not a
		 * transient error, so it never resolves on its own.
		 *
		 * Ordering it this way keeps the promise that matters. We only reach this
		 * function because the new phone has ALREADY reported a fix, so the old
		 * tracker is retired at the moment its replacement is proven — not when
		 * the operator asked for one. And it is all one transaction: if the
		 * activation below fails, the close is rolled back with it.
		 */
		const [candidate] = await tx
			.select({ vehicleId: schema.trackerEnrollments.vehicleId })
			.from(schema.trackerEnrollments)
			.where(and(eq(schema.trackerEnrollments.id, id), eq(schema.trackerEnrollments.status, 'PROVISIONED')))
			.for('update')
			.limit(1);
		if (!candidate) return false;

		await tx
			.update(schema.trackerEnrollments)
			.set({
				status: 'CLOSED',
				closedReason: 'REPLACED',
				closedAt: new Date(),
				// Delete the old device. Disabling does not revoke it.
				providerDeleteAfter: new Date()
			})
			.where(
				and(
					eq(schema.trackerEnrollments.vehicleId, candidate.vehicleId),
					eq(schema.trackerEnrollments.status, 'ACTIVE'),
					sql`id <> ${id}`
				)
			);

		const [bound] = await tx
			.update(schema.trackerEnrollments)
			.set({
				status: 'ACTIVE',
				boundAt: new Date(),
				confirmedAt: new Date(),
				firstFixAt: at,
				firstFixLat: String(lat),
				firstFixLng: String(lng)
			})
			.where(and(eq(schema.trackerEnrollments.id, id), eq(schema.trackerEnrollments.status, 'PROVISIONED')))
			.returning();
		if (!bound) return false;

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

/** One pass. Safe to run concurrently with another pass, and safe to interrupt. */
export async function runProvisioningPass(): Promise<{
	provisioned: number;
	activated: number;
	expired: number;
	cleaned: number;
}> {
	if (!adminCredentials()) {
		// Refusing loudly beats provisioning nothing quietly for a week.
		throw new Error('The provisioning worker requires TRACCAR_ADMIN_USERNAME and TRACCAR_ADMIN_PASSWORD.');
	}
	let provisioned = 0;
	for (let i = 0; i < 25; i++) {
		const row = await claimOne();
		if (!row) break;
		try {
			await provision(row);
			provisioned++;
		} catch (err) {
			await recordFailure(row, err);
		}
	}
	const activated = await detectFirstFixes();
	const expired = await sweepExpired();
	const cleaned = await cleanupProvider();
	return { provisioned, activated, expired, cleaned };
}
