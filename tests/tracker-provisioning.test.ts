// Phase 2 worker model: the credential boundary, the queue, and the QR window.
//
// The boundary these tests defend: the web container cannot create a device.
// Phase 1 removed platform-wide provider administration from the request-serving
// process, and enrollment must not quietly put it back — so an operator's click
// writes a ledger row and a separate worker, holding the only privileged
// credential, turns that row into a device.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const read = (p: string) => readFileSync(p, 'utf8');
const WORKER = read('src/lib/server/tracking/provisioning-worker.ts');
const SERVICE = read('src/lib/server/tracking/enrollment.ts');
const MIGRATION = read('drizzle/0050_tracker_enrollments.sql');
const QR = read('src/routes/app/vehicles/[id]/tracking/qr/+server.ts');
const PAGE = read('src/routes/app/vehicles/[id]/tracking/+page.server.ts');

describe('1-2 · the privileged credential lives in exactly one process', () => {
	it('no request-serving code reads the provisioning credential', () => {
		// enrollment.ts runs in the web container. If it could call adminCredentials()
		// the boundary would exist only in configuration, not in code.
		expect(SERVICE).not.toContain('adminCredentials');
		expect(SERVICE).not.toContain('traccar-admin');
		const routeHits = execSync("grep -rln 'traccar-admin\\|adminCredentials' src/routes/ || true", { encoding: 'utf8' })
			.split('\n').filter(Boolean);
		expect(routeHits).toEqual([]);
	});

	it('the worker refuses to run without it, loudly', () => {
		expect(WORKER).toContain('if (!adminCredentials())');
		expect(WORKER).toMatch(/throw new Error\(\s*'The provisioning worker requires/);
	});
});

describe('3-5, 14 · claiming is safe under concurrency and restart', () => {
	it('a claim is one conditional UPDATE, so two workers cannot take one row', () => {
		expect(WORKER).toContain('FOR UPDATE SKIP LOCKED');
		expect(WORKER).toMatch(/\.update\(schema\.trackerEnrollments\)[\s\S]{0,200}claimedBy: RUN_ID/);
	});

	it('a claim is a lease, so a dead worker does not wedge the row forever', () => {
		expect(WORKER).toContain('claimed_at IS NULL OR claimed_at < now() -');
		expect(WORKER).toContain('LEASE_MS');
	});

	it('provisioning adopts an existing device instead of creating a second', () => {
		// A create that timed out may well have succeeded. The reference is 75-bit
		// and ours by ledger, so a device carrying it can only be our own write.
		const provision = WORKER.slice(WORKER.indexOf('async function provision'));
		expect(provision).toMatch(/findDeviceByRef\(row\.deviceRef\)\)\?\.id \?\? null/);
		expect(provision.indexOf('findDeviceByRef')).toBeLessThan(provision.indexOf('createDevice('));
	});

	it('the transition to PROVISIONED is conditional on still being PENDING', () => {
		expect(WORKER).toMatch(/status: 'PROVISIONED'[\s\S]{0,400}eq\(schema\.trackerEnrollments\.status, 'PENDING'\)/);
	});

	it('PROVISIONED is impossible without a real device id', () => {
		expect(MIGRATION).toContain("te_prov_chk CHECK (status <> 'PROVISIONED' OR provider_device_id IS NOT NULL)");
	});
});

describe('6-11 · the QR window', () => {
	it('is scoped to the tenant and the vehicle', () => {
		for (const src of [QR, PAGE]) {
			expect(src).toContain('requireTenantPermission');
			expect(src).toContain('vehicles:write');
		}
		// enrollmentFor filters on BOTH tenant and vehicle, so another tenant's
		// vehicle id resolves to nothing rather than to someone else's code.
		expect(SERVICE).toMatch(/eq\(schema\.trackerEnrollments\.tenantId, tenantId\)[\s\S]{0,120}eq\(schema\.trackerEnrollments\.vehicleId, vehicleId\)/);
	});

	it('opens only for PROVISIONED and unexpired', () => {
		expect(SERVICE).toContain("row.status === 'PROVISIONED' && isLive(row)");
		expect(QR).toContain('if (!canShowCode(pending))');
	});

	it('closes on activation, cancellation, expiry and replacement', () => {
		// canShowCode is the single gate, and only PROVISIONED passes it — so
		// ACTIVE, CLOSED(CANCELLED|EXPIRED|REPLACED) and FAILED all fail it.
		expect(SERVICE).toMatch(/IN_FLIGHT\.includes\(row\.status\) && row\.expiresAt\.getTime\(\) > Date\.now\(\)/);
		expect(SERVICE).toContain("const IN_FLIGHT = ['PENDING', 'PROVISIONED']");
	});

	it('a refresh returns the same identity, never a new one', () => {
		// The reference lives on the ledger row; the load reads it, and only
		// startEnrollment mints. Reloading a page must not mint a tracker.
		const load = PAGE.slice(PAGE.indexOf('export const load'), PAGE.indexOf('export const actions'));
		expect(load).not.toContain('mintDeviceRef');
		expect(load).not.toContain('startEnrollment');
		expect(QR).not.toContain('mintDeviceRef');
	});

	it('provisioning failure shows no code', () => {
		expect(PAGE).toContain("failed: Boolean(pending && pending.status === 'FAILED')");
		// FAILED is not in IN_FLIGHT, so canShowCode rejects it.
		expect(SERVICE).not.toMatch(/IN_FLIGHT[^\n]*FAILED/);
	});
});

describe('12 · the first fix activates exactly the expected enrollment', () => {
	it('resolves only the provisioned device, scoped, never by name', () => {
		expect(SERVICE).toContain('/api/positions?deviceId=${row.providerDeviceId}');
		expect(SERVICE).toContain('p.deviceId === row.providerDeviceId');
		// Never an unscoped list, never a lookup by the tracker identity.
		expect(SERVICE).not.toMatch(/positions'\s*,?\s*\{[^}]*\}\s*\)/);
	});

	it('binds atomically from PROVISIONED, so a replay changes one row', () => {
		expect(SERVICE).toMatch(/eq\(schema\.trackerEnrollments\.status, 'PROVISIONED'\)\)\)\s*\.returning\(\)/);
	});

	it('16 · replacement keeps the old tracker live until the new one binds', () => {
		const bindAt = SERVICE.indexOf('async function bindEnrollment');
		expect(SERVICE.indexOf("closedReason: 'REPLACED'")).toBeGreaterThan(bindAt);
	});
});

