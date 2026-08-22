import { requirePermission } from '$lib/server/auth/permissions';
import { listConversations } from '$lib/server/conversations';
import type { LayoutServerLoad } from './$types';

/** The chat list lives in the layout so the two-pane inbox shares it across
 *  the index (empty state) and every open thread. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	requirePermission(locals.permissions, 'conversations:read');
	const q = url.searchParams.get('cq')?.trim().toLowerCase() ?? '';
	const { items } = await listConversations(locals.tenant!.id, { page: 1, limit: 50, order: 'desc' });
	const threads = items
		.map(({ conversation, customer }) => ({
			id: conversation.id,
			name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conversation.externalId ?? ''}`,
			subject: conversation.subject,
			channel: conversation.channel,
			unread: conversation.unreadCount,
			lastMessageAt: conversation.lastMessageAt
		}))
		.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q));
	return { threads };
};
