import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { createCatalogItem, listCatalogItems, updateCatalogItem } from '$lib/server/catalog';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'catalog:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listCatalogItems(requireTenant(locals).id, pagination);
	return { items, total, pagination };
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

	toggle: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'catalog:write');
		const data = await request.formData();
		await updateCatalogItem(requireTenant(locals).id, String(data.get('id') ?? ''), {
			isActive: String(data.get('isActive')) === 'true'
		});
		return { success: true };
	}
};
