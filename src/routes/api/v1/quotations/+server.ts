import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createQuotation, listQuotations } from '$lib/server/quotations';
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
import { requireFeature } from '$lib/server/billing';

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
	customerId: z.string().uuid().optional().nullable(),
	leadId: z.string().uuid().optional().nullable(),
	bookingRequestId: z.string().uuid().optional().nullable(),
	conversationId: z.string().uuid().optional().nullable(),
	currency: z.string().length(3).optional(),
	discount: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional(),
	tax: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional(),
	validUntil: z.string().datetime().optional().nullable(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	adults: z.number().int().min(0).max(200).optional(),
	children: z.number().int().min(0).max(200).optional(),
	notes: z.string().max(5000).optional().nullable(),
	terms: z.string().max(10000).optional().nullable(),
	items: z.array(itemSchema).min(1).max(100)
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z
				.object({
					status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED']).optional()
				})
				.partial()
		);
		const { items, total } = await listQuotations(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ quotation, customer }) => ({ ...quotation, customer })),
			total,
			pagination
		);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		await requireFeature(ctx.tenantId, 'quotations');
		const body = await parseBody(event, createSchema);
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/quotations',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const quotation = await createQuotation(ctx.tenantId, body);
				return { status: 201, body: quotation as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status });
	});
