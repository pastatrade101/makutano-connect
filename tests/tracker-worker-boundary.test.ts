// Where enrollment work happens, and where it must not.
//
// The web process authenticates, authorises and reads the ledger. It provisions
// nothing, detects nothing, and holds no privileged credential. The worker owns
// every provider call in the enrollment lifecycle — and even it reads positions
// as the TENANT'S read-only identity rather than with the privileged credential
// it happens to possess.
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
const STATUS = read('src/routes/app/vehicles/[id]/tracking/status/+server.ts');
const PAGE_UI = read('src/routes/app/vehicles/[id]/tracking/+page.svelte');
const MIGRATION = read('drizzle/0050_tracker_enrollments.sql');

describe('1-2, 16 · the web process does no provider work at all', () => {
	it('the status endpoint makes no provider call', () => {
		expect(STATUS).not.toContain('fetch(');
		expect(STATUS).not.toContain('/api/positions');
		expect(STATUS).toContain('enrollmentStatus');
	});

	it('the enrollment service performs no first-fix detection', () => {
		expect(SERVICE).not.toContain('checkForFirstFix');
		expect(SERVICE).not.toContain('/api/positions');
		expect(SERVICE).not.toContain('bindEnrollment');
	});

	it('no request-serving code can reach a privileged credential', () => {
		expect(SERVICE).not.toContain('adminCredentials');
		const hits = execSync("grep -rln 'traccar-admin\\|adminCredentials\\|provisioning-worker' src/routes/ || true", {
			encoding: 'utf8'
		}).split('\n').filter(Boolean);
		expect(hits).toEqual([]);
	});
});

describe('3-5 · the worker detects, scoped, as the tenant', () => {
	it('detects the first fix', () => {
		expect(WORKER).toContain('async function detectFirstFixes');
		expect(WORKER).toContain('const activated = await detectFirstFixes()');
	});

	it('asks only about the exact provisioned device', () => {
		expect(WORKER).toContain('/api/positions?deviceId=${row.providerDeviceId}');
		// And rejects anything the provider returns for a different device.
		expect(WORKER).toContain('p.deviceId === row.providerDeviceId');
		// The device comes from the ledger row, never from a caller.
		expect(WORKER).toContain('isNotNull(schema.trackerEnrollments.providerDeviceId)');
	});

	it('reads positions with the tenant identity, not the privileged one', () => {
		const detect = WORKER.slice(WORKER.indexOf('async function detectFirstFixes'), WORKER.indexOf('async function bindEnrollment'));
		// Possessing a privileged credential is not a reason to read with it: the
		// tenant identity is scoped by the provider to that tenant's own devices.
		expect(detect).toContain('tenantCredentials(row.tenantId)');
		expect(detect).not.toContain('adminCredentials');
	});
});

describe('6-8 · activation is exactly once, and only the right enrollment', () => {
	it('two workers produce one transition', () => {
		expect(WORKER).toMatch(/eq\(schema\.trackerEnrollments\.status, 'PROVISIONED'\)\)\)\s*\.returning\(\)/);
		expect(WORKER).toContain('if (!bound) return false;');
	});

	it('a provider that will not answer leaves the row retryable', () => {
		const detect = WORKER.slice(WORKER.indexOf('async function detectFirstFixes'));
		// PROVISIONED is not changed on failure — an enrollment must never fail
		// because a GPS server did.
		expect(detect).toContain('if (!res.ok) continue;');
		expect(detect).toContain("log.warn('tracker_first_fix_check_failed'");
	});

	it("another device's position cannot activate an enrollment", () => {
		expect(WORKER).toContain('p.deviceId === row.providerDeviceId');
		// 0,0 is the null island, not a fix.
		expect(WORKER).toContain('!(p.latitude === 0 && p.longitude === 0)');
	});
});

describe('9-11 · replacement is seamless, then the old device is deleted', () => {
	it('the old tracker stays ACTIVE until the new first fix', () => {
		const bindAt = WORKER.indexOf('async function bindEnrollment');
		expect(WORKER.indexOf("closedReason: 'REPLACED'")).toBeGreaterThan(bindAt);
		// Both partial indexes tolerate one ACTIVE plus one in-flight row.
		expect(MIGRATION).toContain("te_one_inflight_key ON tracker_enrollments (vehicle_id) WHERE status IN ('PENDING','PROVISIONED')");
	});

	it('the switch and the close happen in one transaction', () => {
		const bind = WORKER.slice(WORKER.indexOf('async function bindEnrollment'));
		expect(bind).toContain('txDb().transaction');
		expect(bind).toContain('.update(schema.vehicles)');
	});

	it('the replaced device is handed to cleanup for DELETION', () => {
		const bind = WORKER.slice(WORKER.indexOf('async function bindEnrollment'));
		expect(bind).toContain('providerDeleteAfter: new Date()');
		expect(WORKER).toContain('disableOnly: false');
	});
});

describe('12-14 · closing an enrollment deletes the device, never disables it', () => {
	it('cancellation marks the device for deletion', () => {
		expect(SERVICE).toMatch(/closedReason: 'CANCELLED'[\s\S]{0,80}providerDeleteAfter: new Date\(\)/);
	});

	it('expiry marks the device for deletion', () => {
		expect(WORKER).toMatch(/closedReason: 'EXPIRED'[\s\S]{0,200}providerDeleteAfter: new Date\(\)/);
	});

	it('a PENDING row with no device needs no provider call', () => {
		// The cleanup query requires a device id, so a row that never got one is
		// simply closed.
		expect(WORKER).toContain('isNotNull(schema.trackerEnrollments.providerDeviceId)');
	});

	it('disabled is never used as revocation', () => {
		// Proven against 6.15.3: a disabled device keeps accepting and storing
		// positions and its current-position pointer keeps advancing.
		expect(WORKER).not.toContain('disableOnly: true');
		expect(WORKER).toContain('disableOnly: false');
	});
});

describe('15, 17-18 · identity, history and wording', () => {
	it('a tracker identity is never reused', () => {
		expect(MIGRATION).toContain("te_ref_forever_key ON tracker_enrollments (provider, device_ref) WHERE status <> 'RELEASED'");
		// Ledger rows are closed, never deleted, so the lock survives cleanup —
		// which is also what lets a trip's history be traced to its tracker later.
		expect(WORKER).not.toMatch(/\.delete\(schema\.trackerEnrollments\)/);
		expect(SERVICE).not.toMatch(/\.delete\(schema\.trackerEnrollments\)/);
	});

	it('the QR warning is present and honest', () => {
		expect(PAGE_UI).toContain('Keep this setup code private');
		expect(PAGE_UI).toContain('may be able to configure another');
		// The claims the proof disproved must not reappear.
		expect(PAGE_UI).not.toMatch(/rather than a screen that can be photographed/);
	});

	it('the raw identifier appears nowhere outside the QR material', () => {
		expect(PAGE_UI).not.toContain('deviceRef');
		const svelteHits = execSync("grep -rl 'deviceRef' src/routes/ || true", { encoding: 'utf8' })
			.split('\n').filter(Boolean).filter((f) => f.endsWith('.svelte'));
		expect(svelteHits).toEqual([]);
	});
});
