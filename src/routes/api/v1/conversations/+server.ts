import type { RequestHandler } from './$types';
import { z } from 'zod';
import { listConversations } from '$lib/server/conversations';
import { handle, listResponse, paginationFrom, parseQuery, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'conversations:read');
		const pagination = paginationFrom(event.url);
		const { open } = parseQuery(event.url, z.object({ open: z.coerce.boolean().optional() }).partial());
		const { items, total } = await listConversations(ctx.tenantId, pagination, { open });
		return listResponse(
			items.map(({ conversation, customer }) => ({ ...conversation, customer })),
			total,
			pagination
		);
	});
