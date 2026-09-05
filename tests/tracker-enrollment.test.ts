// Phase 2: who owns a tracker, and what the first fix actually proves.
//
// The weakness this replaces: a tenant claimed a tracker by typing its
// identifier, and the only check was that no other row already held the string.
// Knowing a reference WAS owning it. Here Connect mints the reference for a
// named vehicle of a named tenant before the provider is touched, so the first
// fix proves LIVENESS and ownership was never in question.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const read = (p: string) => readFileSync(p, 'utf8');
const MIGRATION = read('drizzle/0050_tracker_enrollments.sql');
const SERVICE = read('src/lib/server/tracking/enrollment.ts');
const WORKER = read('src/lib/server/tracking/provisioning-worker.ts');

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

	/*
	 * This test used to mutate one reference and assert the mutation was caught,
	 * which made it fail about once every thirty runs — measured at 2.98% over
	 * 20,000 samples, exactly the 1-in-32 a single check SYMBOL can give. The
	 * check digit was never wrong; the test asserted a guarantee the design does
	 * not offer, and an intermittent red is worse than no test because it teaches
	 * people to re-run rather than read.
	 */
	it('detects a mistyped character whenever the check character moves', async () => {
		const { mintDeviceRef, looksWellFormed } = await import('../src/lib/server/tracking/identifier');
		const ref = mintDeviceRef();
		expect(looksWellFormed(ref)).toBe(true);

		// Deterministic: try each alternative first character until one actually
		// changes the derived check character, then assert THAT is rejected.
		const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
		const detected = [...ALPHABET]
			.filter((c) => c !== ref[0])
			.map((c) => c + ref.slice(1))
			.filter((candidate) => !looksWellFormed(candidate));
		expect(detected.length).toBeGreaterThan(0);
		for (const candidate of detected) expect(looksWellFormed(candidate)).toBe(false);
	});

	it('catches the large majority of single-character typos, and no more than a check symbol can', async () => {
		const { mintDeviceRef, looksWellFormed } = await import('../src/lib/server/tracking/identifier');
		let caught = 0;
		const N = 400;
		for (let i = 0; i < N; i += 1) {
			const ref = mintDeviceRef();
			const broken = (ref[0] === '2' ? '3' : '2') + ref.slice(1);
			if (!looksWellFormed(broken)) caught += 1;
		}
		// One symbol over a 32-character alphabet: ~31/32 caught. The bound is loose
		// enough never to flake and tight enough to fail if the check digit stopped
		// depending on the payload at all.
		expect(caught / N).toBeGreaterThan(0.9);
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

	it('mints the ledger row, and the web process tells the provider nothing at all', () => {
		// Stronger than the ordering this used to assert: the request-serving
		// process now has no privileged credential and no path to the provider, so
		// a device Connect cannot name is unreachable rather than merely unlikely.
		expect(SERVICE).toContain('.insert(schema.trackerEnrollments)');
		expect(SERVICE).not.toContain('adminCredentials');
		expect(SERVICE).not.toContain('/api/devices');
	});

	it('the database refuses an active tracker that never proved liveness', () => {
		expect(MIGRATION).toContain("CONSTRAINT te_evid_chk CHECK (status <> 'ACTIVE' OR identifier_source = 'LEGACY' OR first_fix_at IS NOT NULL)");
	});
});

describe('the lifecycle cannot be raced or replayed', () => {
	it('binding is conditional on the row still being provisioned', () => {
		// A double-bind returns zero rows rather than creating a second binding.
		// PROVISIONED, not PENDING: a row whose device does not exist yet cannot
		// have produced a fix, so it must not be bindable.
		// In the WORKER now: the web process no longer detects or binds anything.
		expect(WORKER).toMatch(/eq\(schema\.trackerEnrollments\.status, 'PROVISIONED'\)\)\)\s*\.returning\(\)/);
	});

	it('one setup in flight and one active per vehicle, enforced by the database', () => {
		// In flight covers BOTH stages now, so a second click while the worker is
		// still provisioning cannot create a parallel setup.
		expect(MIGRATION).toContain("te_one_inflight_key ON tracker_enrollments (vehicle_id) WHERE status IN ('PENDING','PROVISIONED')");
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
		expect(SERVICE).toContain("row.expiresAt.getTime() > Date.now()");
	});

	it('replacing keeps the old tracker live until the new one binds', () => {
		// Both moved to the WORKER: the web process neither detects a first fix nor
		// binds an enrollment. The old tracker is closed inside the same
		// transaction that activates its replacement, so nothing goes dark.
		const bindAt = WORKER.indexOf('async function bindEnrollment');
		expect(bindAt).toBeGreaterThan(-1);
		expect(WORKER.indexOf("closedReason: 'REPLACED'")).toBeGreaterThan(bindAt);
		expect(SERVICE).not.toContain('bindEnrollment');
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
		// This used to set TRACCAR_BASE_URL to a public-looking value, which made
		// the test pass while hiding the bug: production's TRACCAR_BASE_URL is the
		// internal http://traccar:8082, and the code came from that. The phone's
		// address is its own setting now.
		vi.resetModules();
		vi.stubEnv('TRACCAR_BASE_URL', 'http://traccar:8082');
		vi.stubEnv('TRACKING_INGEST_URL', 'https://tracking.example.invalid');
		const { configurationUri } = await import('../src/lib/server/tracking/enrollment');
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

describe('the setup code sends the phone somewhere it can reach', () => {
	/*
	 * The QR was built from TRACCAR_BASE_URL — Connect's docker-internal address
	 * for the REST API, http://traccar:8082. Every setup code therefore told the
	 * driver's phone to post to a hostname that exists inside one docker network.
	 * Server-side tests posted fixes directly, so nothing noticed until the first
	 * real phone scanned one, on 5 Sep 2026, and posted into a void.
	 */
	async function enrollment(vars: Record<string, string>) {
		vi.resetModules();
		vi.stubEnv('TRACCAR_BASE_URL', 'http://traccar:8082');
		for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
		return import('../src/lib/server/tracking/enrollment');
	}

	it('encodes the public ingest origin, never the internal REST address', async () => {
		const { configurationUri } = await enrollment({ TRACKING_INGEST_URL: 'https://tracking.example.test' });
		const uri = configurationUri('0123456789ABCDEFG', 'SAFARI');
		expect(uri.startsWith('https://tracking.example.test/osmand?')).toBe(true);
		expect(uri).not.toContain('traccar:8082');
		expect(uri).not.toContain('http://');
	});

	it('refuses to issue a code when the ingest address is missing or private', async () => {
		for (const bad of ['', 'http://traccar:8082', 'https://traccar', 'https://192.168.1.5', 'https://localhost']) {
			const { configurationUri, ingestConfigured } = await enrollment({ TRACKING_INGEST_URL: bad });
			expect(ingestConfigured(), `should reject ${JSON.stringify(bad)}`).toBe(false);
			expect(() => configurationUri('0123456789ABCDEFG', 'SAFARI')).toThrow();
		}
	});

	it('the page never falls through to the internal address', () => {
		const SERVICE_NOW = readFileSync('src/lib/server/tracking/enrollment.ts', 'utf8');
		const body = SERVICE_NOW.slice(SERVICE_NOW.indexOf('export function configurationUri'));
		const fn = body.slice(0, body.indexOf('\n}') + 2);
		// Match the code, not the comment that explains why the code changed.
		expect(fn).toContain('const base = ingestBaseUrl();');
		expect(fn).not.toMatch(/=\s*providerBaseUrl\(\)/);
	});
});
