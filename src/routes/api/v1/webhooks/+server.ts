// §20 — client webhook endpoint management. The signing secret is returned once.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { requireFeature } from '$lib/server/billing';
import { EVENTS } from '$lib/server/events';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';
import { createEndpoint, listEndpoints } from '$lib/server/webhooks/endpoints';

const createSchema = z.object({
	url: z.string().url().max(500),
	description: z.string().max(300).optional().nullable(),
	events: z.array(z.string().max(80)).max(30).optional()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:read');
		return ok({ endpoints: await listEndpoints(ctx.tenantId), availableEvents: EVENTS });
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:send');
		await requireFeature(ctx.tenantId, 'client_webhooks');
		const body = await parseBody(event, createSchema);
		const { endpoint, secret } = await createEndpoint({ tenantId: ctx.tenantId, ...body });
		await audit(
			ctx.tenantId,
			'webhook_endpoint.created',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'webhook_endpoint', id: endpoint.id }
		);
		// Shown exactly once, like an API key.
		return ok({ ...endpoint, secret }, undefined, { status: 201 });
	});
