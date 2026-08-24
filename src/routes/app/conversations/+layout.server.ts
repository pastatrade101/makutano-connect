import { requireTenantPermission } from '$lib/server/guards';
import { listConversations } from '$lib/server/conversations';
import type { LayoutServerLoad } from './$types';

/** The chat list lives in the layout so the two-pane inbox shares it across
 *  the index (empty state) and every open thread. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const tenant = requireTenantPermission(locals, 'conversations:read');
	const q = url.searchParams.get('cq')?.trim().toLowerCase() ?? '';
	const filterRaw = url.searchParams.get('filter');
	const filter = filterRaw === 'mine' ? 'me' : filterRaw === 'unassigned' ? 'none' : undefined;
	const { items } = await listConversations(
		tenant.id,
		{ page: 1, limit: 50, order: 'desc' },
		{ assigned: filter as never },
		{ userId: locals.user!.id, permissions: locals.permissions }
	);
	const threads = items
		.map(({ conversation, customer }) => ({
			id: conversation.id,
			name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conversation.externalId ?? ''}`,
			subject: conversation.subject,
			channel: conversation.channel,
			unread: conversation.unreadCount,
			lastMessageAt: conversation.lastMessageAt,
			assignedToUserId: conversation.assignedToUserId,
			assignedToMe: conversation.assignedToUserId === locals.user!.id
		}))
		.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q));
	return { threads, filter: filterRaw ?? 'all' };
};
