import type { RequestHandler } from './$types';
import { z } from 'zod';
import { declineQuotation } from '$lib/server/quotations';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		const id = parseUuid(event.params.id!, 'quotation id');
		const body = await parseBody(event, z.object({ reason: z.string().max(500).optional() }).default({}));
		return ok(await declineQuotation(ctx.tenantId, id, body.reason));
	});
