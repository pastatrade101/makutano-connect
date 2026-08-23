import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createCatalogItem, listCatalogItems } from '$lib/server/catalog';
import { handle, listResponse, ok, paginationFrom, parseBody, parseQuery, requireApiScope } from '$lib/server/http';

const TYPES = ['PRODUCT', 'SERVICE', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE', 'OTHER'] as const;

const createSchema = z.object({
	type: z.enum(TYPES).optional(),
	name: z.string().min(1).max(300),
	description: z.string().max(5000).optional().nullable(),
	sku: z.string().max(100).optional().nullable(),
	externalReference: z.string().max(200).optional().nullable(),
	externalSource: z.string().max(100).optional().nullable(),
	price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
	currency: z.string().length(3).optional().nullable(),
	imageUrl: z.string().url().max(500).optional().nullable(),
	variants: z.array(z.record(z.unknown())).max(100).optional(),
	isActive: z.boolean().optional(),
	metadata: z.record(z.unknown()).optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'catalog:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(event.url, z.object({ type: z.enum(TYPES).optional(), activeOnly: z.coerce.boolean().optional() }).partial());
		const { items, total } = await listCatalogItems(ctx.tenantId, pagination, filters);
		return listResponse(items, total, pagination);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'catalog:write');
		const body = await parseBody(event, createSchema);
		return ok(await createCatalogItem(ctx.tenantId, body), undefined, { status: 201 });
	});
