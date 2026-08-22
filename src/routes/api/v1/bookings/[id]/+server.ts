import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { changeBookingStatus, getBookingDetail } from '$lib/server/bookings';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const patchSchema = z.object({
	status: z.enum([
		'PENDING',
		'AWAITING_PAYMENT',
		'PARTIALLY_PAID',
		'CONFIRMED',
		'IN_PROGRESS',
		'COMPLETED',
		'CANCELLED',
		'REFUNDED'
	]),
	reason: z.string().max(500).optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'bookings:read');
		const id = parseUuid(event.params.id!, 'booking id');
		const detail = await getBookingDetail(ctx.tenantId, id);
		return ok(detail);
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'bookings:write');
		const id = parseUuid(event.params.id!, 'booking id');
		const body = await parseBody(event, patchSchema);
		const booking = await changeBookingStatus(ctx.tenantId, id, body.status, { apiKeyId: ctx.apiKeyId }, body.reason);
		await audit(
			ctx.tenantId,
			body.status === 'CONFIRMED'
				? 'booking.confirmed'
				: body.status === 'CANCELLED'
					? 'booking.cancelled'
					: 'booking.created',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'booking', id }
		);
		return ok(booking);
	});
