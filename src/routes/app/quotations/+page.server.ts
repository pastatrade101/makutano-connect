import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listQuotations } from '$lib/server/quotations';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'quotations:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listQuotations(requireTenant(locals).id, pagination, {
		status: (url.searchParams.get('status') || undefined) as never
	});
	return { items, total, pagination };
};
