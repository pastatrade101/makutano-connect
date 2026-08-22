// §9 Meta webhooks. This route is deliberately outside /api/v1: Meta authenticates
// with a signature, not an API key, and hooks.server.ts skips API-key auth for it.
//
// Two rules govern everything here:
//   1. Verify against the RAW request bytes — re-serializing the JSON breaks the HMAC.
//   2. Acknowledge fast (200) and push processing to jobs, because Meta retries
//      anything slow and duplicates must be idempotent, not merely rare.
import type { RequestHandler } from './$types';
import { text } from '@sveltejs/kit';
import { enqueue } from '$lib/server/jobs/queue';
import { log } from '$lib/server/logger';
import { relayTargetsFor } from '$lib/server/whatsapp/relay';
import { parseWebhook, verifyChallenge, verifySignature } from '$lib/server/whatsapp/webhook';
import { sha256 } from '$lib/server/encryption';

export const GET: RequestHandler = async ({ url }) => {
	const challenge = verifyChallenge({
		mode: url.searchParams.get('hub.mode'),
		token: url.searchParams.get('hub.verify_token'),
		challenge: url.searchParams.get('hub.challenge')
	});
	if (challenge === null) {
		log.warn('meta_webhook_verify_rejected');
		return text('Forbidden', { status: 403 });
	}
	log.info('meta_webhook_verified');
	return text(challenge, { status: 200 });
};

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const signature = verifySignature(raw, request.headers.get('x-hub-signature-256'));
	if (!signature.ok) {
		// no_app_secret is a deployment problem, not an attack — but it is still a reason
		// to refuse, since an unverified payload cannot be trusted to route by tenant.
		log.warn('meta_webhook_signature_rejected', { reason: signature.reason });
		return text('Forbidden', { status: 403 });
	}

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return text('Bad Request', { status: 400 });
	}

	const events = parseWebhook(body);
	for (const event of events) {
		const dedupe =
			event.kind === 'message'
				? `meta:msg:${event.messageId}`
				: event.kind === 'status'
					? `meta:status:${event.messageId}:${event.status}`
					: undefined;
		await enqueue('whatsapp.webhook', event as unknown as Record<string, unknown>, { dedupeKey: dedupe });
	}

	// Transition relay (§34): tenants migrated from a legacy integration can have the
	// ORIGINAL bytes + signature re-delivered to their old endpoint, so pre-migration
	// behaviour (e.g. makutano-digital's auto-replies) survives the cutover. Delivery
	// runs on the queue — a slow legacy host cannot delay this ack.
	const relayTargets = await relayTargetsFor(events);
	if (relayTargets.length) {
		const signature = request.headers.get('x-hub-signature-256') ?? '';
		const bodyHash = sha256(raw).slice(0, 24);
		for (const url of relayTargets) {
			await enqueue(
				'whatsapp.relay',
				{ url, rawBody: raw, signature },
				{ dedupeKey: `relay:${sha256(url).slice(0, 12)}:${bodyHash}` }
			);
		}
	}

	log.debug('meta_webhook_received', { events: events.length, relayTargets: relayTargets.length });
	return text('EVENT_RECEIVED', { status: 200 });
};
