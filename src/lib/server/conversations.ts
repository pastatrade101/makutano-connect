// Conversations and messages (§10, §17).
//
// The linkage rule from §17 lives here: one conversation per (tenant, channel,
// external id), carrying the customer, lead and booking request it belongs to — so an
// agent opens a request and sees the WhatsApp thread beside it instead of hunting for
// a matching record.
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
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
			// Late-arriving links (a booking request created after the chat started) are
			// filled in, but an existing link is never overwritten.
			const patch: Partial<typeof schema.conversations.$inferInsert> = {};
			if (params.customerId && !existing[0].customerId) patch.customerId = params.customerId;
			if (params.leadId && !existing[0].leadId) patch.leadId = params.leadId;
			if (params.bookingRequestId && !existing[0].bookingRequestId) patch.bookingRequestId = params.bookingRequestId;
			if (Object.keys(patch).length === 0) return existing[0];
			const [updated] = await db()
				.update(schema.conversations)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.conversations.id, existing[0].id))
				.returning();
			return updated;
		}
	}

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
			lastMessageAt: new Date()
		})
		.returning();
	return row;
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
		await audit(tenantId, 'conversation.assigned', { type: 'user', userId: actor.userId }, { type: 'conversation', id }, {
			from: before.assignedToUserId,
			to: patch.assignedToUserId
		});
	}
	if (patch.visibility !== undefined && patch.visibility !== before.visibility) {
		await audit(tenantId, 'conversation.visibility_changed', { type: 'user', userId: actor.userId }, { type: 'conversation', id }, {
			from: before.visibility,
			to: patch.visibility
		});
	}
	return updated;
}

export async function listConversations(
	tenantId: string,
	p: Pagination,
	filters: { open?: boolean } = {},
	viewer?: ConversationViewer
) {
	const conditions: SQL[] = [eq(schema.conversations.tenantId, tenantId)];
	if (filters.open !== undefined) conditions.push(eq(schema.conversations.isOpen, filters.open));
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
