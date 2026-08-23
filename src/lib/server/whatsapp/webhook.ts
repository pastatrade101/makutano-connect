// Meta webhook verification and payload normalization (§9).
//
// Verification is the only authentication these endpoints have: the GET handshake
// checks WHATSAPP_VERIFY_TOKEN, and every POST is HMAC-verified against META_APP_SECRET
// over the RAW bytes Meta sent — re-serializing the JSON would change them and break
// the signature.
import crypto from 'node:crypto';
import { metaAppConfig } from './config';

export function verifyChallenge(params: {
	mode: string | null;
	token: string | null;
	challenge: string | null;
}): string | null {
	const { verifyToken } = metaAppConfig();
	if (!verifyToken) return null;
	if (
		params.mode === 'subscribe' &&
		params.token &&
		crypto.timingSafeEqual(Buffer.from(pad(params.token)), Buffer.from(pad(verifyToken)))
	) {
		return params.challenge ?? '';
	}
	return null;
}

// timingSafeEqual requires equal lengths; pad both sides to a fixed width so a length
// difference does not itself leak through an exception.
function pad(value: string): string {
	return value.padEnd(64, '\0').slice(0, 64);
}

export function verifySignature(rawBody: string, signatureHeader: string | null): { ok: boolean; reason: string } {
	const { appSecret } = metaAppConfig();
	if (!appSecret) return { ok: false, reason: 'no_app_secret' };
	if (!signatureHeader?.startsWith('sha256=')) return { ok: false, reason: 'missing_signature' };
	const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
	const a = Buffer.from(signatureHeader);
	const b = Buffer.from(expected);
	const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
	return { ok, reason: ok ? 'ok' : 'mismatch' };
}

export type InboundMessageEvent = {
	kind: 'message';
	phoneNumberId: string | null;
	wabaId: string | null;
	from: string;
	messageId: string;
	timestamp: string;
	type: string;
	text: string | null;
	buttonPayload?: string | null;
	contactName: string | null;
	raw: Record<string, unknown>;
};

export type InboundStatusEvent = {
	kind: 'status';
	phoneNumberId: string | null;
	wabaId: string | null;
	status: string;
	messageId: string;
	recipient: string;
	timestamp: string;
	errors: unknown[] | null;
};

export type InboundErrorEvent = {
	kind: 'error';
	phoneNumberId: string | null;
	wabaId: string | null;
	error: Record<string, unknown>;
};

export type WebhookEvent = InboundMessageEvent | InboundStatusEvent | InboundErrorEvent;

/** Flatten Meta's nested envelope into a list of normalized events. */
export function parseWebhook(body: any): WebhookEvent[] {
	const events: WebhookEvent[] = [];
	for (const entry of body?.entry ?? []) {
		// entry.id is the WABA id on WhatsApp Business Account subscriptions — the only
		// tenant identifier present on account-scoped events that carry no phone number.
		const wabaId: string | null = entry?.id ?? null;
		for (const change of entry?.changes ?? []) {
			const v = change?.value ?? {};
			const phoneNumberId: string | null = v?.metadata?.phone_number_id ?? null;
			const contact = v?.contacts?.[0] ?? null;

			for (const m of v.messages ?? []) {
				events.push({
					kind: 'message',
					phoneNumberId,
					wabaId,
					from: m.from,
					messageId: m.id,
					timestamp: m.timestamp,
					type: m.type,
					text:
						m.text?.body ??
						m.button?.text ??
						m.interactive?.list_reply?.title ??
						m.interactive?.button_reply?.title ??
						null,
					buttonPayload: m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null,
					contactName: contact?.profile?.name ?? null,
					raw: m
				});
			}
			for (const s of v.statuses ?? []) {
				events.push({
					kind: 'status',
					phoneNumberId,
					wabaId,
					status: s.status,
					messageId: s.id,
					recipient: s.recipient_id,
					timestamp: s.timestamp,
					errors: s.errors ?? null
				});
			}
			for (const e of v.errors ?? []) {
				events.push({ kind: 'error', phoneNumberId, wabaId, error: e });
			}
		}
	}
	return events;
}
