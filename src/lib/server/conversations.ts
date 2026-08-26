// Conversations and messages (§10, §17).
//
// The linkage rule from §17 lives here: one conversation per (tenant, channel,
// external id), carrying the customer, lead and booking request it belongs to — so an
// agent opens a request and sees the WhatsApp thread beside it instead of hunting for
// a matching record.
import { and, count, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import { audit } from './audit';
import type { Pagination } from './http';

export async function findOrCreateConversation(params: {
	tenantId: string;
	channel: schema.Conversation['channel'];
	externalId: string | null;
	customerId?: string | null;
	leadId?: string | null;
	bookingRequestId?: string | null;
	whatsappConnectionId?: string | null;
	subject?: string | null;
}): Promise<schema.Conversation> {
	if (params.externalId) {
		const existing = await db()
			.select()
			.from(schema.conversations)
			.where(
				and(
					eq(schema.conversations.tenantId, params.tenantId),
					eq(schema.conversations.channel, params.channel),
					eq(schema.conversations.externalId, params.externalId)
				)
			)
			.limit(1);
		if (existing[0]) {
			// Who the thread belongs to is decided once — a WhatsApp number is one person,
			// and a later enquiry must never quietly re-point the chat at someone else.
			const patch: Partial<typeof schema.conversations.$inferInsert> = {};
			if (params.customerId && !existing[0].customerId) patch.customerId = params.customerId;
			if (params.leadId && !existing[0].leadId) patch.leadId = params.leadId;

			// The enquiry is the opposite case. A traveller who writes again is asking
			// about their NEW request, so "Open enquiry" and the subject follow the
			// latest one; the earlier enquiries stay reachable from the context chips.
			if (params.bookingRequestId && params.bookingRequestId !== existing[0].bookingRequestId) {
				patch.bookingRequestId = params.bookingRequestId;
				if (params.subject) patch.subject = params.subject;
			}
			if (Object.keys(patch).length === 0) return existing[0];
			const [updated] = await db()
				.update(schema.conversations)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.conversations.id, existing[0].id))
				.returning();
			return updated;
		}
	}

	// A new thread lands with the account owner rather than in an unowned pile: someone
	// is answerable for it from the first message, and the owner hands it on from there.
	const assignedToUserId = await defaultAssignee(params.tenantId);

	const [row] = await db()
		.insert(schema.conversations)
		.values({
			tenantId: params.tenantId,
			channel: params.channel,
			externalId: params.externalId,
			customerId: params.customerId ?? null,
			leadId: params.leadId ?? null,
			bookingRequestId: params.bookingRequestId ?? null,
			whatsappConnectionId: params.whatsappConnectionId ?? null,
			subject: params.subject ?? null,
			assignedToUserId,
			lastMessageAt: new Date()
		})
		.returning();
	return row;
}

/**
 * Who owns a brand-new conversation: the tenant's longest-standing active owner.
 *
 * Deliberately narrow — only an OWNER, only an accepted membership, never a
 * deactivated one. If a tenant somehow has no active owner we leave the thread
 * unassigned rather than guessing at a staff member who may not expect it.
 */
export async function defaultAssignee(tenantId: string): Promise<string | null> {
	const rows = await db()
		.select({ userId: schema.tenantMemberships.userId })
		.from(schema.tenantMemberships)
		.where(
			and(
				eq(schema.tenantMemberships.tenantId, tenantId),
				eq(schema.tenantMemberships.role, 'OWNER'),
				isNotNull(schema.tenantMemberships.acceptedAt),
				isNull(schema.tenantMemberships.disabledAt)
			)
		)
		.orderBy(schema.tenantMemberships.createdAt)
		.limit(1);
	return rows[0]?.userId ?? null;
}

/** Who is looking at the inbox — drives visibility scoping (§team-access §7-§9). */
export type ConversationViewer = {
	userId: string;
	permissions: readonly string[];
};

/**
 * The visibility rule, as one SQL predicate:
 *   TEAM      → anyone with inbox access
 *   ASSIGNED  → the assignee (+ view_all holders)
 *   PRIVATE   → view_private holders and explicitly shared members only
 * Owners hold every permission, so they always see everything.
 */
export function conversationScope(viewer: ConversationViewer | undefined): SQL | undefined {
	if (!viewer) return undefined; // internal/system callers (webhooks, jobs) see all
	const viewAll = viewer.permissions.includes('conversations:view_all');
	const viewPrivate = viewer.permissions.includes('conversations:view_private');
	if (viewAll && viewPrivate) return undefined;
	const mine = sql`(${schema.conversations.assignedToUserId} = ${viewer.userId}::uuid
		or ${schema.conversations.sharedWithUserIds} @> ${JSON.stringify([viewer.userId])}::jsonb)`;
	if (viewAll) {
		// Everything except other people's private threads.
		return sql`(${schema.conversations.visibility} <> 'PRIVATE' or ${mine})`;
	}
	const base = viewPrivate
		? sql`${schema.conversations.visibility} in ('TEAM', 'PRIVATE')`
		: sql`${schema.conversations.visibility} = 'TEAM'`;
	return sql`(${base} or ${mine})`;
}

