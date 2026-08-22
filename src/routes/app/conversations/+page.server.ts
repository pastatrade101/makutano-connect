import { requirePermission } from '$lib/server/auth/permissions';
import { listConversations } from '$lib/server/conversations';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'conversations:read');
	const pagination = paginationFrom(url);
	const openParam = url.searchParams.get('status');
	const { items, total } = await listConversations(locals.tenant!.id, pagination, {
		open: openParam === 'closed' ? false : openParam === 'open' ? true : undefined
	});
	return { items, total, pagination };
};
