// Orders API — the commerce twin of /booking-requests. Same envelope, same
// idempotency, same tenant-from-key rule.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { createOrder, listOrders } from '$lib/server/orders';
import { handle, idempotencyKeyOf, listResponse, ok, paginationFrom, parseBody, parseQuery, requireApiScope } from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';

const money = z.string().regex(/^\d+(\.\d{1,2})?$/);

const itemSchema = z.object({
	catalogItemId: z.string().uuid().optional().nullable(),
	title: z.string().min(1).max(300),
	variant: z.string().max(200).optional().nullable(),
	sku: z.string().max(100).optional().nullable(),
	quantity: z.number().int().min(1).max(9999).optional(),
	unitPrice: money.optional().nullable(),
	discount: money.optional().nullable(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	metadata: z.record(z.unknown()).optional()
});

const SOURCES = ['WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'WHATSAPP_GROUP', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'MANUAL', 'API', 'OTHER'] as const;
const STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED'] as const;

const createSchema = z.object({
	customerId: z.string().uuid().optional().nullable(),
	conversationId: z.string().uuid().optional().nullable(),
	status: z.enum(['DRAFT', 'PENDING_CONFIRMATION']).optional(),
	source: z.enum(SOURCES).optional(),
	currency: z.string().length(3).optional(),
	discount: money.optional(),
	deliveryFee: money.optional(),
	deliveryMethod: z.enum(['DELIVERY', 'PICKUP']).optional().nullable(),
	deliveryLocation: z.string().max(500).optional().nullable(),
	notes: z.string().max(5000).optional().nullable(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	metadata: z.record(z.unknown()).optional(),
	items: z.array(itemSchema).min(1).max(100)
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'orders:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z
				.object({
					status: z.enum(STATUSES).optional(),
					paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'FAILED']).optional(),
					source: z.enum(SOURCES).optional(),
					customerId: z.string().uuid().optional(),
					conversationId: z.string().uuid().optional()
				})
				.partial()
		);
		const { items, total } = await listOrders(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ order, customer, itemsSummary }) => ({ ...order, customer, itemsSummary })),
			total,
			pagination
		);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'orders:write');
		const body = await parseBody(event, createSchema);
		const outcome = await withIdempotency(
			{ tenantId: ctx.tenantId, endpoint: 'POST /api/v1/orders', key: idempotencyKeyOf(event), method: 'POST', path: event.url.pathname, body },
			async () => {
				const order = await createOrder(ctx.tenantId, { ...body, source: body.source ?? 'API' }, { apiKeyId: ctx.apiKeyId });
				await audit(ctx.tenantId, 'order.created', { type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId }, { type: 'order', id: order.id });
				return { status: 201, body: order as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status, headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : undefined });
	});