export async function getConversation(
	tenantId: string,
	id: string,
	viewer?: ConversationViewer
): Promise<schema.Conversation> {
	const conditions: SQL[] = [eq(schema.conversations.id, id), eq(schema.conversations.tenantId, tenantId)];
	const scope = conversationScope(viewer);
	if (scope) conditions.push(scope);
	const rows = await db()
		.select()
		.from(schema.conversations)
		.where(and(...conditions))
		.limit(1);
	// A thread outside the viewer's scope is indistinguishable from one that does not
	// exist — direct URLs leak nothing (§34).
	if (!rows[0]) throw new AppError('CONVERSATION_NOT_FOUND', 'Conversation could not be found.');
	return rows[0];
}

/** Assign / change visibility — conversations:assign holders only; both audited. */
export async function updateConversationAccess(
	tenantId: string,
	id: string,
	patch: {
		assignedToUserId?: string | null;
		visibility?: schema.Conversation['visibility'];
		sharedWithUserIds?: string[];
	},
	actor: { userId: string }
): Promise<schema.Conversation> {
	const before = await getConversation(tenantId, id);
	if (patch.assignedToUserId) {
		const [member] = await db()
			.select({ id: schema.tenantMemberships.id })
			.from(schema.tenantMemberships)
			.where(
				and(
					eq(schema.tenantMemberships.tenantId, tenantId),
					eq(schema.tenantMemberships.userId, patch.assignedToUserId),
					isNull(schema.tenantMemberships.disabledAt)
				)
			)
			.limit(1);
		if (!member) throw new AppError('VALIDATION_ERROR', 'That person is not an active member of this team.');
	}
	const [updated] = await db()
		.update(schema.conversations)
		.set({
			...(patch.assignedToUserId !== undefined ? { assignedToUserId: patch.assignedToUserId } : {}),
			...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
			...(patch.sharedWithUserIds !== undefined ? { sharedWithUserIds: patch.sharedWithUserIds } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.conversations.id, id), eq(schema.conversations.tenantId, tenantId)))
		.returning();

	if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== before.assignedToUserId) {
		await audit(
			tenantId,
			'conversation.assigned',
			{ type: 'user', userId: actor.userId },
			{ type: 'conversation', id },
			{
				from: before.assignedToUserId,
				to: patch.assignedToUserId
			}
		);
	}
	if (patch.visibility !== undefined && patch.visibility !== before.visibility) {
		await audit(
			tenantId,
			'conversation.visibility_changed',
			{ type: 'user', userId: actor.userId },
			{ type: 'conversation', id },
			{
				from: before.visibility,
				to: patch.visibility
			}
		);
	}
	return updated;
}

export async function listConversations(
	tenantId: string,
	p: Pagination,
	filters: { open?: boolean; assigned?: 'me' | 'none' } = {},
	viewer?: ConversationViewer
) {
	const conditions: SQL[] = [eq(schema.conversations.tenantId, tenantId)];
	if (filters.open !== undefined) conditions.push(eq(schema.conversations.isOpen, filters.open));
	if (filters.assigned === 'me' && viewer) {
		conditions.push(eq(schema.conversations.assignedToUserId, viewer.userId));
	} else if (filters.assigned === 'none') {
		conditions.push(isNull(schema.conversations.assignedToUserId));
	}
	const scope = conversationScope(viewer);
	if (scope) conditions.push(scope);
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({
				conversation: schema.conversations,
				customer: {
					id: schema.customers.id,
					firstName: schema.customers.firstName,
					lastName: schema.customers.lastName,
					whatsappPhone: schema.customers.whatsappPhone
				}
			})
			.from(schema.conversations)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.conversations.customerId))
			.where(where)
			.orderBy(desc(sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.conversations).where(where)
	]);
	return { items, total: Number(total) };
}

export async function listMessages(tenantId: string, conversationId: string, p: Pagination) {
	await getConversation(tenantId, conversationId);
	const where = and(eq(schema.messages.tenantId, tenantId), eq(schema.messages.conversationId, conversationId));
	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select()
			.from(schema.messages)
			.where(where)
			.orderBy(desc(schema.messages.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.messages).where(where)
	]);
	return { items: items.reverse(), total: Number(total) };
}

export async function touchConversation(conversationId: string, opts: { incrementUnread?: boolean } = {}) {
	await db()
		.update(schema.conversations)
		.set({
			lastMessageAt: new Date(),
			updatedAt: new Date(),
			...(opts.incrementUnread ? { unreadCount: sql`${schema.conversations.unreadCount} + 1` } : {})
		})
		.where(eq(schema.conversations.id, conversationId));
}

export async function markConversationRead(tenantId: string, conversationId: string) {
	await db()
		.update(schema.conversations)
		.set({ unreadCount: 0, updatedAt: new Date() })
		.where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.tenantId, tenantId)));
}
