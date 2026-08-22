import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { deleteEndpoint } from '$lib/server/webhooks/endpoints';
import { handle, ok, parseUuid, requireApiScope } from '$lib/server/http';

export const DELETE: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:send');
		const id = parseUuid(event.params.id!, 'endpoint id');
		await deleteEndpoint(ctx.tenantId, id);
		await audit(
			ctx.tenantId,
			'webhook_endpoint.deleted',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'webhook_endpoint', id }
		);
		return ok({ deleted: true });
	});
