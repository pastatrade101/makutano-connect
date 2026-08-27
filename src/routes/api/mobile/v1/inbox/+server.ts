// The inbox, as the app shows it: threads this person may actually open, newest
// first, each with the last thing said. Visibility comes from listConversations,
// which runs the same predicate the browser inbox does.
import type { RequestHandler } from '@sveltejs/kit';
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { listConversations } from '$lib/server/conversations';
import { messagePreview } from '$lib/labels';
import { ok, problem, requireViewer } from '$lib/server/mobile';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const filter = event.url.searchParams.get('filter');
		const { items, total } = await listConversations(
			viewer.tenantId,
			{ page: Number(event.url.searchParams.get('page') ?? 1), limit: 30, order: 'desc' },
			{ assigned: filter === 'mine' ? 'me' : filter === 'unassigned' ? 'none' : undefined },
			{ userId: viewer.userId, permissions: viewer.permissions }
		);

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

		const assigneeIds = [...new Set(items.map((i) => i.conversation.assignedToUserId).filter(Boolean))] as string[];
		const assignees = assigneeIds.length
			? await db()
					.select({ id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email })
					.from(schema.users)
					.where(inArray(schema.users.id, assigneeIds))
			: [];
		const nameById = new Map(assignees.map((a) => [a.id, (a.fullName || a.email).trim().split(/[\s@]+/)[0]]));

		return ok({
			total,
			threads: items.map(({ conversation, customer }) => {
				const last = lastById.get(conversation.id);
				return {
					id: conversation.id,
					name:
						[customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || `+${conversation.externalId ?? ''}`,
					phone: customer?.whatsappPhone ?? conversation.externalId,
					preview: last ? messagePreview(last.body, last.type) : null,
					lastFromCustomer: last?.direction === 'INBOUND',
					unread: conversation.unreadCount,
					lastMessageAt: conversation.lastMessageAt,
					assignedToMe: conversation.assignedToUserId === viewer.userId,
					assignedToName: conversation.assignedToUserId
						? (nameById.get(conversation.assignedToUserId) ?? 'Teammate')
						: null,
					isOpen: conversation.isOpen
				};
			})
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
