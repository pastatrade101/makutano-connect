// §18 — the caller supplies recipient, type and content only. Makutano resolves the
// tenant, connection, phone_number_id and encrypted token.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireFeature } from '$lib/server/billing';
import { handle, idempotencyKeyOf, ok, parseBody, requireApiScope } from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';
import { queueMessage, sendQueuedMessage, type OutboundContent } from '$lib/server/whatsapp/messages';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { AppError } from '$lib/server/errors';
import { checkLimit } from '$lib/server/billing';

const contentSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('text'), text: z.string().min(1).max(4096), previewUrl: z.boolean().optional() }),
	z.object({
		type: z.literal('template'),
		templateName: z.string().min(1).max(200),
		language: z.string().max(10).optional(),
		components: z.array(z.unknown()).max(20).optional()
	}),
	z.object({ type: z.literal('image'), link: z.string().url(), caption: z.string().max(1024).optional() }),
	z.object({
		type: z.literal('document'),
		link: z.string().url(),
		filename: z.string().max(200).optional(),
		caption: z.string().max(1024).optional()
	}),
	z.object({ type: z.literal('interactive'), interactive: z.record(z.unknown()) })
]);

const bodySchema = z.object({
	to: z.string().min(6).max(40),
	content: contentSchema,
	conversationId: z.string().uuid().optional().nullable(),
	customerId: z.string().uuid().optional().nullable(),
	/**
	 * 'queued' (default) acks 202 and dispatches on the background queue.
	 * 'sync' performs the Meta call inside this request and returns the REAL
	 * WhatsApp message id — for callers (like a migrated legacy backend) whose
	 * own status tracking threads on the wamid.
	 */
	dispatch: z.enum(['queued', 'sync']).default('queued')
});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:send');
		await requireFeature(ctx.tenantId, 'whatsapp');
		await checkLimit(ctx.tenantId, 'whatsapp_outbound', 'whatsapp_outbound_per_month');
		const body = await parseBody(event, bodySchema);

		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/whatsapp/messages',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const message = await queueMessage({
					tenantId: ctx.tenantId,
					to: body.to,
					content: body.content as OutboundContent,
					conversationId: body.conversationId ?? null,
					customerId: body.customerId ?? null,
					enqueueJob: body.dispatch !== 'sync'
				});

				if (body.dispatch === 'sync') {
					// The caller waits for Meta. Failures surface as an API error now,
					// not as a later status flip the caller would never see.
					await sendQueuedMessage(message.id);
					const [sent] = await db()
						.select()
						.from(schema.messages)
						.where(eq(schema.messages.id, message.id))
						.limit(1);
					if (!sent?.waMessageId || sent.status === 'FAILED') {
						throw new AppError('META_API_ERROR', sent?.errorMessage ?? 'WhatsApp did not accept the message.');
					}
					return {
						status: 201,
						body: {
							id: sent.id,
							conversationId: sent.conversationId,
							status: sent.status,
							type: sent.type,
							to: sent.toAddress,
							waMessageId: sent.waMessageId
						} as Record<string, unknown>
					};
				}

				return {
					status: 202,
					body: {
						id: message.id,
						conversationId: message.conversationId,
						status: message.status,
						type: message.type,
						to: message.toAddress
					} as Record<string, unknown>
				};
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status });
	});
