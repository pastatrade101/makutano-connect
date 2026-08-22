// §13 Booking Request API — the primary integration point for a client website.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createBookingRequest, listBookingRequests } from '$lib/server/booking-requests';
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
import { audit } from '$lib/server/audit';

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
	// The client website keeps its own catalog; we only reference it (§13).
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	metadata: z.record(z.unknown()).optional()
});

const travelerSchema = z.object({
	firstName: z.string().max(120).optional(),
	lastName: z.string().max(120).optional(),
	nationality: z.string().max(80).optional().nullable(),
	dateOfBirth: z.string().datetime().optional().nullable(),
	passportNumber: z.string().max(60).optional().nullable(),
	passportExpiry: z.string().datetime().optional().nullable(),
	dietaryRequirements: z.string().max(500).optional().nullable(),
	specialRequests: z.string().max(1000).optional().nullable(),
	isLead: z.boolean().optional()
});

const createSchema = z.object({
	customer: z.object({
		firstName: z.string().max(120).optional(),
		lastName: z.string().max(120).optional(),
		email: z.string().email().optional().nullable(),
		phone: z.string().max(40).optional().nullable(),
		whatsappPhone: z.string().max(40).optional().nullable(),
		country: z.string().length(2).optional().nullable(),
		language: z.string().max(10).optional().nullable()
	}),
	source: z.enum(['WEBSITE', 'WHATSAPP', 'ADMIN', 'API', 'PHONE', 'EMAIL']).optional(),
	currency: z.string().length(3).optional(),
	startDate: z.string().datetime().optional().nullable(),
	endDate: z.string().datetime().optional().nullable(),
	adults: z.number().int().min(0).max(200).optional(),
	children: z.number().int().min(0).max(200).optional(),
	estimatedTotal: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional()
		.nullable(),
	notes: z.string().max(5000).optional().nullable(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	metadata: z.record(z.unknown()).optional(),
	items: z.array(itemSchema).max(50).optional(),
	travelers: z.array(travelerSchema).max(50).optional(),
	createLead: z.boolean().optional(),
	sendAcknowledgement: z.boolean().optional()
});

const listQuerySchema = z.object({
	status: z
		.enum(['NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'CONVERTED'])
		.optional(),
	source: z.enum(['WEBSITE', 'WHATSAPP', 'ADMIN', 'API', 'PHONE', 'EMAIL']).optional(),
	customerId: z.string().uuid().optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(event.url, listQuerySchema.partial());
		const { items, total } = await listBookingRequests(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ request, customer }) => ({ ...request, customer: customer ? publicCustomer(customer) : null })),
			total,
			pagination
		);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:write');
		const body = await parseBody(event, createSchema);

		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/booking-requests',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const { request, customer, leadId, conversationId } = await createBookingRequest(ctx.tenantId, body);
				await audit(
					ctx.tenantId,
					'booking_request.created',
					{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
					{ type: 'booking_request', id: request.id }
				);
				return {
					status: 201,
					body: {
						...request,
						customer: publicCustomer(customer),
						leadId,
						conversationId
					} as Record<string, unknown>
				};
			}
		);

		return ok(outcome.body, undefined, {
			status: outcome.status,
			headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : undefined
		});
	});

function publicCustomer(c: {
	id: string;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string | null;
	whatsappPhone: string | null;
}) {
	return {
		id: c.id,
		firstName: c.firstName,
		lastName: c.lastName,
		email: c.email,
		phone: c.phone,
		whatsappPhone: c.whatsappPhone
	};
}
