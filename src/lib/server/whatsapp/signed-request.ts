// Meta's signed_request — the format behind the Deauthorize and Data Deletion
// callbacks (§9).
//
// It is NOT the webhook format. A webhook is JSON with an X-Hub-Signature-256
// header; this is a form POST whose single `signed_request` field is
// `<base64url signature>.<base64url payload>`, and the signature covers the
// ENCODED payload string, not the decoded JSON. Re-encoding the JSON to check it
// produces a mismatch on every request that contains a non-canonical field order.
//
// Everything here is pure so it can be tested without a database or a network.
import crypto from 'node:crypto';

export type SignedRequestPayload = {
	user_id?: string;
	algorithm?: string;
	issued_at?: number;
	[key: string]: unknown;
};

export type SignedRequestResult =
	| { ok: true; payload: SignedRequestPayload; userId: string | null }
	| { ok: false; reason: string };

function fromBase64Url(input: string): Buffer {
	// Meta strips the padding; Buffer's base64url decoder restores it.
	return Buffer.from(input, 'base64url');
}

/**
 * Verify and decode a signed_request.
 *
 * Refuses anything it cannot prove: a missing app secret, a malformed envelope, an
 * algorithm we did not expect, or a signature that does not match. There is no
 * "probably fine" branch — a payload we cannot verify is a payload an attacker
 * could have written, and acting on it would disconnect a tenant's WhatsApp.
 */
export function parseSignedRequest(raw: string | null, appSecret: string): SignedRequestResult {
	if (!appSecret) return { ok: false, reason: 'no_app_secret' };
	if (!raw) return { ok: false, reason: 'missing_signed_request' };

	const parts = raw.split('.');
	if (parts.length !== 2) return { ok: false, reason: 'malformed' };
	const [encodedSignature, encodedPayload] = parts;
	if (!encodedSignature || !encodedPayload) return { ok: false, reason: 'malformed' };

	let payload: SignedRequestPayload;
	try {
		payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
	} catch {
		return { ok: false, reason: 'payload_not_json' };
	}
	if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload_not_json' };

	// Meta has only ever sent HMAC-SHA256 here. Accepting whatever the payload names
	// would let a caller pick a weaker one — the classic signed-token downgrade.
	if (String(payload.algorithm ?? '').toUpperCase().replace('-', '') !== 'HMACSHA256') {
		return { ok: false, reason: 'unexpected_algorithm' };
	}

	const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload, 'utf8').digest();
	const actual = fromBase64Url(encodedSignature);
	if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
		return { ok: false, reason: 'bad_signature' };
	}

	const userId = payload.user_id ? String(payload.user_id) : null;
	return { ok: true, payload, userId };
}

/** Build one, for tests and for local verification of the live endpoint. */
export function signRequest(payload: SignedRequestPayload, appSecret: string): string {
	const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = crypto
		.createHmac('sha256', appSecret)
		.update(encodedPayload, 'utf8')
		.digest()
		.toString('base64url');
	return `${signature}.${encodedPayload}`;
}