describe('13 · the identifier is not in ordinary payloads', () => {
	it('is absent from the enrollment page payload', () => {
		const load = PAGE.slice(PAGE.indexOf('export const load'), PAGE.indexOf('export const actions'));
		// The QR image is the one intentional delivery of it — to the phone.
		expect(load).not.toContain('deviceRef:');
	});

	it('is absent from every browser-reachable file', () => {
		const hits = execSync("grep -rl 'trackerDeviceRef\\|deviceRef' src/routes/ || true", { encoding: 'utf8' })
			.split('\n').filter(Boolean).filter((f) => f.endsWith('.svelte'));
		expect(hits).toEqual([]);
	});
});

describe('15 · cleanup cannot reach another tenant', () => {
	it('is ledger-driven, never a diff of the provider', () => {
		// A diff of "every device the ledger does not name" is irreversible and
		// its failure mode is deleting more than intended.
		expect(WORKER).toContain('isNotNull(schema.trackerEnrollments.providerDeviceId)');
		expect(WORKER).not.toMatch(/all=true[\s\S]{0,200}delete/i);
	});

	it('DELETES the device, because disabling does not revoke', () => {
		// Proven against the deployed 6.15.3: a disabled device keeps accepting and
		// storing positions and its current-position pointer keeps advancing.
		// Treating disable as revocation would leave every retired tracker able to
		// keep writing.
		expect(WORKER).toContain('disableOnly: false');
		expect(WORKER).not.toContain('disableOnly: true');
	});

	it('keeps the reference locked after cleanup', () => {
		expect(WORKER).not.toMatch(/\.delete\(schema\.trackerEnrollments\)/);
		expect(MIGRATION).toContain("te_ref_forever_key ON tracker_enrollments (provider, device_ref) WHERE status <> 'RELEASED'");
	});
});

describe('the provisioning identity is least-privilege', () => {
	it('is a manager with device rights, not an administrator', async () => {
		const { PROVISIONING_USER_FLAGS } = await import('../src/lib/server/tracking/traccar-admin');
		// Verified in the deployed 6.15.3 source: checkEdit denies a non-admin
		// creating a Device only on readonly/deviceReadonly/deviceLimit==0;
		// BaseObjectResource auto-links the creator to the device; UserResource
		// auto-links a manager to users it creates. Both halves of a permission
		// grant are therefore satisfied without administrator.
		expect(PROVISIONING_USER_FLAGS.administrator).toBe(false);
		expect(PROVISIONING_USER_FLAGS.userLimit).not.toBe(0);
		expect(PROVISIONING_USER_FLAGS.deviceLimit).not.toBe(0);
		expect(PROVISIONING_USER_FLAGS.readonly).toBe(false);
		expect(PROVISIONING_USER_FLAGS.disableReports).toBe(true);
	});
});
