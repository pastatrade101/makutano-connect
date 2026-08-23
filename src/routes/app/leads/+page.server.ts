import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listLeads } from '$lib/server/leads';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'leads:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listLeads(requireTenant(locals).id, pagination, {
		stage: (url.searchParams.get('status') || undefined) as never
	});
	return { items, total, pagination };
};
