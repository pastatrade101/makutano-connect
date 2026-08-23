import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { changeOrderStatus } from '$lib/server/orders';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'orders:write');
		const id = parseUuid(event.params.id!, 'order id');
		const body = await parseBody(
			event,
			z.object({
				status: z.enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED']),
				reason: z.string().max(500).optional()
			})
		);
		const order = await changeOrderStatus(ctx.tenantId, id, body.status, { apiKeyId: ctx.apiKeyId }, body.reason);
		await audit(ctx.tenantId, 'order.status_changed', { type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId }, { type: 'order', id }, { status: body.status });
		return ok(order);
	});
