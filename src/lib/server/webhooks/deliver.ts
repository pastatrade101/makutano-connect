// Outbound client webhook delivery (§20): tenant-specific HMAC signature, retries with
// backoff, and a delivery log that records status, response body and next retry time.
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../encryption';
import { enqueue } from '../jobs/queue';
import { log } from '../logger';

const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;

/** Stripe-style signature: `t=<unix>,v1=<hex hmac of "t.body">`. */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
	const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
	return `t=${timestamp},v1=${mac}`;
}

export async function deliverPendingWebhook(deliveryId: string): Promise<void> {
	const rows = await db()
		.select({ delivery: schema.webhookDeliveries, endpoint: schema.webhookEndpoints })
		.from(schema.webhookDeliveries)
		.innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
		.where(eq(schema.webhookDeliveries.id, deliveryId))
		.limit(1);

	const row = rows[0];
	if (!row) return;
	const { delivery, endpoint } = row;
	if (delivery.status === 'SUCCEEDED' || delivery.status === 'DEAD') return;
	if (!endpoint.isActive) {
		await db()
			.update(schema.webhookDeliveries)
			.set({ status: 'DEAD', errorMessage: 'Endpoint is disabled.' })
			.where(eq(schema.webhookDeliveries.id, deliveryId));
		return;
	}

	const body = JSON.stringify(delivery.payload);
	const attempt = delivery.attempts + 1;
	let secret: string;
	try {
		secret = decrypt(endpoint.encryptedSecret);
	} catch (err) {
		log.error('webhook_secret_decrypt_failed', { endpointId: endpoint.id, error: (err as Error)?.message });
		await db()
			.update(schema.webhookDeliveries)
			.set({ status: 'DEAD', errorMessage: 'Signing secret could not be read.' })
			.where(eq(schema.webhookDeliveries.id, deliveryId));
		return;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(endpoint.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'MakutanoConnect/1.0',
				'x-makutano-event': delivery.event,
				'x-makutano-delivery': delivery.id,
				'x-makutano-signature': signPayload(secret, body)
			},
			body,
			signal: controller.signal
		});
		clearTimeout(timer);
		const text = (await res.text().catch(() => '')).slice(0, 2000);

		if (res.ok) {
			await db()
				.update(schema.webhookDeliveries)
				.set({
					status: 'SUCCEEDED',
					attempts: attempt,
					responseStatus: res.status,
					responseBody: text,
					deliveredAt: new Date(),
					errorMessage: null
				})
				.where(eq(schema.webhookDeliveries.id, deliveryId));
			await db()
				.update(schema.webhookEndpoints)
				.set({ lastSuccessAt: new Date(), consecutiveFailures: 0 })
				.where(eq(schema.webhookEndpoints.id, endpoint.id));
			return;
		}
		await recordFailure(delivery, endpoint, attempt, `HTTP ${res.status}`, res.status, text);
	} catch (err) {
		clearTimeout(timer);
		const message =
			(err as Error)?.name === 'AbortError' ? 'Request timed out' : ((err as Error)?.message ?? 'Network error');
		await recordFailure(delivery, endpoint, attempt, message, null, null);
	}
}

async function recordFailure(
	delivery: typeof schema.webhookDeliveries.$inferSelect,
	endpoint: schema.WebhookEndpoint,
	attempt: number,
	message: string,
	responseStatus: number | null,
	responseBody: string | null
): Promise<void> {
	const exhausted = attempt >= MAX_ATTEMPTS;
	const nextRetryAt = exhausted ? null : new Date(Date.now() + Math.min(6 * 60 * 60_000, 2 ** attempt * 30_000));

	await db()
		.update(schema.webhookDeliveries)
		.set({
			status: exhausted ? 'DEAD' : 'PENDING',
			attempts: attempt,
			errorMessage: message.slice(0, 500),
			responseStatus,
			responseBody,
			nextRetryAt
		})
		.where(eq(schema.webhookDeliveries.id, delivery.id));

	await db()
		.update(schema.webhookEndpoints)
		.set({ lastFailureAt: new Date(), consecutiveFailures: sql`${schema.webhookEndpoints.consecutiveFailures} + 1` })
		.where(eq(schema.webhookEndpoints.id, endpoint.id));

	if (nextRetryAt) {
		await enqueue(
			'client_webhook.deliver',
			{ deliveryId: delivery.id },
			{ tenantId: delivery.tenantId, runAt: nextRetryAt }
		);
	} else {
		log.error('webhook_delivery_dead', { deliveryId: delivery.id, endpointId: endpoint.id, event: delivery.event });
	}
}
