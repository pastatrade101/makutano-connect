// §18 — the caller supplies recipient, type and content only. Makutano resolves the
// tenant, connection, phone_number_id and encrypted token.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireFeature } from '$lib/server/billing';
import { handle, idempotencyKeyOf, ok, parseBody, requireApiScope } from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';
import { queueMessage, type OutboundContent } from '$lib/server/whatsapp/messages';
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
	customerId: z.string().uuid().optional().nullable()
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
					customerId: body.customerId ?? null
				});
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
