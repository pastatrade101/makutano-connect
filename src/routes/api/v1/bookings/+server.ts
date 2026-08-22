import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { createBooking, listBookings } from '$lib/server/bookings';
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

const itemSchema = z.object({
	type: z.enum(['TOUR', 'HOTEL', 'ROOM', 'TRANSFER', 'ACTIVITY', 'PARK_FEE', 'EXTRA', 'CUSTOM']).optional(),
	title: z.string().min(1).max(300),
	description: z.string().max(2000).optional().nullable(),
	quantity: z.number().int().min(1).max(999).optional(),
	unitPrice: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional()
		.nullable(),
	total: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional()
		.nullable(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable()
});

const createSchema = z.object({
	customerId: z.string().uuid(),
	bookingRequestId: z.string().uuid().optional().nullable(),
	quotationId: z.string().uuid().optional().nullable(),
	currency: z.string().length(3).optional(),
	discount: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional(),
	tax: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	adults: z.number().int().min(0).max(200).optional(),
	children: z.number().int().min(0).max(200).optional(),
	status: z.enum(['DRAFT', 'PENDING', 'AWAITING_PAYMENT']).optional(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	metadata: z.record(z.unknown()).optional(),
	items: z.array(itemSchema).min(1).max(100)
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'bookings:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z
				.object({
					status: z
						.enum([
							'DRAFT',
							'PENDING',
							'AWAITING_PAYMENT',
							'PARTIALLY_PAID',
							'CONFIRMED',
							'IN_PROGRESS',
							'COMPLETED',
							'CANCELLED',
							'REFUNDED'
						])
						.optional(),
					customerId: z.string().uuid().optional(),
					unpaid: z.coerce.boolean().optional()
				})
				.partial()
		);
		const { items, total } = await listBookings(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ booking, customer }) => ({ ...booking, customer })),
			total,
			pagination
		);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'bookings:write');
		const body = await parseBody(event, createSchema);
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/bookings',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const booking = await createBooking(ctx.tenantId, { ...body, source: 'API' }, { apiKeyId: ctx.apiKeyId });
				await audit(
					ctx.tenantId,
					'booking.created',
					{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
					{ type: 'booking', id: booking.id }
				);
				return { status: 201, body: booking as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, {
			status: outcome.status,
			headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : undefined
		});
	});
