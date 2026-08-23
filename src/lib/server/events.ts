// Domain event bus (§20). Services emit; this module fans out to client webhooks and
// in-app/WhatsApp notifications. Fan-out is queued, never inline, so a slow client
// endpoint can never slow down the request that produced the event.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { enqueue } from './jobs/queue';
import { log } from './logger';
import { recordUsage } from './billing';

export const EVENTS = [
	'booking_request.created',
	'booking_request.updated',
	'booking.created',
	'booking.confirmed',
	'booking.cancelled',
	'lead.created',
	'customer.created',
	'quotation.sent',
	'quotation.accepted',
	'payment.succeeded',
	'payment.failed',
	'message.received',
	'order.created',
	'order.confirmed',
	'order.processing',
	'order.ready',
	'order.dispatched',
	'order.delivered',
	'order.cancelled',
	'order.refunded'
] as const;

export type DomainEvent = (typeof EVENTS)[number];

export function isKnownEvent(value: string): value is DomainEvent {
	return (EVENTS as readonly string[]).includes(value);
}

/**
 * Publish an event for a tenant. Creates one webhook_delivery row per subscribed,
 * active endpoint and queues its delivery job.
 */
export async function emit(tenantId: string, event: DomainEvent, payload: Record<string, unknown>): Promise<void> {
	try {
		const endpoints = await db()
			.select()
			.from(schema.webhookEndpoints)
			.where(
				and(
					eq(schema.webhookEndpoints.tenantId, tenantId),
					eq(schema.webhookEndpoints.isActive, true),
					// An empty `events` array means "everything".
					sql`(jsonb_array_length(${schema.webhookEndpoints.events}) = 0 or ${schema.webhookEndpoints.events} ? ${event})`
				)
			);

		for (const endpoint of endpoints) {
			const [delivery] = await db()
				.insert(schema.webhookDeliveries)
				.values({
					tenantId,
					endpointId: endpoint.id,
					event,
					payload: { event, tenantId, occurredAt: new Date().toISOString(), data: payload }
				})
				.returning({ id: schema.webhookDeliveries.id });
			await enqueue('client_webhook.deliver', { deliveryId: delivery.id }, { tenantId });
			void recordUsage(tenantId, 'webhook_deliveries');
		}
		log.debug('event_emitted', { tenantId, event, endpoints: endpoints.length });
	} catch (err) {
		// An event-bus failure must never roll back the business operation that fired it.
		log.error('event_emit_failed', { tenantId, event, error: (err as Error)?.message });
	}
}
