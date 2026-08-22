import type { RequestHandler } from './$types';
import { getQuotationDetail } from '$lib/server/quotations';
import { handle, ok, parseUuid, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:read');
		return ok(await getQuotationDetail(ctx.tenantId, parseUuid(event.params.id!, 'quotation id')));
	});
