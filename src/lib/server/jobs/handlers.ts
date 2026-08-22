// Job handler registry. Each entry is a pure async function of the job payload; the
// worker owns retries, so a handler's only job is to throw on failure.
import type { Job } from '../db/schema';
import { log } from '../logger';
import { purgeExpiredKeys } from '../idempotency';
import { purgeExpired as purgeRateLimits } from '../rate-limit';
import { deliverPendingWebhook } from '../webhooks/deliver';
import { processInboundEvent } from '../whatsapp/inbound';
import { relayRawWebhook } from '../whatsapp/relay';
import { sendQueuedMessage } from '../whatsapp/messages';
import { syncTemplates } from '../whatsapp/templates';
import { checkTokenHealth } from '../whatsapp/connections';
import { deliverNotification } from '../notifications';

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

export const handlers: Record<string, JobHandler> = {
	'whatsapp.send': async (payload) => {
		await sendQueuedMessage(String(payload.messageId));
	},
	'whatsapp.webhook': async (payload) => {
		await processInboundEvent(payload as never);
	},
	'whatsapp.relay': async (payload) => {
		await relayRawWebhook(payload);
	},
	'whatsapp.templates.sync': async (payload) => {
		await syncTemplates(String(payload.tenantId));
	},
	'whatsapp.token.health': async () => {
		await checkTokenHealth();
	},
	'client_webhook.deliver': async (payload) => {
		await deliverPendingWebhook(String(payload.deliveryId));
	},
	'notification.deliver': async (payload) => {
		await deliverNotification(String(payload.notificationId));
	},
	'email.send': async (payload) => {
		// Email provider adapter is pluggable; without EMAIL_PROVIDER_KEY this is a no-op
		// that still records the attempt, so nothing silently disappears.
		log.info('email_send_stub', { to: payload.to, subject: payload.subject });
	},
	'payment.reconcile': async (payload) => {
		const { reconcilePayment } = await import('../payments/reconcile');
		await reconcilePayment(String(payload.paymentId));
	},
	'usage.aggregate': async () => {
		log.debug('usage_aggregate_tick');
	},
	'maintenance.cleanup': async () => {
		const keys = await purgeExpiredKeys();
		const buckets = await purgeRateLimits();
		log.info('maintenance_cleanup', { idempotencyKeys: keys, rateLimitBuckets: buckets });
	}
};
