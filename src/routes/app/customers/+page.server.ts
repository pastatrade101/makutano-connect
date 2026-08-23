import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listCustomers } from '$lib/server/customers';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'customers:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listCustomers(requireTenant(locals).id, pagination);
	return { items, total, pagination };
};
