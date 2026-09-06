// Meta's Deauthorize callback (§9).
//
// Meta pings this when someone removes our app from their business. Until now the
// field was empty, so a business could revoke us and we would never know: the
// connection stayed CONNECTED, the operator kept seeing a healthy WhatsApp number,
// and every send failed against a token that no longer existed.
//
// It is NOT a webhook. There is no X-Hub-Signature-256 header — the proof is a
// `signed_request` form field, and the payload names a Facebook user rather than a
// number, which is why connections carry meta_user_id.
//
// Meta ignores the body and retries anything that is not a prompt 200, so this
// answers 200 for every request it can parse — including one that maps to nothing.
// A refusal is reserved for a payload we cannot verify, because acting on one of
// those would let anyone disconnect a tenant's WhatsApp with a single POST.
import type { RequestHandler } from './$types';
import { json, text } from '@sveltejs/kit';
import { log } from '$lib/server/logger';
import { audit } from '$lib/server/audit';
import { metaAppConfig } from '$lib/server/whatsapp/config';
import { parseSignedRequest } from '$lib/server/whatsapp/signed-request';
import { revokeByMetaUserId } from '$lib/server/whatsapp/connections';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const signed = form ? String(form.get('signed_request') ?? '') : '';

	const parsed = parseSignedRequest(signed || null, metaAppConfig().appSecret);
	if (!parsed.ok) {
		// no_app_secret is a deployment fault rather than an attack, but it is still a
		// reason to refuse: an unverified payload cannot be trusted to revoke anything.
		log.warn('meta_deauthorize_rejected', { reason: parsed.reason });
		return text('Forbidden', { status: 403 });
	}

	if (!parsed.userId) {
		log.warn('meta_deauthorize_no_user', {});
		return json({ ok: true });
	}

	const revoked = await revokeByMetaUserId(parsed.userId);
	if (!revoked.length) {
		// Expected in two ordinary cases: a user who never completed Embedded Signup,
		// and a connection made before meta_user_id was recorded. Logged rather than
		// silently dropped, so an operator reporting "sends fail but it says connected"
		// has something to match against.
		log.info('meta_deauthorize_unmatched', { metaUserId: parsed.userId });
		return json({ ok: true });
	}

	for (const connection of revoked) {
		log.warn('meta_deauthorized', {
			tenantId: connection.tenantId,
			connectionId: connection.id,
			phoneNumberId: connection.phoneNumberId
		});
		await audit(
			connection.tenantId,
			'whatsapp.deauthorized',
			{ type: 'system' },
			{ type: 'whatsapp_connection', id: connection.id },
			{ phoneNumberId: connection.phoneNumberId, reason: 'meta_deauthorize_callback' }
		);
	}

	return json({ ok: true, revoked: revoked.length });
};
