import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { sendQuotation } from '$lib/server/quotations';
import { handle, ok, parseUuid, requireApiScope } from '$lib/server/http';

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		const id = parseUuid(event.params.id!, 'quotation id');
		const quotation = await sendQuotation(ctx.tenantId, id);
		await audit(
			ctx.tenantId,
			'quotation.sent',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'quotation', id }
		);
		return ok(quotation);
	});
