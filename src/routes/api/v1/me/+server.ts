// Identity probe for an integrating client: which tenant does this key belong to, what
// can it do, and what does the plan allow.
import type { RequestHandler } from './$types';
import { effectiveEntitlements, usageSummary } from '$lib/server/entitlements';
import { handle, ok, requireApiScope } from '$lib/server/http';
import { getConnectionForTenant } from '$lib/server/whatsapp/connections';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:read');
		const [ent, usage, connection] = await Promise.all([
			effectiveEntitlements(ctx.tenantId),
			usageSummary(ctx.tenantId),
			getConnectionForTenant(ctx.tenantId)
		]);
		return ok({
			tenant: { id: ctx.tenantId, name: ctx.tenantName },
			apiKey: { id: ctx.apiKeyId, scopes: ctx.scopes, environment: event.locals.apiKey?.environment },
			plan: { code: ent.planCode, name: ent.planName, status: ent.subscriptionStatus },
			// Effective entitlements — what this tenant may actually do right now.
			entitlements: Object.fromEntries(Object.values(ent.resolved).map((r) => [r.key, r.effective])),
			usage: usage.map((u) => ({ key: u.key, used: u.used, limit: u.unlimited ? null : u.limit, percent: u.unlimited ? null : u.percent })),
			whatsapp: {
				connected: connection?.status === 'CONNECTED',
				displayPhoneNumber: connection?.displayPhoneNumber ?? null
			}
		});
	});
