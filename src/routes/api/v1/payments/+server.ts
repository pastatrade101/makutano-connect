import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { createPayment, listPayments } from '$lib/server/payments';
import {
	handle,
	idempotencyKeyOf,
	listResponse,
	ok,
	paginationFrom,
	parseBody,
	parseQuery,
	requireApiScope
} from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';
import { assertFeature } from '$lib/server/entitlements';
import { requireScope } from '$lib/server/auth/permissions';

const createSchema = z.object({
	bookingId: z.string().uuid().optional().nullable(),
	orderId: z.string().uuid().optional().nullable(),
	customerId: z.string().uuid().optional().nullable(),
	provider: z.enum(['MANUAL', 'BANK_TRANSFER', 'STRIPE', 'FLUTTERWAVE', 'PESAPAL', 'AZAMPAY']).optional(),
	amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
	currency: z.string().length(3).optional(),
	description: z.string().max(500).optional().nullable(),
	returnUrl: z.string().url().optional().nullable(),
	metadata: z.record(z.unknown()).optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'payments:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z
				.object({
					status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
					bookingId: z.string().uuid().optional()
				})
				.partial()
		);
		const { items, total } = await listPayments(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ payment, booking }) => ({ ...payment, booking })),
			total,
			pagination
		);
	});

/**
 * Writing payments is deliberately gated on bookings:write — §6 only defines
 * payments:read as an external scope, so an integration cannot move money with a
 * read-only key.
 */
export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'payments:read');
		requireScope(ctx.scopes, 'bookings:write');
		await assertFeature(ctx.tenantId, 'payments.enabled');
		const body = await parseBody(event, createSchema);
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/payments',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const { payment, redirectUrl } = await createPayment(ctx.tenantId, body);
				await audit(
					ctx.tenantId,
					'payment.created',
					{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
					{ type: 'payment', id: payment.id }
				);
				return { status: 201, body: { ...payment, redirectUrl } as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status });
	});
