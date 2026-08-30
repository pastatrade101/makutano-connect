import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { createCatalogItem, listCatalogItems, updateCatalogItem } from '$lib/server/catalog';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import {
	catalogSyncSettings,
	saveCatalogSyncSettings,
	syncTenantCatalog,
	type CatalogSource
} from '$lib/server/catalog-sync';
import { getTenantById } from '$lib/server/tenants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'catalog:read');
	const pagination = paginationFrom(url);
	const tenantId = requireTenant(locals).id;
	const [{ items, total }, tenant] = await Promise.all([
		listCatalogItems(tenantId, pagination),
		getTenantById(tenantId)
	]);
	return {
		items,
		total,
		pagination,
		// Where this tenant's own catalogue lives, if anywhere. Per tenant, never
		// per deployment: one Connect serves several businesses.
		sync: catalogSyncSettings(tenant?.settings as Record<string, unknown>),
		canWrite: locals.permissions.includes('catalog:write')
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'catalog:write');
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Name is required.' });
		const price = String(data.get('price') ?? '').trim();
		const tenant = requireTenant(locals);
		try {
			await createCatalogItem(tenant.id, {
				name,
				type: (String(data.get('type') ?? 'PRODUCT') || 'PRODUCT') as never,
				sku: String(data.get('sku') ?? '') || null,
				price: /^\d+(\.\d{1,2})?$/.test(price) ? price : null,
				currency: tenant.currency,
				variants: String(data.get('variants') ?? '')
					.split(',')
					.map((v) => v.trim())
					.filter(Boolean)
					.map((label) => ({ label }))
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Save where a source lives. The URL is SSRF-checked before it is stored. */
	saveSync: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'catalog:write');
		const data = await request.formData();
		const url = String(data.get('url') ?? '').trim();
		const source = String(data.get('source') ?? '').trim() || 'lodges';
		const type = String(data.get('type') ?? 'ACCOMMODATION') as CatalogSource['type'];
		const tenantId = requireTenant(locals).id;
		try {
			const tenant = await getTenantById(tenantId);
			const current = catalogSyncSettings(tenant?.settings as Record<string, unknown>);
			const sources = current.sources.filter((s) => s.source !== source);
			// An empty URL removes the source rather than storing a broken one.
			if (url) sources.push({ source, url, type, enabled: true });
			await saveCatalogSyncSettings(tenantId, { sources });
			return { success: true };
		} catch (error) {
			return fail(400, { error: toAppError(error).message });
		}
	},

	/** Run it now, rather than waiting for the hourly sweep. */
	syncNow: async ({ locals }) => {
		requirePermission(locals.permissions, 'catalog:write');
		try {
			const results = await syncTenantCatalog(requireTenant(locals).id);
			if (!results.length) return fail(400, { error: 'Nothing is configured to sync yet.' });
			return { success: true, results };
		} catch (error) {
			return fail(400, { error: toAppError(error).message });
		}
	},

	toggle: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'catalog:write');
		const data = await request.formData();
		await updateCatalogItem(requireTenant(locals).id, String(data.get('id') ?? ''), {
			isActive: String(data.get('isActive')) === 'true'
		});
		return { success: true };
	}
};
