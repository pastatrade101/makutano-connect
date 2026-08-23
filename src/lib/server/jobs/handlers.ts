// Job handler registry. Each entry is a pure async function of the job payload; the
// worker owns retries, so a handler's only job is to throw on failure.
import type { Job } from '../db/schema';
import { sendEmail } from '../email';
import { log } from '../logger';
import { purgeExpiredTokens } from '../auth/verification';
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
		const result = await sendEmail({
			to: String(payload.to ?? ''),
			subject: String(payload.subject ?? ''),
			html: String(payload.html ?? payload.text ?? ''),
			text: String(payload.text ?? '')
		});
		// A job that silently "succeeded" without delivering would hide a broken
		// deployment; failing lets the queue retry and surfaces it in the job list.
		if (!result.delivered) throw new Error(`email not delivered: ${result.reason ?? 'unknown'}`);
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
		const tokens = await purgeExpiredTokens();
		log.info('maintenance_cleanup', { idempotencyKeys: keys, rateLimitBuckets: buckets, verificationTokens: tokens });
	}
};
