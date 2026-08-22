import type { RequestHandler } from './$types';
import { listMessages } from '$lib/server/conversations';
import { handle, listResponse, paginationFrom, parseUuid, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'conversations:read');
		const id = parseUuid(event.params.id!, 'conversation id');
		const pagination = paginationFrom(event.url);
		const { items, total } = await listMessages(ctx.tenantId, id, pagination);
		return listResponse(items, total, pagination);
	});
