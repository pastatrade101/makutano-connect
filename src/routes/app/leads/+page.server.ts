import { requirePermission } from '$lib/server/auth/permissions';
import { listLeads } from '$lib/server/leads';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'leads:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listLeads(locals.tenant!.id, pagination, {
		stage: (url.searchParams.get('status') || undefined) as never
	});
	return { items, total, pagination };
};
