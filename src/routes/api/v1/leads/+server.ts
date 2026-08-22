import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createLead, listLeads } from '$lib/server/leads';
import { emit } from '$lib/server/events';
import { handle, listResponse, ok, paginationFrom, parseBody, parseQuery, requireApiScope } from '$lib/server/http';

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'] as const;

const createSchema = z.object({
	customerId: z.string().uuid().optional().nullable(),
	stage: z.enum(STAGES).optional(),
	source: z.enum(['WEBSITE', 'WHATSAPP', 'ADMIN', 'API', 'PHONE', 'EMAIL']).optional(),
	title: z.string().max(300).optional().nullable(),
	notes: z.string().max(5000).optional().nullable(),
	value: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional()
		.nullable(),
	currency: z.string().length(3).optional().nullable(),
	externalReference: z.string().max(200).optional().nullable()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'leads:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(event.url, z.object({ stage: z.enum(STAGES).optional() }).partial());
		const { items, total } = await listLeads(ctx.tenantId, pagination, filters);
		return listResponse(
			items.map(({ lead, customer }) => ({ ...lead, customer })),
			total,
			pagination
		);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'leads:write');
		const lead = await createLead(ctx.tenantId, { ...(await parseBody(event, createSchema)), source: 'API' });
		await emit(ctx.tenantId, 'lead.created', { id: lead.id, stage: lead.stage, customerId: lead.customerId });
		return ok(lead, undefined, { status: 201 });
	});
