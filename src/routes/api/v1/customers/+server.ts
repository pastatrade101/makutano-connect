import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createCustomer, listCustomers } from '$lib/server/customers';
import {
	handle,
	idempotencyKeyOf,
	listResponse,
	ok,
	paginationFrom,
	parseBody,
	requireApiScope
} from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';

const customerSchema = z.object({
	firstName: z.string().max(120).optional(),
	lastName: z.string().max(120).optional(),
	email: z.string().email().optional().nullable(),
	phone: z.string().max(40).optional().nullable(),
	whatsappPhone: z.string().max(40).optional().nullable(),
	country: z.string().length(2).optional().nullable(),
	language: z.string().max(10).optional().nullable(),
	notes: z.string().max(5000).optional().nullable(),
	externalReference: z.string().max(200).optional().nullable()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:read');
		const pagination = paginationFrom(event.url);
		const { items, total } = await listCustomers(ctx.tenantId, pagination);
		return listResponse(items, total, pagination);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:write');
		const body = await parseBody(event, customerSchema);
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/customers',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const customer = await createCustomer(ctx.tenantId, { ...body, source: 'API' });
				return { status: 201, body: customer as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, { status: outcome.status });
	});
