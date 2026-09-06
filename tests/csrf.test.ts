// The cross-site form rule, now that it is ours.
//
// SvelteKit's own check was turned off (svelte.config.js) so one signature-
// authenticated webhook could be exempt. That trade is only safe if this rule is
// exactly as strict as the one it replaced for every OTHER route — a mistake here
// does not fail loudly, it silently accepts forged form posts across the whole app.
import { describe, expect, it } from 'vitest';
import { isCrossSiteFormPost, isFormContentType } from '../src/lib/server/csrf';

const APP = 'https://connect.makutano.co.tz';
const post = (over: Partial<Parameters<typeof isCrossSiteFormPost>[0]> = {}) =>
	isCrossSiteFormPost({
		method: 'POST',
		pathname: '/app/settings/whatsapp',
		contentType: 'application/x-www-form-urlencoded',
		origin: APP,
		appOrigin: APP,
		...over
	});

describe('it blocks what SvelteKit blocked', () => {
	it('blocks a form POST from another origin', () => {
		expect(post({ origin: 'https://evil.example' })).toBe(true);
	});

	it('blocks a form POST with NO origin — the clause trustedOrigins cannot satisfy', () => {
		expect(post({ origin: null })).toBe(true);
	});

	it('blocks every mutating method, not just POST', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
			expect(post({ method, origin: 'https://evil.example' })).toBe(true);
		}
	});

	it('blocks every content type a browser form can send', () => {
		for (const contentType of [
			'application/x-www-form-urlencoded',
			'multipart/form-data; boundary=----x',
			'text/plain',
			'application/x-sveltekit-formdata'
		]) {
			expect(post({ contentType, origin: 'https://evil.example' })).toBe(true);
		}
	});

	it('is not fooled by casing or charset parameters', () => {
		expect(post({ contentType: 'APPLICATION/X-WWW-FORM-URLENCODED; charset=UTF-8', origin: 'https://evil.example' })).toBe(true);
	});

	it('blocks a near-miss origin — a prefix is not a match', () => {
		expect(post({ origin: 'https://connect.makutano.co.tz.evil.example' })).toBe(true);
	});
});

describe('it allows what SvelteKit allowed', () => {
	it('allows our own forms', () => expect(post()).toBe(false));
	it('allows GET and HEAD whatever the origin', () => {
		expect(post({ method: 'GET', origin: 'https://evil.example' })).toBe(false);
		expect(post({ method: 'HEAD', origin: 'https://evil.example' })).toBe(false);
	});
	it('allows cross-origin JSON — an API key authenticates those, not an origin', () => {
		expect(post({ contentType: 'application/json', origin: 'https://evil.example' })).toBe(false);
	});
});

describe('the exemption is exactly one route', () => {
	it('exempts Meta’s deauthorize callback, which verifies an HMAC over its body', () => {
		expect(post({ pathname: '/webhooks/meta/deauthorize', origin: null })).toBe(false);
	});

	it('does NOT exempt anything else under /webhooks — no prefix matching', () => {
		for (const pathname of [
			'/webhooks/meta/whatsapp',
			'/webhooks/meta/deauthorize/extra',
			'/webhooks/meta/deauthorize2',
			'/webhooks'
		]) {
			expect(post({ pathname, origin: null })).toBe(true);
		}
	});

	it('does not let a crafted path smuggle its way into the exemption', () => {
		// The pathname is compared whole, so no traversal or query trick reaches it.
		for (const pathname of ['/webhooks/meta/deauthorize/', '//webhooks/meta/deauthorize']) {
			expect(post({ pathname, origin: null })).toBe(true);
		}
	});
});

describe('content type detection', () => {
	it('treats a missing content type as not a form', () => {
		expect(isFormContentType(null)).toBe(false);
		expect(isFormContentType('')).toBe(false);
	});
});
