import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { getBookingRequestDetail, updateBookingRequest } from '$lib/server/booking-requests';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const patchSchema = z.object({
	status: z
		.enum(['NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'CONVERTED'])
		.optional(),
	assigneeUserId: z.string().uuid().nullable().optional(),
	notes: z.string().max(5000).nullable().optional(),
	estimatedTotal: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.nullable()
		.optional(),
	startDate: z.string().datetime().nullable().optional(),
	endDate: z.string().datetime().nullable().optional(),
	adults: z.number().int().min(0).max(200).optional(),
	children: z.number().int().min(0).max(200).optional(),
	metadata: z.record(z.unknown()).optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:read');
		const id = parseUuid(event.params.id!, 'booking request id');
		const detail = await getBookingRequestDetail(ctx.tenantId, id);
		return ok(detail);
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:write');
		const id = parseUuid(event.params.id!, 'booking request id');
		const body = await parseBody(event, patchSchema);
		const updated = await updateBookingRequest(ctx.tenantId, id, body);
		await audit(
			ctx.tenantId,
			'booking_request.updated',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'booking_request', id },
			{ status: body.status }
		);
		return ok(updated);
	});
