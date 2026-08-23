// Outbound WhatsApp messaging (§18).
//
// The caller supplies only recipient, type and content. Makutano resolves the tenant's
// connection, phone_number_id and decrypted token — a caller can never name the number
// it sends from, which is what stops tenant A sending on tenant B's credentials.
//
// Sends are persisted first (status QUEUED) and dispatched by a background job, so an
// API response never waits on Meta and a transient Meta outage retries instead of
// losing the message.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { recordUsage } from '../billing';
import { assertAllowed } from '../entitlements';
import { findOrCreateConversation, touchConversation } from '../conversations';
import { findOrCreateCustomer } from '../customers';
import { AppError } from '../errors';
import { enqueue } from '../jobs/queue';
import { log } from '../logger';
import { normalizePhone } from '../phone';
import { graphRequest, WhatsAppApiError } from './client';
import { assertSendCompliant } from './compliance';
import { markError, markSendSuccess, requireCredentials } from './connections';

export type OutboundContent =
	| { type: 'text'; text: string; previewUrl?: boolean }
	| { type: 'template'; templateName: string; language?: string; components?: unknown[] }
	| { type: 'image'; link: string; caption?: string }
	| { type: 'document'; link: string; filename?: string; caption?: string }
	| { type: 'interactive'; interactive: Record<string, unknown> };

export type SendParams = {
	tenantId: string;
	to: string;
	content: OutboundContent;
	conversationId?: string | null;
	customerId?: string | null;
	sentByUserId?: string | null;
	/** Collapses duplicate sends of the same logical notification. */
	dedupeKey?: string;
	/** false → the caller dispatches itself (sync mode); the queue is skipped. */
	enqueueJob?: boolean;
};

/** Build the exact Cloud API request body for a content union member. */
export function buildMessagePayload(to: string, content: OutboundContent): Record<string, unknown> {
	const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
	switch (content.type) {
		case 'text':
			return { ...base, type: 'text', text: { body: content.text, preview_url: content.previewUrl ?? false } };
		case 'template':
			return {
				...base,
				type: 'template',
				template: {
					name: content.templateName,
					language: { code: content.language ?? 'en' },
					...(content.components?.length ? { components: content.components } : {})
				}
			};
		case 'image':
			return {
				...base,
				type: 'image',
				image: { link: content.link, ...(content.caption ? { caption: content.caption } : {}) }
			};
		case 'document':
			return {
				...base,
				type: 'document',
				document: {
					link: content.link,
					...(content.filename ? { filename: content.filename } : {}),
					...(content.caption ? { caption: content.caption } : {})
				}
			};
		case 'interactive':
			return { ...base, type: 'interactive', interactive: content.interactive };
	}
}

function previewOf(content: OutboundContent): string {
	if (content.type === 'text') return content.text;
	if (content.type === 'template') return `[template:${content.templateName}]`;
	if (content.type === 'image') return content.caption ?? '[image]';
	if (content.type === 'document') return content.caption ?? '[document]';
	return '[interactive]';
}

