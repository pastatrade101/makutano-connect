import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getLead, updateLead } from '$lib/server/leads';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const patchSchema = z.object({
	stage: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST']).optional(),
	title: z.string().max(300).nullable().optional(),
	notes: z.string().max(5000).nullable().optional(),
	value: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.nullable()
		.optional(),
	currency: z.string().length(3).nullable().optional(),
	customerId: z.string().uuid().nullable().optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'leads:read');
		return ok(await getLead(ctx.tenantId, parseUuid(event.params.id!, 'lead id')));
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'leads:write');
		const id = parseUuid(event.params.id!, 'lead id');
		return ok(await updateLead(ctx.tenantId, id, await parseBody(event, patchSchema)));
	});
