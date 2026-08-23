import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getOrderDetail, updateDraftOrder } from '$lib/server/orders';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'orders:read');
		return ok(await getOrderDetail(ctx.tenantId, parseUuid(event.params.id!, 'order id')));
	});

/** Draft editing only — confirmed orders change through status transitions. */
export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'orders:write');
		const id = parseUuid(event.params.id!, 'order id');
		const money = z.string().regex(/^\d+(\.\d{1,2})?$/);
		const body = await parseBody(
			event,
			z.object({
				customerId: z.string().uuid().optional().nullable(),
				discount: money.optional(),
				deliveryFee: money.optional(),
				deliveryMethod: z.enum(['DELIVERY', 'PICKUP']).optional().nullable(),
				deliveryLocation: z.string().max(500).optional().nullable(),
				notes: z.string().max(5000).optional().nullable(),
				externalReference: z.string().max(200).optional().nullable(),
				metadata: z.record(z.unknown()).optional(),
				items: z
					.array(
						z.object({
							catalogItemId: z.string().uuid().optional().nullable(),
							title: z.string().min(1).max(300),
							variant: z.string().max(200).optional().nullable(),
							sku: z.string().max(100).optional().nullable(),
							quantity: z.number().int().min(1).max(9999).optional(),
							unitPrice: money.optional().nullable(),
							discount: money.optional().nullable(),
							externalReference: z.string().max(200).optional().nullable(),
							externalSource: z.string().max(100).optional().nullable()
						})
					)
					.min(1)
					.max(100)
					.optional()
			})
		);
		return ok(await updateDraftOrder(ctx.tenantId, id, body, { apiKeyId: ctx.apiKeyId }));
	});