/** Queue an outbound message. Returns the persisted row immediately (§18). */
export async function queueMessage(params: SendParams): Promise<schema.Message> {
	const to = normalizePhone(params.to);
	if (!to) throw new AppError('VALIDATION_ERROR', 'A valid recipient phone number is required.');

	// Entitlements decide whether the tenant MAY send at all. Compliance (below) then
	// decides whether this particular message is permitted — and can only ever be
	// stricter; no plan, override or admin action relaxes it.
	await assertAllowed(params.tenantId, { feature: 'whatsapp.enabled', limit: 'whatsapp.maxOutboundPerMonth' });

	// Fail fast when the tenant has no live connection, rather than queueing a message
	// that can never be delivered.
	await requireCredentials(params.tenantId);

	// Compliance last and strictest: opt-out, the 24-hour window, approved templates.
	// Entitlements above decided IF the tenant may send; this decides if THIS message is
	// permitted, and nothing in the plan can relax it.
	await assertSendCompliant({ tenantId: params.tenantId, to, content: params.content });

	let conversationId = params.conversationId ?? null;
	let customerId = params.customerId ?? null;
	if (!conversationId) {
		if (!customerId) {
			const customer = await findOrCreateCustomer(params.tenantId, { whatsappPhone: to, source: 'WHATSAPP' });
			customerId = customer.id;
		}
		const conversation = await findOrCreateConversation({
			tenantId: params.tenantId,
			channel: 'WHATSAPP',
			externalId: to,
			customerId
		});
		conversationId = conversation.id;
	}

	const [message] = await db()
		.insert(schema.messages)
		.values({
			tenantId: params.tenantId,
			conversationId,
			direction: 'OUTBOUND',
			channel: 'WHATSAPP',
			status: 'QUEUED',
			type: params.content.type,
			body: previewOf(params.content),
			payload: params.content as unknown as Record<string, unknown>,
			toAddress: to,
			sentByUserId: params.sentByUserId ?? null
		})
		.returning();

	if (params.enqueueJob !== false) {
		await enqueue(
			'whatsapp.send',
			{ messageId: message.id },
			{ tenantId: params.tenantId, dedupeKey: params.dedupeKey ? `wa-send:${params.dedupeKey}` : undefined }
		);
	}
	await touchConversation(conversationId);
	return message;
}

/** Job handler: perform the actual Graph call for a queued message. */
export async function sendQueuedMessage(messageId: string): Promise<void> {
	const rows = await db().select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
	const message = rows[0];
	if (!message) return;
	// SENT/DELIVERED/READ mean Meta already accepted it — a retry would double-send.
	if (message.status !== 'QUEUED' && message.status !== 'FAILED') return;

	const credentials = await requireCredentials(message.tenantId);
	const content = message.payload as unknown as OutboundContent;
	const body = buildMessagePayload(message.toAddress ?? '', content);

	try {
		const result = await graphRequest<{ messages?: Array<{ id: string }> }>({
			credentials,
			path: `${credentials.phoneNumberId}/messages`,
			method: 'POST',
			body
		});
		const waMessageId = result?.messages?.[0]?.id ?? null;
		await db()
			.update(schema.messages)
			.set({
				status: 'SENT',
				waMessageId,
				fromAddress: credentials.phoneNumberId,
				errorCode: null,
				errorMessage: null,
				updatedAt: new Date()
			})
			.where(eq(schema.messages.id, message.id));
		await markSendSuccess(credentials.connectionId);
		void recordUsage(message.tenantId, 'whatsapp_outbound');
		log.info('whatsapp_message_sent', { tenantId: message.tenantId, messageId: message.id, type: message.type });
	} catch (err) {
		const apiError = err instanceof WhatsAppApiError ? err : null;
		await db()
			.update(schema.messages)
			.set({
				status: 'FAILED',
				errorCode: String(apiError?.code ?? 'send_failed'),
				errorMessage: ((err as Error)?.message ?? 'Send failed').slice(0, 500),
				updatedAt: new Date()
			})
			.where(eq(schema.messages.id, message.id));

		// 401/403 from Meta means the stored token no longer works — surface it as
		// REAUTH_REQUIRED so the tenant is told to reconnect (§32).
		const needsReauth = apiError?.status === 401 || apiError?.status === 403;
		await markError(credentials.connectionId, String(apiError?.code ?? 'send_failed'), needsReauth);
		throw err; // let the job queue apply its backoff
	}
}

export async function markMessageStatus(params: {
	waMessageId: string;
	status: schema.Message['status'];
	errorCode?: string | null;
	errorMessage?: string | null;
}): Promise<void> {
	const now = new Date();
	await db()
		.update(schema.messages)
		.set({
			status: params.status,
			...(params.status === 'DELIVERED' ? { deliveredAt: now } : {}),
			...(params.status === 'READ' ? { readAt: now } : {}),
			...(params.errorCode ? { errorCode: params.errorCode } : {}),
			...(params.errorMessage ? { errorMessage: params.errorMessage.slice(0, 500) } : {}),
			updatedAt: now
		})
		.where(and(eq(schema.messages.waMessageId, params.waMessageId)));
}
