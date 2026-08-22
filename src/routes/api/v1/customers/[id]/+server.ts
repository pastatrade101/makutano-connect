import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getCustomer, updateCustomer } from '$lib/server/customers';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const patchSchema = z.object({
	firstName: z.string().max(120).optional(),
	lastName: z.string().max(120).optional(),
	email: z.string().email().nullable().optional(),
	phone: z.string().max(40).nullable().optional(),
	whatsappPhone: z.string().max(40).nullable().optional(),
	country: z.string().length(2).nullable().optional(),
	language: z.string().max(10).nullable().optional(),
	notes: z.string().max(5000).nullable().optional(),
	externalReference: z.string().max(200).nullable().optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:read');
		return ok(await getCustomer(ctx.tenantId, parseUuid(event.params.id!, 'customer id')));
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:write');
		const id = parseUuid(event.params.id!, 'customer id');
		return ok(await updateCustomer(ctx.tenantId, id, await parseBody(event, patchSchema)));
	});
