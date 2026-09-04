// Phase 2: who owns a tracker, and what the first fix actually proves.
//
// The weakness this replaces: a tenant claimed a tracker by typing its
// identifier, and the only check was that no other row already held the string.
// Knowing a reference WAS owning it. Here Connect mints the reference for a
// named vehicle of a named tenant before the provider is touched, so the first
// fix proves LIVENESS and ownership was never in question.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const read = (p: string) => readFileSync(p, 'utf8');
const MIGRATION = read('drizzle/0050_tracker_enrollments.sql');
const SERVICE = read('src/lib/server/tracking/enrollment.ts');

describe('the minted reference is credential material', () => {
	it('has at least 75 bits of entropy over a 32-symbol alphabet', async () => {
		const { mintDeviceRef } = await import('../src/lib/server/tracking/identifier');
		const ref = mintDeviceRef();
		// 15 random + 1 check. Sized for the POST-binding attack — guessing a live
		// reference to inject positions has unlimited time and every vehicle on the
		// platform as its target pool.
		expect(ref).toHaveLength(16);
		expect(15 * Math.log2(32)).toBeGreaterThanOrEqual(75);
	});

	it('is never enumerable', async () => {
		const { mintDeviceRef } = await import('../src/lib/server/tracking/identifier');
		const seen = new Set(Array.from({ length: 500 }, () => mintDeviceRef()));
		expect(seen.size).toBe(500);
		// The shapes explicitly rejected by the design.
		for (const r of seen) expect(r).not.toMatch(/^MK-?0*\d{1,6}$/);
	});

	it('uses an alphabet without the characters people misread', async () => {
		const { mintDeviceRef } = await import('../src/lib/server/tracking/identifier');
		const all = Array.from({ length: 200 }, () => mintDeviceRef()).join('');
		// I, L, O and U are absent: the provider compares the reference as a raw
		// string, so a mistyped character is an unrecoverable silent failure.
		for (const c of ['I', 'L', 'O', 'U']) expect(all).not.toContain(c);
	});

	it('detects a single mistyped character', async () => {
		const { mintDeviceRef, looksWellFormed } = await import('../src/lib/server/tracking/identifier');
		const ref = mintDeviceRef();
		expect(looksWellFormed(ref)).toBe(true);
		const broken = (ref[0] === '2' ? '3' : '2') + ref.slice(1);
		expect(looksWellFormed(broken)).toBe(false);
	});
});

