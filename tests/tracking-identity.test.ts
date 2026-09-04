// Phase 1 security prerequisites: who Connect speaks as, and what it never says.
//
// Two failures this suite exists to prevent, both of which were REAL before it:
//
//   Shipping the tracker reference to a browser. That string is credential
//   material — it needs no Connect session to use, and anyone holding it can
//   configure a phone to post positions as that vehicle. It was rendered to
//   every VIEWER and baked into the SSR payload, where it survives screenshots,
//   screen shares and offboarding.
//
//   Reading as the platform administrator. That made the provider's own
//   permission system inert: a fleet list asked for "every device you can see"
//   and got every device belonging to every tenant, with isolation resting
//   entirely on Connect filtering its own results afterwards.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the tracker reference never leaves the server', () => {
	it('is not in the vehicles page payload', () => {
		const src = read('src/routes/app/vehicles/+page.server.ts');
		// `tracked: Boolean(...)` is fine and expected; the raw string is not.
		expect(src).not.toContain('trackerDeviceRef: v.trackerDeviceRef');
		expect(src).toContain('tracked: Boolean(v.trackerDeviceRef)');
	});

	it('is not rendered anywhere in the vehicles UI', () => {
		expect(read('src/routes/app/vehicles/+page.svelte')).not.toContain('v.trackerDeviceRef');
	});

	it('appears in no browser-reachable file anywhere in the app', () => {
		// A grep, deliberately: the next leak will be a new file, not this one.
		const hits = execSync(
			"grep -rl 'trackerDeviceRef' src/ || true",
			{ encoding: 'utf8' }
		)
			.split('\n')
			.filter(Boolean)
			// Server-only modules may of course name the column they own.
			.filter((f) => !f.startsWith('src/lib/server/'));
		expect(hits).toEqual(['src/routes/app/vehicles/+page.server.ts']);
	});

	it('is never accepted from a caller', () => {
		const vehicles = read('src/lib/server/vehicles.ts');
		// The set-by-typing path was the claim-by-guessing weakness.
		expect(vehicles).not.toContain('setVehicleTracker');
		expect(vehicles).toContain('clearVehicleTracker');
		expect(read('src/routes/app/vehicles/+page.svelte')).not.toContain('name="deviceRef"');
		expect(read('src/routes/app/vehicles/+page.server.ts')).not.toContain("str(d, 'deviceRef')");
	});
});

describe('runtime reads speak as the tenant, never as the platform', () => {
	it('a provider cannot be constructed without an identity', async () => {
		const { TraccarProvider } = await import('../src/lib/server/tracking/traccar');
		// @ts-expect-error - the point of the test is that this no longer compiles
		expect(() => new TraccarProvider()).toBeDefined();
		const scoped = new TraccarProvider({ baseUrl: 'https://x.invalid', username: 'a', password: 'b' });
		expect(scoped.isConfigured()).toBe(true);
	});

	it('an identity with no credentials is not configured, so it reads NOT_CONFIGURED', async () => {
		const { TraccarProvider } = await import('../src/lib/server/tracking/traccar');
		const empty = new TraccarProvider({ baseUrl: 'https://x.invalid', username: '', password: '' });
		expect(empty.isConfigured()).toBe(false);
		// Not UNAVAILABLE: nothing failed, the tenant simply has no identity.
		expect((await empty.snapshot('anything')).state).toBe('NOT_CONFIGURED');
	});

	it('the tracking service holds no process-wide provider instance', () => {
		const src = read('src/lib/server/tracking/index.ts');
		// A module-level `new TraccarProvider()` is exactly the object that could
		// see the whole platform.
		expect(src).not.toMatch(/^const providers[^=]*=\s*\{\s*\n\s*TRACCAR: new TraccarProvider\(\)/m);
		expect(src).toContain('await providerFor(tenantId');
	});

	it('the provisioning client is unreachable from any route', () => {
		const hits = execSync(
			"grep -rl 'traccar-admin' src/routes/ || true",
			{ encoding: 'utf8' }
		).split('\n').filter(Boolean);
		// Creating users and devices is not something a request handler may do.
		expect(hits).toEqual([]);
	});

	it("a tenant's runtime identity is created read-only", async () => {
		const { TENANT_USER_FLAGS } = await import('../src/lib/server/tracking/traccar-admin');
		// readonly closes the self-unlink attack that makes any device limit
		// meaningless, and removes DELETE /api/positions from a non-admin.
		expect(TENANT_USER_FLAGS.readonly).toBe(true);
		expect(TENANT_USER_FLAGS.deviceReadonly).toBe(true);
		expect(TENANT_USER_FLAGS.administrator).toBe(false);
		expect(TENANT_USER_FLAGS.userLimit).toBe(0);
		// History is authorised through reports; disabling them would break it.
		expect(TENANT_USER_FLAGS.disableReports).toBe(false);
	});

	it('redaction follows the identity, not the process', () => {
		const src = read('src/lib/server/tracking/traccar.ts');
		// Per-tenant passwords would otherwise be free to reach a log, because the
		// old redaction only knew about one ambient credential.
		expect(src).toContain('safeReason(err, this.credentials)');
		expect(src).not.toContain('env().TRACCAR_TOKEN');
	});
});

describe('the deployment is pinned to the version the integration was verified against', () => {
	it('compose does not float on latest', () => {
		const compose = read('../makutano-traccar/docker-compose.yml');
		expect(compose).toContain('traccar/traccar:${TRACCAR_VERSION:-6.15.3}');
		expect(compose).not.toContain('TRACCAR_VERSION:-latest');
	});
});
