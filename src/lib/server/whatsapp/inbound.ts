// Inbound WhatsApp processing (§9, §17).
//
// Routing is by phone_number_id → whatsapp_connections → tenant_id. An event whose
// number we do not own is dropped, never guessed at. Processing is idempotent on
// Meta's message id, because Meta retries deliveries and a duplicate must not create a
// second message, customer or notification.
import { db, schema } from '../db';
import { recordUsage } from '../billing';
import { findOrCreateConversation, touchConversation } from '../conversations';
import { findOrCreateCustomer } from '../customers';
import { emit } from '../events';
import { log } from '../logger';
import { applyInboundCompliance } from './compliance';
import { markWebhookSeen, resolveTenantForEvent } from './connections';
import { markMessageStatus } from './messages';
import type { WebhookEvent } from './webhook';
/**
 * Record the event for idempotency. Returns false when it has been seen before, which
 * is the signal to skip processing entirely (§9).
 */
async function claimEvent(
	externalId: string,
	kind: string,
	tenantId: string | null,
	payload: Record<string, unknown>
): Promise<boolean> {
	const rows = await db()
		.insert(schema.webhookEvents)
		.values({ provider: 'meta', externalId, kind, tenantId, payload })
		.onConflictDoNothing()
		.returning({ id: schema.webhookEvents.id });
	return rows.length > 0;
}
export async function processInboundEvent(event: WebhookEvent): Promise<void> {
	if (event.kind === 'error') {
		log.error('whatsapp_webhook_error_event', { phoneNumberId: event.phoneNumberId, error: event.error });
		return;
	}
	const routed = await resolveTenantForEvent({ phoneNumberId: event.phoneNumberId, wabaId: event.wabaId });
	if (!routed) {
		// An identifier we do not own. Logged and dropped — never routed to a guessed
		// tenant, never written as an orphan record.
		log.warn('whatsapp_event_unroutable', {
			phoneNumberId: event.phoneNumberId,
			wabaId: event.wabaId,
			kind: event.kind
		});
		return;
	}
	const { tenantId, connection } = routed;
	await markWebhookSeen(connection.id);
	if (event.kind === 'status') {
		const fresh = await claimEvent(`${event.messageId}:${event.status}`, 'status', tenantId, event as never);
		if (!fresh) return;
		const status = mapStatus(event.status);
		if (status) {
			const firstError = (event.errors?.[0] ?? null) as { code?: number; title?: string } | null;
			await markMessageStatus({
				waMessageId: event.messageId,
				status,
				errorCode: firstError?.code ? String(firstError.code) : null,
				errorMessage: firstError?.title ?? null
			});
		}
		return;
	}
	// --- inbound message ---
	const fresh = await claimEvent(event.messageId, 'message', tenantId, event as never);
	if (!fresh) {
		log.debug('whatsapp_duplicate_message_ignored', { messageId: event.messageId });
		return;
	}
	const [firstName, ...rest] = (event.contactName ?? '').trim().split(/\s+/);
	const customer = await findOrCreateCustomer(tenantId, {
		whatsappPhone: event.from,
		firstName: firstName || '',
		lastName: rest.join(' '),
		source: 'WHATSAPP'
	});
	const conversation = await findOrCreateConversation({
		tenantId,
		channel: 'WHATSAPP',
		externalId: event.from,
		customerId: customer.id,
		whatsappConnectionId: connection.id
	});
	const [message] = await db()
		.insert(schema.messages)
		.values({
			tenantId,
			conversationId: conversation.id,
			direction: 'INBOUND',
			channel: 'WHATSAPP',
			status: 'DELIVERED',
			type: event.type,
			body: event.text,
			payload: event.raw,
			waMessageId: event.messageId,
			fromAddress: event.from,
			toAddress: connection.phoneNumberId,
			deliveredAt: new Date()
		})
		.onConflictDoNothing()
		.returning();
	if (!message) return; // lost the race with a concurrent delivery of the same event
	// Inbound re-opens the 24-hour window and honours STOP/START opt-out keywords.
	await applyInboundCompliance({ tenantId, customerId: customer.id, text: event.text, receivedAt: new Date() });
	await touchConversation(conversation.id, { incrementUnread: true });
	void recordUsage(tenantId, 'whatsapp_inbound');
	await emit(tenantId, 'message.received', {
		messageId: message.id,
		conversationId: conversation.id,
		customerId: customer.id,
		from: event.from,
		type: event.type,
		text: event.text
	});
	log.info('whatsapp_message_received', { tenantId, conversationId: conversation.id, type: event.type });
}
function mapStatus(status: string): schema.Message['status'] | null {
	switch (status) {
		case 'sent':
			return 'SENT';
		case 'delivered':
			return 'DELIVERED';
		case 'read':
			return 'READ';
		case 'failed':
			return 'FAILED';
		default:
			return null;
	}
}
