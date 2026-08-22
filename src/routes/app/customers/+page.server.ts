import { requirePermission } from '$lib/server/auth/permissions';
import { listCustomers } from '$lib/server/customers';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'customers:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listCustomers(locals.tenant!.id, pagination);
	return { items, total, pagination };
};
