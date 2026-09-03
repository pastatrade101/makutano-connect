// Who a public request is rate-limited AS.
//
// Two failures are possible here and they point in opposite directions:
//
//   Believing an unauthenticated "here is my IP" header. Then the limiter is not
//   a limiter — an abuser sends a fresh value per request and is never counted.
//
//   Refusing to believe a TRUSTED origin. Then the marketplace, which submits
//   enquiries from a server-side form action, collapses every traveller on the
//   internet into one bucket of ten per ten minutes, and the eleventh person
//   loses their enquiry having done nothing wrong.
//
// The secret is what separates the two cases, so most of these tests are about
// what happens when it is absent, wrong, or unset.
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const SECRET = 'a-shared-secret-only-the-marketplace-knows';

/** A request event with just enough shape for clientKey(). */
function eventWith(headers: Record<string, string>, peer = '203.0.113.9') {
	return {
		getClientAddress: () => peer,
		request: { headers: new Headers(headers) }
	} as unknown as Parameters<typeof import('../src/lib/server/public-api').clientKey>[0];
}

async function loadClientKey(secret: string | null) {
	vi.resetModules();
	if (secret === null) vi.stubEnv('ORIGIN_SHARED_SECRET', '');
	else vi.stubEnv('ORIGIN_SHARED_SECRET', secret);
	const mod = await import('../src/lib/server/public-api');
	return mod.clientKey;
}

beforeEach(() => vi.unstubAllEnvs());

describe('a public caller is counted as the person, not the relay', () => {
	it('uses the peer address when nothing is forwarded', async () => {
		const clientKey = await loadClientKey(SECRET);
		const a = clientKey(eventWith({}, '198.51.100.1'));
		const b = clientKey(eventWith({}, '198.51.100.2'));
		expect(a).not.toBe(b);
	});

	it('IGNORES a forwarded address with no secret — the whole point', async () => {
		const clientKey = await loadClientKey(SECRET);
		const peer = '203.0.113.9';
		const forged = clientKey(eventWith({ 'x-makutano-client-ip': '1.2.3.4' }, peer));
		// An abuser rotating this header must not get a fresh bucket each time.
		expect(forged).toBe(clientKey(eventWith({ 'x-makutano-client-ip': '5.6.7.8' }, peer)));
		expect(forged).toBe(clientKey(eventWith({}, peer)));
	});

	it('ignores a forwarded address presented with the WRONG secret', async () => {
		const clientKey = await loadClientKey(SECRET);
		const peer = '203.0.113.9';
		const wrong = clientKey(
			eventWith({ 'x-makutano-origin-secret': 'not-the-secret', 'x-makutano-client-ip': '1.2.3.4' }, peer)
		);
		expect(wrong).toBe(clientKey(eventWith({}, peer)));
	});

	it('counts two travellers separately when a trusted origin vouches for them', async () => {
		const clientKey = await loadClientKey(SECRET);
		const relay = '10.0.0.5';
		const one = clientKey(eventWith({ 'x-makutano-origin-secret': SECRET, 'x-makutano-client-ip': '1.2.3.4' }, relay));
		const two = clientKey(eventWith({ 'x-makutano-origin-secret': SECRET, 'x-makutano-client-ip': '5.6.7.8' }, relay));
		// The bug being fixed: these used to be the same key.
		expect(one).not.toBe(two);
		// And neither is the relay's own key.
		expect(one).not.toBe(clientKey(eventWith({}, relay)));
	});

	it('cannot be switched on by an empty secret on either side', async () => {
		const clientKey = await loadClientKey(null); // feature not configured
		const peer = '203.0.113.9';
		// An attacker sending an empty secret must not match an unset one.
		const forged = clientKey(eventWith({ 'x-makutano-origin-secret': '', 'x-makutano-client-ip': '1.2.3.4' }, peer));
		expect(forged).toBe(clientKey(eventWith({}, peer)));
	});

	it('refuses a forwarded value that is not shaped like an address', async () => {
		const clientKey = await loadClientKey(SECRET);
		const peer = '203.0.113.9';
		const base = clientKey(eventWith({}, peer));
		for (const junk of ['not an ip', '1.2.3.4, 5.6.7.8', 'x'.repeat(200), '<script>', '../../etc']) {
			expect(clientKey(eventWith({ 'x-makutano-origin-secret': SECRET, 'x-makutano-client-ip': junk }, peer))).toBe(base);
		}
	});

	it('never returns the address itself', async () => {
		const clientKey = await loadClientKey(SECRET);
		const key = clientKey(eventWith({ 'x-makutano-origin-secret': SECRET, 'x-makutano-client-ip': '1.2.3.4' }, '10.0.0.5'));
		expect(key).not.toContain('1.2.3.4');
		expect(key).toHaveLength(24);
	});
});

describe('a secret must never be named so SvelteKit calls it public', () => {
	/*
	 * This suite passes under vitest even when the variable is misnamed, because
	 * the test runner maps $env/dynamic/private straight to process.env without
	 * SvelteKit's prefix filter. Production does apply it, so the tests above can
	 * be green while the feature is inert and the secret is browser-classified.
	 *
	 * This asserts against SvelteKit's OWN filter_env — the exact function the
	 * server calls at startup — so the runner cannot paper over it.
	 */
	it('routes ORIGIN_SHARED_SECRET to the server and never to the browser', async () => {
		const { filter_env } = await import('../node_modules/@sveltejs/kit/src/utils/env.js');
		const sample = { ORIGIN_SHARED_SECRET: 'value', PUBLIC_ORIGIN_SHARED_SECRET: 'value' };
		const priv = filter_env(sample, '', 'PUBLIC_');
		const pub = filter_env(sample, 'PUBLIC_', '');

		expect('ORIGIN_SHARED_SECRET' in priv).toBe(true);
		expect('ORIGIN_SHARED_SECRET' in pub).toBe(false);

		// And the trap this guards against, stated out loud: the PUBLIC_ name is
		// unreadable by the server and handed to every visitor.
		expect('PUBLIC_ORIGIN_SHARED_SECRET' in priv).toBe(false);
		expect('PUBLIC_ORIGIN_SHARED_SECRET' in pub).toBe(true);
	});

	it('declares no PUBLIC_-prefixed SECRET in the server env schema', async () => {
		const { readFileSync } = await import('node:fs');
		const source = readFileSync('src/lib/server/env.ts', 'utf8');
		const publicNames = [...source.matchAll(/^\s*(PUBLIC_[A-Z0-9_]+)\s*:/gm)].map((m) => m[1]);
		// PUBLIC_APP_URL is deliberate and harmless — it is the console's own
		// address, which every visitor already knows. What must never appear is a
		// CREDENTIAL under that prefix, because the prefix is what decides which
		// half of the environment the browser is allowed to see.
		const secretish = publicNames.filter((n) => /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL/.test(n));
		expect(secretish).toEqual([]);
	});
});