describe('ownership is decided at mint, never by knowing a reference', () => {
	it('no route accepts a tracker reference from a caller', () => {
		const hits = execSync("grep -rln 'deviceRef' src/routes/ || true", { encoding: 'utf8' })
			.split('\n').filter(Boolean);
		// The setup page renders the minted code; nothing READS one from a request.
		for (const f of hits) {
			const src = read(f);
			expect(src).not.toMatch(/data\.get\(['"]deviceRef['"]\)/);
			expect(src).not.toMatch(/name=["']deviceRef["']/);
		}
	});

	it('mints before the provider is told anything', () => {
		const insertAt = SERVICE.indexOf('.insert(schema.trackerEnrollments)');
		const providerAt = SERVICE.indexOf('createProviderDevice(');
		// A provider device Connect cannot name is the thing this ordering prevents.
		expect(insertAt).toBeGreaterThan(-1);
		expect(insertAt).toBeLessThan(providerAt);
	});

	it('the database refuses an active tracker that never proved liveness', () => {
		expect(MIGRATION).toContain("CONSTRAINT te_evid_chk CHECK (status <> 'ACTIVE' OR identifier_source = 'LEGACY' OR first_fix_at IS NOT NULL)");
	});
});

describe('the lifecycle cannot be raced or replayed', () => {
	it('binding is conditional on the row still being pending', () => {
		// A double-bind returns zero rows rather than creating a second binding.
		expect(SERVICE).toMatch(/eq\(schema\.trackerEnrollments\.status, 'PENDING'\)\)\)\s*\.returning\(\)/);
	});

	it('one pending and one active per vehicle, enforced by the database', () => {
		expect(MIGRATION).toContain("te_one_pending_key ON tracker_enrollments (vehicle_id) WHERE status = 'PENDING'");
		expect(MIGRATION).toContain("te_one_active_key ON tracker_enrollments (vehicle_id) WHERE status = 'ACTIVE'");
	});

	it('a reference is burned forever, never returned to a pool', () => {
		// A retired phone flushing its offline buffer into another vehicle's track
		// is the failure this prevents.
		expect(MIGRATION).toContain("te_ref_forever_key ON tracker_enrollments (provider, device_ref) WHERE status <> 'RELEASED'");
		// RELEASED is the ONE status that lifts the forever-lock, and only a
		// platform admin may set it on an admin-asserted hardware reference. The
		// operator-facing service must never write it.
		expect(SERVICE).not.toMatch(/status:\s*'RELEASED'/);
	});

	it('parents cannot cascade the ledger away', () => {
		const tenant = MIGRATION.match(/tenant_id uuid NOT NULL REFERENCES tenants\(id\) ON DELETE (\w+)/)?.[1];
		const vehicle = MIGRATION.match(/vehicle_id uuid NOT NULL REFERENCES vehicles\(id\) ON DELETE (\w+)/)?.[1];
		// A cascade would release the forever-lock on a reference whose physical
		// device may still be reporting.
		expect(tenant).toBe('RESTRICT');
		expect(vehicle).toBe('RESTRICT');
	});

	it('expiry is applied lazily, so an unswept row cannot lock a vehicle out', () => {
		// Letting a code expire and clicking "start again" is the single most
		// common action in the flow; it must never wait on a sweeper.
		expect(SERVICE).toContain("closedReason: 'EXPIRED'");
		expect(SERVICE).toMatch(/lt\(schema\.trackerEnrollments\.expiresAt, new Date\(\)\)/);
	});

	it('replacing keeps the old tracker live until the new one binds', () => {
		const bindAt = SERVICE.indexOf('async function bindEnrollment');
		const replacedAt = SERVICE.indexOf("closedReason: 'REPLACED'");
		expect(replacedAt).toBeGreaterThan(bindAt);
	});
});

describe('the setup code is treated as a secret', () => {
	it('the polling endpoint returns status only', () => {
		const src = read('src/routes/app/vehicles/[id]/tracking/status/+server.ts');
		expect(src).not.toContain('deviceRef');
		expect(src).not.toContain('configurationUri');
	});

	it('the QR is no-store and no-referrer', () => {
		const src = read('src/routes/app/vehicles/[id]/tracking/qr/+server.ts');
		expect(src).toContain("'Cache-Control': 'no-store, private'");
		expect(src).toContain("'Referrer-Policy': 'no-referrer'");
	});

	it('every route guards inside itself', () => {
		// A layout load does not protect a form action, and a +server.ts does not
		// run parent layout loads at all.
		for (const f of [
			'src/routes/app/vehicles/[id]/tracking/status/+server.ts',
			'src/routes/app/vehicles/[id]/tracking/qr/+server.ts'
		]) {
			const src = read(f);
			expect(src).toContain('requireTenantPermission');
			expect(src).toContain("requirePermission(locals.permissions, 'vehicles:write')");
		}
	});
});

describe('the phone is configured correctly or not at all', () => {
	it('the server URL the app stores carries no query string', async () => {
		const { configurationUri } = await import('../src/lib/server/tracking/enrollment');
		process.env.TRACCAR_BASE_URL = 'https://tracking.example.invalid';
		const uri = configurationUri('ABCDEFGHJKMNPQR2', 'SAFARI');
		const [base, query] = uri.split('?');
		// The app stores origin+path and applies the query as settings. A query
		// left ON the stored URL makes the ingest decoder read URI params instead
		// of the POST body and reject every report with a 400, silently, forever.
		expect(base).toMatch(/\/osmand$/);
		expect(query).toContain('id=ABCDEFGHJKMNPQR2');
	});

	it('offers named presets, never raw coupled fields', async () => {
		const { PROFILES } = await import('../src/lib/server/tracking/enrollment');
		expect(Object.keys(PROFILES)).toEqual(['SAFARI', 'TOWN', 'BATTERY']);
		// The app couples these: highest accuracy zeroes distance and interval, and
		// any distance zeroes interval. Exposing them singly offers combinations
		// that silently rewrite each other.
		for (const p of Object.values(PROFILES)) expect(p.accuracy).not.toBe('highest');
	});
});
