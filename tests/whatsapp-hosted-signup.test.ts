// The second door onto Embedded Signup: Meta's hosted page.
//
// The JS SDK opens a popup from our domain and hands the code back through a
// callback. Meta's hosted page leaves our domain entirely and returns by
// redirecting to /connect/whatsapp?code=…&state=…. That difference is the whole
// risk surface, and these are the three things that make it safe.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LAUNCHER = readFileSync('src/routes/connect/whatsapp/+page.svelte', 'utf8');
const SERVER = readFileSync('src/routes/connect/whatsapp/+page.server.ts', 'utf8');
const EXCHANGE = readFileSync('src/lib/server/whatsapp/embedded-signup.ts', 'utf8');
const CONFIG = readFileSync('src/lib/server/whatsapp/config.ts', 'utf8');

describe('a code arriving in the URL is only exchanged when a token came back with it', () => {
	// Without this the page exchanges ANY code handed to it in a link. Someone who got
	// a signed-in operator to open /connect/whatsapp?code=<their own code> would have
	// had THEIR WhatsApp number bound to that operator's tenant.
	it('refuses a bare ?code= with no session or state', () => {
		expect(LAUNCHER).toMatch(/if\s*\(!sessionToken\)\s*\{[\s\S]{0,240}?return;/);
	});

	it('submits only after the token check, never before it', () => {
		const guard = LAUNCHER.indexOf('if (!sessionToken)');
		const submit = LAUNCHER.indexOf('formEl.requestSubmit()', guard);
		expect(guard).toBeGreaterThan(-1);
		expect(submit).toBeGreaterThan(guard);
	});

	it('accepts Meta’s state as the same binding a session link carries', () => {
		expect(LAUNCHER).toMatch(/searchParams\.get\('session'\)\s*\?\?\s*page\.url\.searchParams\.get\('state'\)/);
		expect(SERVER).toMatch(/searchParams\.get\('session'\)\s*\?\?\s*url\.searchParams\.get\('state'\)/);
	});
});

describe('the redirect_uri is sent to Meta only on the path that was issued against one', () => {
	// A code from FB.login carries no redirect_uri and sending one makes Meta reject
	// the exchange outright, so the bare call has to stay first and unconditional.
	it('tries the bare exchange first', () => {
		const bare = EXCHANGE.indexOf("path: 'oauth/access_token'");
		const retry = EXCHANGE.indexOf('redirect_uri: redirectUri');
		expect(bare).toBeGreaterThan(-1);
		expect(retry).toBeGreaterThan(bare);
	});

	it('never retries when no redirect_uri was supplied — the SDK path is unchanged', () => {
		expect(EXCHANGE).toMatch(/if\s*\(!redirectUri\)\s*throw err;/);
	});

	it('marks the hosted flow explicitly rather than guessing', () => {
		expect(SERVER).toMatch(/String\(data\.get\('flow'\) \?\? ''\) === 'hosted'/);
		expect(SERVER).toMatch(/redirectUri: hosted \? signupRedirectUri\(\) : null/);
	});
});

describe('both doors run the same onboarding', () => {
	it('uses the SDK’s empty featureType, not the coexistence variant', () => {
		expect(CONFIG).toMatch(/featureType:\s*''/);
		expect(CONFIG).not.toMatch(/whatsapp_business_app_onboarding'/);
	});

	it('always carries the state that binds the return leg to a tenant', () => {
		expect(CONFIG).toMatch(/state:\s*params\.state/);
	});

	it('refuses to build a link when the app is not configured', () => {
		expect(CONFIG).toMatch(/if\s*\(!c\.appId\s*\|\|\s*!c\.configId\)\s*return null;/);
	});
});
