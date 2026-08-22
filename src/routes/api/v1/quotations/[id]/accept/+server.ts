// §16 — accepting converts to a booking without retyping customer, trip or line-item
// data. Idempotency-Key is honoured so a double-click cannot create two bookings.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { acceptQuotation } from '$lib/server/quotations';
import { handle, idempotencyKeyOf, ok, parseUuid, requireApiScope } from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		const id = parseUuid(event.params.id!, 'quotation id');
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/quotations/:id/accept',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body: { id }
			},
			async () => {
				const result = await acceptQuotation(ctx.tenantId, id, { apiKeyId: ctx.apiKeyId });
				await audit(
					ctx.tenantId,
					'quotation.converted',
					{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
					{ type: 'quotation', id },
					{ bookingId: result.booking.id }
				);
				return { status: 200, body: result as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status });
	});
