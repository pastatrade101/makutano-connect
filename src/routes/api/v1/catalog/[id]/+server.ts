import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getCatalogItem, updateCatalogItem } from '$lib/server/catalog';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'catalog:read');
		return ok(await getCatalogItem(ctx.tenantId, parseUuid(event.params.id!, 'catalog item id')));
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'catalog:write');
		const id = parseUuid(event.params.id!, 'catalog item id');
		const body = await parseBody(
			event,
			z.object({
				type: z.enum(['PRODUCT', 'SERVICE', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE', 'OTHER']).optional(),
				name: z.string().min(1).max(300).optional(),
				description: z.string().max(5000).nullable().optional(),
				sku: z.string().max(100).nullable().optional(),
				externalReference: z.string().max(200).nullable().optional(),
				price: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
				currency: z.string().length(3).nullable().optional(),
				imageUrl: z.string().url().max(500).nullable().optional(),
				variants: z.array(z.record(z.unknown())).max(100).optional(),
				isActive: z.boolean().optional(),
				metadata: z.record(z.unknown()).optional()
			})
		);
		return ok(await updateCatalogItem(ctx.tenantId, id, body));
	});
