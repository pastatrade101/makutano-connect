// The proof carried by Meta's Deauthorize callback.
//
// This endpoint takes a tenant's WhatsApp number out of service, and it is
// unauthenticated in every ordinary sense — no session, no API key, no
// X-Hub-Signature-256 header. The signature IS the authorisation, so every way of
// getting past it without the app secret is a way to disconnect someone's WhatsApp
// with a single POST.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSignedRequest, signRequest } from '../src/lib/server/whatsapp/signed-request';

const SECRET = 'app-secret-under-test';
const OTHER = 'a-different-app-secret';
const PAYLOAD = { user_id: '61550000000001', algorithm: 'HMAC-SHA256', issued_at: 1788713000 };

describe('a genuine signed_request is accepted', () => {
	it('verifies and returns the user', () => {
		const result = parseSignedRequest(signRequest(PAYLOAD, SECRET), SECRET);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.userId).toBe('61550000000001');
	});

	it('accepts the algorithm however Meta spells it', () => {
		for (const algorithm of ['HMAC-SHA256', 'hmac-sha256', 'HMACSHA256']) {
			const result = parseSignedRequest(signRequest({ ...PAYLOAD, algorithm }, SECRET), SECRET);
			expect(result.ok).toBe(true);
		}
	});

	it('reports no user rather than inventing one when the payload omits it', () => {
		const { user_id, ...withoutUser } = PAYLOAD;
		const result = parseSignedRequest(signRequest(withoutUser, SECRET), SECRET);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.userId).toBeNull();
	});
});

describe('anything it cannot prove is refused', () => {
	it('refuses a signature made with a different secret', () => {
		const result = parseSignedRequest(signRequest(PAYLOAD, OTHER), SECRET);
		expect(result).toEqual({ ok: false, reason: 'bad_signature' });
	});

	it('refuses a payload edited after signing', () => {
		const signed = signRequest(PAYLOAD, SECRET);
		const [signature] = signed.split('.');
		const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, user_id: '99999999999999' }), 'utf8').toString('base64url');
		expect(parseSignedRequest(`${signature}.${forged}`, SECRET)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('refuses an unsigned payload presented as if it were signed', () => {
		const payload = Buffer.from(JSON.stringify(PAYLOAD), 'utf8').toString('base64url');
		const result = parseSignedRequest(`.${payload}`, SECRET);
		expect(result.ok).toBe(false);
	});

	it('refuses a downgraded algorithm — the classic signed-token attack', () => {
		// Correctly signed, but naming an algorithm we never agreed to.
		const signed = signRequest({ ...PAYLOAD, algorithm: 'none' }, SECRET);
		expect(parseSignedRequest(signed, SECRET)).toEqual({ ok: false, reason: 'unexpected_algorithm' });
	});

	it('refuses when the app secret is unset, rather than trusting the payload', () => {
		expect(parseSignedRequest(signRequest(PAYLOAD, SECRET), '')).toEqual({
			ok: false,
			reason: 'no_app_secret'
		});
	});

	it('refuses malformed envelopes and junk', () => {
		for (const raw of ['', 'not-a-signed-request', 'a.b.c', 'AAAA.']) {
			expect(parseSignedRequest(raw || null, SECRET).ok).toBe(false);
		}
	});

	it('refuses a payload that is valid base64 but not JSON', () => {
		const notJson = Buffer.from('this is not json', 'utf8').toString('base64url');
		const signature = crypto.createHmac('sha256', SECRET).update(notJson, 'utf8').digest().toString('base64url');
		expect(parseSignedRequest(`${signature}.${notJson}`, SECRET)).toEqual({
			ok: false,
			reason: 'payload_not_json'
		});
	});
});

describe('the signature covers the encoded payload, not the re-serialised JSON', () => {
	// Re-encoding the decoded object to check it breaks on any non-canonical key
	// order — the bug that makes a verifier reject perfectly genuine callbacks.
	it('verifies a payload whose keys are not in canonical order', () => {
		const oddOrder = { issued_at: 1788713000, user_id: '61550000000001', algorithm: 'HMAC-SHA256' };
		expect(parseSignedRequest(signRequest(oddOrder, SECRET), SECRET).ok).toBe(true);
	});
});
