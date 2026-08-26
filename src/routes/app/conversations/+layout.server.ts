import { inArray, sql } from 'drizzle-orm';
import { requireTenantPermission } from '$lib/server/guards';
import { listConversations } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { messagePreview } from '$lib/labels';
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
	// What the list actually needs to show: the last thing said. Without it every row
	// falls back to the channel name and the inbox reads "whatsapp" three times over.
	const ids = items.map((i) => i.conversation.id);
	const lastMessages = ids.length
		? ((await db().execute(sql`
				select distinct on (conversation_id) conversation_id, body, type, direction
				from messages
				where conversation_id in (${sql.join(
					ids.map((i) => sql`${i}::uuid`),
					sql`, `
				)})
				order by conversation_id, created_at desc
			`)) as unknown as Array<{ conversation_id: string; body: string | null; type: string | null; direction: string }>)
		: [];
	const lastById = new Map(lastMessages.map((m) => [m.conversation_id, m]));

	// Whoever holds a thread is named in the list, so an owner can see at a glance
	// what they still hold and what has been handed to somebody else.
	const assigneeIds = [...new Set(items.map((i) => i.conversation.assignedToUserId).filter(Boolean))] as string[];
	const assignees = assigneeIds.length
		? await db()
				.select({ id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email })
				.from(schema.users)
				.where(inArray(schema.users.id, assigneeIds))
		: [];
	const shortNameById = new Map(assignees.map((a) => [a.id, (a.fullName || a.email).trim().split(/[\s@]+/)[0]]));

	const threads = items
		.map(({ conversation, customer }) => ({
			id: conversation.id,
			name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conversation.externalId ?? ''}`,
			subject: conversation.subject,
			channel: conversation.channel,
			unread: conversation.unreadCount,
			lastMessageAt: conversation.lastMessageAt,
			assignedToUserId: conversation.assignedToUserId,
			assignedToMe: conversation.assignedToUserId === locals.user!.id,
			preview: (() => {
				const last = lastById.get(conversation.id);
				return last ? messagePreview(last.body, last.type) : null;
			})(),
			lastFromCustomer: lastById.get(conversation.id)?.direction === 'INBOUND',
			assignedToName: conversation.assignedToUserId
				? (shortNameById.get(conversation.assignedToUserId) ?? 'Teammate')
				: null
		}))
		.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q));
	return { threads, filter: filterRaw ?? 'all' };
};
