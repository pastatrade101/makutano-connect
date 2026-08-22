// Legacy webhook relay (migration §34 transition aid).
//
// During the cutover window a legacy integration (makutano-digital's AI assistant)
// still expects Meta's webhook POSTs at its own endpoint. Rather than forcing a
// big-bang rewrite, Connect re-delivers the EXACT bytes Meta sent — same raw body,
// same x-hub-signature-256 header — to a per-tenant `settings.legacy_webhook_url`.
// Because both apps share META_APP_SECRET, the legacy handler's own HMAC verification
// passes unchanged: to it, the relay is indistinguishable from Meta.
//
// The relay is a TRANSITION mechanism: remove the setting once the legacy app reads
// from Connect's API, and the extra hop disappears. Only https targets are accepted
// (plus localhost, for tests) and the URL is operator-set configuration, never
// caller input — this is not an open forwarder.
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { log } from '../logger';

const TIMEOUT_MS = 10_000;

/**
 * Which legacy endpoints should receive this webhook delivery? Resolves each distinct
 * phone_number_id / waba_id to its owning tenant and collects distinct
 * settings.legacy_webhook_url values. Unroutable identifiers contribute nothing.
 */
export async function relayTargetsFor(
	identifiers: Array<{ phoneNumberId?: string | null; wabaId?: string | null }>
): Promise<string[]> {
	const phoneIds = [...new Set(identifiers.map((i) => i.phoneNumberId).filter((v): v is string => !!v))];
	const wabaIds = [...new Set(identifiers.map((i) => i.wabaId).filter((v): v is string => !!v))];
	if (phoneIds.length === 0 && wabaIds.length === 0) return [];

	const conditions = [];
	if (phoneIds.length) conditions.push(inArray(schema.whatsappConnections.phoneNumberId, phoneIds));
	if (wabaIds.length) conditions.push(inArray(schema.whatsappConnections.wabaId, wabaIds));

	const rows = await db()
		.selectDistinct({ settings: schema.tenants.settings })
		.from(schema.whatsappConnections)
		.innerJoin(schema.tenants, sql`${schema.tenants.id} = ${schema.whatsappConnections.tenantId}`)
		.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} or ${conditions[1]}`);

	const urls = new Set<string>();
	for (const row of rows) {
		const url = (row.settings as Record<string, unknown>)?.legacy_webhook_url;
		if (typeof url === 'string' && isAllowedRelayUrl(url)) urls.add(url);
	}
	return [...urls];
}

export function isAllowedRelayUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol === 'https:') return true;
		// Plain http only for loopback — integration tests and same-host sidecars.
		return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	} catch {
		return false;
	}
}

/**
 * Job handler: deliver one raw webhook body to one legacy endpoint. Throwing hands
 * control to the queue's backoff; a legacy endpoint being down never blocks Connect's
 * own processing, which already happened on a separate job.
 */
export async function relayRawWebhook(payload: Record<string, unknown>): Promise<void> {
	const url = String(payload.url ?? '');
	const rawBody = String(payload.rawBody ?? '');
	const signature = String(payload.signature ?? '');
	if (!isAllowedRelayUrl(url) || !rawBody) {
		log.warn('relay_dropped_invalid', { url: url.slice(0, 100) });
		return; // malformed job — do not retry into a wall
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-hub-signature-256': signature,
				'user-agent': 'MakutanoConnect-Relay/1.0'
			},
			body: rawBody,
			signal: controller.signal
		});
		// Drain the body so the connection can be reused; its content is irrelevant.
		await res.text().catch(() => '');
		if (!res.ok) throw new Error(`Legacy endpoint answered HTTP ${res.status}`);
		log.info('relay_delivered', { url, status: res.status, bytes: rawBody.length });
	} catch (err) {
		const timedOut = (err as Error)?.name === 'AbortError';
		log.warn('relay_failed', { url, error: timedOut ? 'timeout' : (err as Error)?.message });
		throw err; // queue retries with backoff
	} finally {
		clearTimeout(timer);
	}
}
