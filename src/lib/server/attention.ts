// What needs a person today — derived on the server, once, for everybody.
//
// Home used to compute this with a wall of role checks in the component, which meant
// every number was tenant-wide: an agent saw the whole company's unread count and a
// finance user saw enquiries they would never touch. This module answers instead:
//
//   given THIS viewer's permissions, assignments and workspace, what is waiting?
//
// Three rules hold it together:
//   1. Nothing is counted that the viewer could not open — conversation counts run
//      through the same visibility predicate the inbox uses.
//   2. Personal work outranks the company's, and money outranks both.
//   3. Role is only a presentation hint at the end; permissions decide everything.
import { and, count, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { conversationScope } from './conversations';
import { moduleRelevant, type Workspace } from '$lib/workspace';

export type Persona = 'owner' | 'agent' | 'finance' | 'viewer';

export type AttentionItem = {
	key: string;
	/** Already written the way it should read on screen, count included. */
	label: string;
	count: number;
	href: string;
	urgency: 'critical' | 'high' | 'normal';
	/** Mine = assigned to me. Business = the company's, for those who watch it. */
	scope: 'mine' | 'business';
};

export type Viewer = { userId: string; permissions: readonly string[] };

const URGENCY_RANK = { critical: 0, high: 1, normal: 2 } as const;

/**
 * Which experience to lead with. Deliberately permission-shaped: Connect has no
 * finance role, so a finance user is whoever may verify money but does not run
 * operations — usually a Viewer with `payments:verify` granted on their membership.
 */
export function personaFor(permissions: readonly string[]): Persona {
	const has = (p: string) => permissions.includes(p);
	const operates = has('orders:write') || has('booking_requests:write') || has('conversations:write');
	const administers = has('members:write') || has('tenant:write');
	const watchesEverything = has('conversations:view_all');
	if (has('payments:verify') && !operates) return 'finance';
	if (!operates) return 'viewer';
	if (administers || watchesEverything) return 'owner';
	return 'agent';
}

/** Conversations the viewer may actually open, counted with the inbox's own rules. */
async function conversationCounts(tenantId: string, viewer: Viewer) {
	const scope = conversationScope(viewer);
	const visible = (extra: SQL) =>
		scope
			? and(eq(schema.conversations.tenantId, tenantId), scope, extra)!
			: and(eq(schema.conversations.tenantId, tenantId), extra)!;

	const [mine, unassigned, openToMe, today] = await Promise.all([
		db()
			.select({ value: count() })
			.from(schema.conversations)
			.where(
				visible(and(gt(schema.conversations.unreadCount, 0), eq(schema.conversations.assignedToUserId, viewer.userId))!)
			),
		db()
			.select({ value: count() })
			.from(schema.conversations)
			.where(visible(isNull(schema.conversations.assignedToUserId))),
		db()
			.select({ value: count() })
			.from(schema.conversations)
			.where(visible(gt(schema.conversations.unreadCount, 0))),
		db()
			.select({ value: count() })
			.from(schema.conversations)
			.where(visible(sql`${schema.conversations.createdAt}::date = current_date`))
	]);
	return {
		mineUnread: Number(mine[0]?.value ?? 0),
		unassigned: Number(unassigned[0]?.value ?? 0),
		unreadVisible: Number(openToMe[0]?.value ?? 0),
		today: Number(today[0]?.value ?? 0)
	};
}

/** Everything else, in one round trip. Personal columns are scoped by assignment. */
async function operationalCounts(tenantId: string, userId: string) {
	const rows = (await db().execute(sql`
		select
			(select count(*)::int from booking_requests r
				where r.tenant_id = ${tenantId}::uuid and r.status = 'NEW') as new_enquiries,
			(select count(*)::int from booking_requests r
				where r.tenant_id = ${tenantId}::uuid and r.assignee_user_id = ${userId}::uuid
					and r.status in ('NEW', 'UNDER_REVIEW', 'CONTACTED')) as my_enquiries,
			(select count(*)::int from orders o
				where o.tenant_id = ${tenantId}::uuid and o.status = 'PENDING_CONFIRMATION') as orders_to_confirm,
			(select count(*)::int from orders o
				where o.tenant_id = ${tenantId}::uuid and o.status = 'READY') as orders_ready,
			(select count(*)::int from bookings b
				where b.tenant_id = ${tenantId}::uuid and b.status = 'AWAITING_PAYMENT') as bookings_unpaid,
			(select count(*)::int from quotations q
				where q.tenant_id = ${tenantId}::uuid and q.status = 'SENT') as quotes_waiting,
			(select count(*)::int from payment_requests pr
				where pr.tenant_id = ${tenantId}::uuid and pr.status = 'REPORTED') as payments_reported,
			(select count(*)::int from payment_requests pr
				where pr.tenant_id = ${tenantId}::uuid and pr.status = 'REQUESTED') as payments_outstanding,
			(select count(*)::int from payments p
				where p.tenant_id = ${tenantId}::uuid and p.status = 'FAILED'
					and p.created_at > now() - interval '30 days') as payments_failed,
			(select count(*)::int from orders o
				where o.tenant_id = ${tenantId}::uuid and o.created_at::date = current_date) as orders_today,
			(select count(*)::int from booking_requests r
				where r.tenant_id = ${tenantId}::uuid and r.created_at::date = current_date) as enquiries_today,
			(select coalesce(sum(p.amount), 0)::numeric(14,2) from payments p
				where p.tenant_id = ${tenantId}::uuid and p.status = 'SUCCEEDED'
					and p.created_at::date = current_date) as received_today,
			(select count(*)::int from payments p
				where p.tenant_id = ${tenantId}::uuid and p.status = 'SUCCEEDED'
					and p.created_at::date = current_date) as verified_today
	`)) as unknown as Array<Record<string, unknown>>;
	const row = rows[0] ?? {};
	const n = (key: string) => Number(row[key] ?? 0);
	return {
		newEnquiries: n('new_enquiries'),
		myEnquiries: n('my_enquiries'),
		ordersToConfirm: n('orders_to_confirm'),
		ordersReady: n('orders_ready'),
		bookingsUnpaid: n('bookings_unpaid'),
		quotesWaiting: n('quotes_waiting'),
		paymentsReported: n('payments_reported'),
		paymentsOutstanding: n('payments_outstanding'),
		paymentsFailed: n('payments_failed'),
		ordersToday: n('orders_today'),
		enquiriesToday: n('enquiries_today'),
		receivedToday: String(row.received_today ?? '0'),
		verifiedToday: n('verified_today')
	};
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export async function attentionFor(
	tenantId: string,
	viewer: Viewer,
	workspace: Workspace
): Promise<{
	persona: Persona;
	items: AttentionItem[];
	today: Array<{ label: string; value: string }>;
}> {
	const persona = personaFor(viewer.permissions);
	const can = (p: string) => viewer.permissions.includes(p);
	const rel = (m: Parameters<typeof moduleRelevant>[1]) => moduleRelevant(workspace, m);

	const [chats, ops] = await Promise.all([
		can('conversations:read')
			? conversationCounts(tenantId, viewer)
			: Promise.resolve({ mineUnread: 0, unassigned: 0, unreadVisible: 0, today: 0 }),
		operationalCounts(tenantId, viewer.userId)
	]);

	const items: AttentionItem[] = [];
	const push = (item: AttentionItem) => {
		if (item.count > 0) items.push(item);
	};

	// Money someone is waiting to be believed about. Nothing outranks it.
	if (can('payments:read')) {
		push({
			key: 'payments_reported',
			label: `${ops.paymentsReported} ${plural(ops.paymentsReported, 'customer says', 'customers say')} they've paid`,
			count: ops.paymentsReported,
			href: '/app/payments?verify=1',
			urgency: 'critical',
			scope: 'business'
		});
		push({
			key: 'payments_failed',
			label: `${ops.paymentsFailed} ${plural(ops.paymentsFailed, 'payment', 'payments')} failed`,
			count: ops.paymentsFailed,
			href: '/app/payments?status=FAILED',
			urgency: 'high',
			scope: 'business'
		});
		if (persona === 'finance') {
			push({
				key: 'payments_outstanding',
				label: `${ops.paymentsOutstanding} ${plural(ops.paymentsOutstanding, 'payment request', 'payment requests')} still unpaid`,
				count: ops.paymentsOutstanding,
				href: '/app/payments',
				urgency: 'normal',
				scope: 'business'
			});
		}
	}

	// Mine before everyone's.
	if (can('conversations:read') && persona !== 'finance') {
		push({
			key: 'my_unread',
			label: chats.mineUnread === 1 ? '1 chat needs your reply' : `${chats.mineUnread} of your chats need a reply`,
			count: chats.mineUnread,
			href: '/app/conversations?filter=mine',
			urgency: 'high',
			scope: 'mine'
		});
		const others = Math.max(0, chats.unreadVisible - chats.mineUnread);
		if (persona !== 'agent') {
			push({
				key: 'unread',
				label: `${others} other ${plural(others, 'chat is', 'chats are')} waiting for a reply`,
				count: others,
				href: '/app/conversations',
				urgency: 'normal',
				scope: 'business'
			});
		}
		if (can('conversations:assign')) {
			push({
				key: 'unassigned',
				label: `${chats.unassigned} ${plural(chats.unassigned, 'chat has', 'chats have')} nobody looking after them`,
				count: chats.unassigned,
				href: '/app/conversations?filter=unassigned',
				urgency: 'high',
				scope: 'business'
			});
		}
	}

	if (persona !== 'finance' && rel('enquiries') && can('booking_requests:read')) {
		push({
			key: 'my_enquiries',
			label: ops.myEnquiries === 1 ? '1 enquiry is yours to work on' : `${ops.myEnquiries} of your enquiries need work`,
			count: persona === 'agent' ? ops.myEnquiries : 0,
			href: '/app/booking-requests',
			urgency: 'high',
			scope: 'mine'
		});
		push({
			key: 'new_enquiries',
			label: `${ops.newEnquiries} new ${plural(ops.newEnquiries, 'enquiry', 'enquiries')}`,
			count: ops.newEnquiries,
			href: '/app/booking-requests?status=NEW',
			urgency: 'high',
			scope: 'business'
		});
	}

	if (persona !== 'finance' && rel('orders') && can('orders:read')) {
		push({
			key: 'orders_to_confirm',
			label: `${ops.ordersToConfirm} ${plural(ops.ordersToConfirm, 'order needs', 'orders need')} confirming`,
			count: ops.ordersToConfirm,
			href: '/app/orders?status=PENDING_CONFIRMATION',
			urgency: 'high',
			scope: 'business'
		});
		push({
			key: 'orders_ready',
			label: `${ops.ordersReady} ${plural(ops.ordersReady, 'order is', 'orders are')} ready to go out`,
			count: ops.ordersReady,
			href: '/app/orders?status=READY',
			urgency: 'normal',
			scope: 'business'
		});
	}

	if (persona !== 'finance' && rel('bookings') && can('bookings:read')) {
		push({
			key: 'bookings_unpaid',
			label: `${ops.bookingsUnpaid} ${plural(ops.bookingsUnpaid, 'booking is', 'bookings are')} waiting for payment`,
			count: ops.bookingsUnpaid,
			href: '/app/bookings?payment=unpaid',
			urgency: 'high',
			scope: 'business'
		});
	}

	if (persona !== 'finance' && rel('quotations') && can('quotations:read')) {
		push({
			key: 'quotes_waiting',
			label: `${ops.quotesWaiting} ${plural(ops.quotesWaiting, 'quotation is', 'quotations are')} awaiting an answer`,
			count: ops.quotesWaiting,
			href: '/app/quotations?status=SENT',
			urgency: 'normal',
			scope: 'business'
		});
	}

	items.sort((a, b) => {
		const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
		if (urgency !== 0) return urgency;
		if (a.scope !== b.scope) return a.scope === 'mine' ? -1 : 1;
		return b.count - a.count;
	});

	// Today, scoped to what this person is responsible for.
	const today: Array<{ label: string; value: string }> = [];
	if (persona === 'finance') {
		if (can('payments:read')) {
			today.push({ label: 'Verified today', value: String(ops.verifiedToday) });
			today.push({ label: 'Received today', value: ops.receivedToday });
			today.push({ label: 'Still unpaid', value: String(ops.paymentsOutstanding) });
		}
	} else {
		if (can('conversations:read')) {
			// An agent's number is the queue in front of them, not a daily total — so it
			// gets a label that says so rather than borrowing the owner's.
			today.push(
				persona === 'agent'
					? { label: 'Waiting on you', value: String(chats.mineUnread) }
					: { label: 'New chats today', value: String(chats.today) }
			);
		}
		if (rel('enquiries') && can('booking_requests:read')) {
			today.push({ label: 'Enquiries today', value: String(ops.enquiriesToday) });
		}
		if (rel('orders') && can('orders:read')) {
			today.push({ label: 'Orders today', value: String(ops.ordersToday) });
		}
		if (can('payments:read')) today.push({ label: 'Received today', value: ops.receivedToday });
	}

	return { persona, items: items.slice(0, 6), today };
}

/** An agent's own queue: threads they hold that are still talking to them. */
export async function myWork(tenantId: string, viewer: Viewer) {
	if (!viewer.permissions.includes('conversations:read')) return [];
	const scope = conversationScope(viewer);
	const where = scope
		? and(
				eq(schema.conversations.tenantId, tenantId),
				eq(schema.conversations.assignedToUserId, viewer.userId),
				eq(schema.conversations.isOpen, true),
				scope
			)
		: and(
				eq(schema.conversations.tenantId, tenantId),
				eq(schema.conversations.assignedToUserId, viewer.userId),
				eq(schema.conversations.isOpen, true)
			);
	return db()
		.select({
			id: schema.conversations.id,
			unreadCount: schema.conversations.unreadCount,
			lastMessageAt: schema.conversations.lastMessageAt,
			subject: schema.conversations.subject,
			externalId: schema.conversations.externalId,
			firstName: schema.customers.firstName,
			lastName: schema.customers.lastName
		})
		.from(schema.conversations)
		.leftJoin(schema.customers, eq(schema.customers.id, schema.conversations.customerId))
		.where(where)
		.orderBy(
			sql`${schema.conversations.unreadCount} > 0 desc, coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt}) desc`
		)
		.limit(5);
}
