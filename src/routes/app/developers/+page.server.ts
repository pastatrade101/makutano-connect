import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { API_SCOPES, DEFAULT_API_SCOPES, requirePermission } from '$lib/server/auth/permissions';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys';
import { EVENTS } from '$lib/server/events';
import { createEndpoint, deleteEndpoint, listEndpoints } from '$lib/server/webhooks/endpoints';
import { toAppError } from '$lib/server/errors';
import { env } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantPermission(locals, 'api_keys:read');
	const tenantId = requireTenant(locals).id;
	const [keys, endpoints] = await Promise.all([listApiKeys(tenantId), listEndpoints(tenantId)]);
	return {
		keys,
		endpoints,
		scopes: API_SCOPES,
		defaultScopes: DEFAULT_API_SCOPES,
		events: EVENTS,
		apiBaseUrl: env().PUBLIC_APP_URL.replace(/\/+$/, '')
	};
};

export const actions: Actions = {
	createKey: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'api_keys:write');
		const data = await request.formData();
		try {
			const issued = await createApiKey({
				tenantId: requireTenant(locals).id,
				name: String(data.get('name') ?? 'Website key'),
				environment: String(data.get('environment') ?? 'live') as 'live' | 'test',
				scopes: data.getAll('scopes').map(String),
				createdByUserId: locals.user!.id
			});
			await audit(
				requireTenant(locals).id,
				'api_key.created',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'api_key', id: issued.id }
			);
			// The plaintext secret is returned to this page once and never again (§6).
			return { createdKey: issued };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	revokeKey: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'api_keys:write');
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			await revokeApiKey(requireTenant(locals).id, id);
			await audit(
				requireTenant(locals).id,
				'api_key.revoked',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'api_key', id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	createEndpoint: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'webhooks:write');
		const data = await request.formData();
		try {
			const { endpoint, secret } = await createEndpoint({
				tenantId: requireTenant(locals).id,
				url: String(data.get('url') ?? ''),
				description: String(data.get('description') ?? '') || null,
				events: data.getAll('events').map(String)
			});
			await audit(
				requireTenant(locals).id,
				'webhook_endpoint.created',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'webhook_endpoint', id: endpoint.id }
			);
			return { createdEndpoint: { ...endpoint, secret } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	deleteEndpoint: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'webhooks:write');
		const data = await request.formData();
		try {
			await deleteEndpoint(requireTenant(locals).id, String(data.get('id') ?? ''));
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
