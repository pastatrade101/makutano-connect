// Identity probe for an integrating client: which tenant does this key belong to, what
// can it do, and what does the plan allow.
import type { RequestHandler } from './$types';
import { effectivePlan } from '$lib/server/billing';
import { handle, ok, requireApiScope } from '$lib/server/http';
import { getConnectionForTenant } from '$lib/server/whatsapp/connections';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:read');
		const [plan, connection] = await Promise.all([effectivePlan(ctx.tenantId), getConnectionForTenant(ctx.tenantId)]);
		return ok({
			tenant: { id: ctx.tenantId, name: ctx.tenantName },
			apiKey: { id: ctx.apiKeyId, scopes: ctx.scopes, environment: event.locals.apiKey?.environment },
			plan: { code: plan.code, features: plan.features, limits: plan.limits },
			whatsapp: {
				connected: connection?.status === 'CONNECTED',
				displayPhoneNumber: connection?.displayPhoneNumber ?? null
			}
		});
	});
