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
import { nextForBooking, nextForEnquiry, nextForOrder, nextForQuotation, pickNext } from '$lib/next-action';
import { statusLabel } from '$lib/labels';

export type Persona = 'owner' | 'agent' | 'finance' | 'viewer';

export type AttentionItem = {
	key: string;
	/** Already written the way it should read on screen, count included. */
	label: string;
	/** WHY it needs someone — the phone shows this above the count. */
	title?: string;
	/** WHAT is waiting, counted: "1 booking", "3 quotations". */
	detail?: string;
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
				where r.tenant_id = ${tenantId}::uuid and r.deleted_at is null and r.status = 'NEW') as new_enquiries,
			(select count(*)::int from booking_requests r
				where r.tenant_id = ${tenantId}::uuid and r.deleted_at is null and r.assignee_user_id = ${userId}::uuid
					and r.status in ('NEW', 'UNDER_REVIEW', 'CONTACTED')) as my_enquiries,
			(select count(*)::int from orders o
				where o.tenant_id = ${tenantId}::uuid and o.status = 'PENDING_CONFIRMATION') as orders_to_confirm,
			(select count(*)::int from orders o
				where o.tenant_id = ${tenantId}::uuid and o.status = 'READY') as orders_ready,
			(select count(*)::int from bookings b
				where b.tenant_id = ${tenantId}::uuid and b.deleted_at is null and b.status = 'AWAITING_PAYMENT') as bookings_unpaid,
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
				where r.tenant_id = ${tenantId}::uuid and r.deleted_at is null and r.created_at::date = current_date) as enquiries_today,
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
	/** True and worth knowing, but somebody else's move. Never in "Needs you". */
	context: AttentionItem[];
	/** `money` carries an amount and should be shown with the tenant's currency. */
	today: Array<{ label: string; value: string; kind: 'count' | 'money' }>;
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
	const context: AttentionItem[] = [];
	const push = (item: AttentionItem) => {
		if (item.count > 0) items.push(item);
	};
	const note = (item: AttentionItem) => {
		if (item.count > 0) context.push(item);
	};

	// Money someone is waiting to be believed about. Nothing outranks it — for the
	// person who can act on it. "Needs you" means YOU can take the next step, so for
	// anyone without payments:verify the same fact is context, not a task.
	if (can('payments:read')) {
		const forMe = can('payments:verify') ? push : note;
		forMe({
			key: 'payments_reported',
			title: can('payments:verify') ? 'Payment needs verification' : 'Waiting for finance',
			detail: `${ops.paymentsReported} ${plural(ops.paymentsReported, 'customer', 'customers')}`,
			label: can('payments:verify')
				? `${ops.paymentsReported} ${plural(ops.paymentsReported, 'customer says', 'customers say')} they've paid`
				: `${ops.paymentsReported} reported ${plural(ops.paymentsReported, 'payment is', 'payments are')} waiting for finance`,
			count: ops.paymentsReported,
			href: '/app/payments?verify=1',
			urgency: 'critical',
			scope: 'business'
		});
		forMe({
			key: 'payments_failed',
			title: 'Payments failed',
			detail: `${ops.paymentsFailed} ${plural(ops.paymentsFailed, 'payment', 'payments')}`,
			label: can('payments:verify')
				? `${ops.paymentsFailed} ${plural(ops.paymentsFailed, 'payment', 'payments')} failed`
				: `${ops.paymentsFailed} failed ${plural(ops.paymentsFailed, 'payment is', 'payments are')} with finance`,
			count: ops.paymentsFailed,
			href: '/app/payments?status=FAILED',
			urgency: 'high',
			scope: 'business'
		});
		if (persona === 'finance') {
			push({
				key: 'payments_outstanding',
				title: 'Payment not yet made',
				detail: `${ops.paymentsOutstanding} ${plural(ops.paymentsOutstanding, 'request', 'requests')}`,
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
			title: 'Customers waiting for your reply',
			detail: `${chats.mineUnread} ${plural(chats.mineUnread, 'conversation', 'conversations')}`,
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
				title: 'Customers waiting for a reply',
				detail: `${others} ${plural(others, 'conversation', 'conversations')}`,
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
				title: 'Nobody is looking after these',
				detail: `${chats.unassigned} ${plural(chats.unassigned, 'conversation', 'conversations')}`,
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
			title: 'Your enquiries need work',
			detail: `${ops.myEnquiries} ${plural(ops.myEnquiries, 'enquiry', 'enquiries')}`,
			label: ops.myEnquiries === 1 ? '1 enquiry is yours to work on' : `${ops.myEnquiries} of your enquiries need work`,
			count: persona === 'agent' ? ops.myEnquiries : 0,
			href: '/app/booking-requests',
			urgency: 'high',
			scope: 'mine'
		});
		push({
			key: 'new_enquiries',
			title: 'New enquiries',
			detail: `${ops.newEnquiries} ${plural(ops.newEnquiries, 'customer', 'customers')}`,
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
			title: 'Orders need confirming',
			detail: `${ops.ordersToConfirm} ${plural(ops.ordersToConfirm, 'order', 'orders')}`,
			label: `${ops.ordersToConfirm} ${plural(ops.ordersToConfirm, 'order needs', 'orders need')} confirming`,
			count: ops.ordersToConfirm,
			href: '/app/orders?status=PENDING_CONFIRMATION',
			urgency: 'high',
			scope: 'business'
		});
		push({
			key: 'orders_ready',
			title: 'Ready to go out',
			detail: `${ops.ordersReady} ${plural(ops.ordersReady, 'order', 'orders')}`,
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
			title: 'Payment needed',
			detail: `${ops.bookingsUnpaid} ${plural(ops.bookingsUnpaid, 'booking', 'bookings')}`,
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
			title: 'Waiting for the customer',
			detail: `${ops.quotesWaiting} ${plural(ops.quotesWaiting, 'quotation', 'quotations')}`,
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
	const today: Array<{ label: string; value: string; kind: 'count' | 'money' }> = [];
	if (persona === 'finance') {
		if (can('payments:read')) {
			today.push({ label: 'Verified today', value: String(ops.verifiedToday), kind: 'count' });
			today.push({ label: 'Received today', value: ops.receivedToday, kind: 'money' });
			today.push({ label: 'Still unpaid', value: String(ops.paymentsOutstanding), kind: 'count' });
		}
	} else {
		if (can('conversations:read')) {
			// An agent's number is the queue in front of them, not a daily total — so it
			// gets a label that says so rather than borrowing the owner's.
			today.push(
				persona === 'agent'
					? { label: 'Waiting on you', value: String(chats.mineUnread), kind: 'count' as const }
					: { label: 'New chats today', value: String(chats.today), kind: 'count' as const }
			);
		}
		if (rel('enquiries') && can('booking_requests:read')) {
			today.push({ label: 'Enquiries today', value: String(ops.enquiriesToday), kind: 'count' });
		}
		if (rel('orders') && can('orders:read')) {
			today.push({ label: 'Orders today', value: String(ops.ordersToday), kind: 'count' });
		}
		if (can('payments:read')) today.push({ label: 'Received today', value: ops.receivedToday, kind: 'money' });
	}

	return { persona, items: items.slice(0, 6), context: context.slice(0, 3), today };
}

export type MyWorkItem = {
	kind: 'conversation' | 'enquiry';
	id: string;
	title: string;
	detail: string | null;
	unread: number;
	at: Date | string | null;
	href: string;
};

/**
 * An agent's own queue — the threads AND the enquiries they personally hold. Five of
 * each at most, scoped on the server: Home is a starting point, not a work manager.
 */
export async function myWork(tenantId: string, viewer: Viewer): Promise<MyWorkItem[]> {
	const [threads, enquiries] = await Promise.all([myConversations(tenantId, viewer), myEnquiries(tenantId, viewer)]);
	return [...threads, ...enquiries]
		.sort((a, b) => {
			if (a.unread !== b.unread) return b.unread - a.unread;
			return new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime();
		})
		.slice(0, 6);
}

/** Enquiries assigned to this person that still need work. */
async function myEnquiries(tenantId: string, viewer: Viewer): Promise<MyWorkItem[]> {
	if (!viewer.permissions.includes('booking_requests:read')) return [];
	const rows = await db()
		.select({
			id: schema.bookingRequests.id,
			reference: schema.bookingRequests.reference,
			updatedAt: schema.bookingRequests.updatedAt,
			firstName: schema.customers.firstName,
			lastName: schema.customers.lastName
		})
		.from(schema.bookingRequests)
		.leftJoin(schema.customers, eq(schema.customers.id, schema.bookingRequests.customerId))
		.where(
			and(
				eq(schema.bookingRequests.tenantId, tenantId),
				eq(schema.bookingRequests.assigneeUserId, viewer.userId),
				sql`${schema.bookingRequests.status} in ('NEW', 'UNDER_REVIEW', 'CONTACTED')`
			)
		)
		.orderBy(sql`${schema.bookingRequests.updatedAt} desc`)
		.limit(5);
	return rows.map((row) => ({
		kind: 'enquiry' as const,
		id: row.id,
		title: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.reference,
		detail: `Enquiry ${row.reference}`,
		unread: 0,
		at: row.updatedAt,
		href: `/app/booking-requests/${row.id}`
	}));
}

async function myConversations(tenantId: string, viewer: Viewer): Promise<MyWorkItem[]> {
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
	const rows = await db()
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
	return rows.map((row) => ({
		kind: 'conversation' as const,
		id: row.id,
		title: [row.firstName, row.lastName].filter(Boolean).join(' ') || `+${row.externalId ?? ''}`,
		detail: row.subject,
		unread: row.unreadCount,
		at: row.lastMessageAt,
		href: `/app/conversations/${row.id}`
	}));
}

/* ------------------------------------------------- continue working ------- */

export type ContinueItem = {
	/** Line one: who. */
	customer: string;
	/** Line two: what it is and what state it is in — never a database status. */
	state: string;
	/** Line three: the fact that makes it actionable. */
	detail: string | null;
	kind: 'enquiry' | 'quotation' | 'booking' | 'order' | 'conversation';
	conversationId: string | null;
	recordId: string | null;
	next: { key: string; label: string } | null;
	/** Assigned to this person — sorted above everyone else's work. */
	mine: boolean;
	at: string | Date | null;
};

type OpenRecord = {
	kind: 'enquiry' | 'quotation' | 'booking' | 'order';
	id: string;
	customer_id: string | null;
	reference: string;
	status: string;
	total: string;
	amount_paid: string;
	currency: string;
	adults: number | null;
	notes: string | null;
	updated_at: string;
	converted_booking_id: string | null;
	active_request_status: string | null;
	assignee_user_id: string | null;
};

/**
 * What this person was already in the middle of — as business, not as chat rows.
 *
 * Home is not a second inbox: a customer appears here because of where they are in
 * the lifecycle ("Quotation · waiting for response"), and the wording comes from the
 * same next-action resolver every other screen uses. Conversations are only the way
 * in; the state is the reason.
 */
export async function continueWorking(tenantId: string, viewer: Viewer, workspace: Workspace): Promise<ContinueItem[]> {
	if (!viewer.permissions.includes('conversations:read')) return [];
	const can = (p: string) => viewer.permissions.includes(p);
	const rel = (m: Parameters<typeof moduleRelevant>[1]) => moduleRelevant(workspace, m);

	// Threads this viewer may actually open — the visibility predicate decides.
	const scope = conversationScope(viewer);
	const base = and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.isOpen, true));
	const threads = await db()
		.select({
			id: schema.conversations.id,
			customerId: schema.conversations.customerId,
			externalId: schema.conversations.externalId,
			assignedToUserId: schema.conversations.assignedToUserId,
			lastMessageAt: schema.conversations.lastMessageAt,
			firstName: schema.customers.firstName,
			lastName: schema.customers.lastName
		})
		.from(schema.conversations)
		.leftJoin(schema.customers, eq(schema.customers.id, schema.conversations.customerId))
		.where(scope ? and(base, scope) : base)
		.orderBy(sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt}) desc`)
		.limit(12);
	if (!threads.length) return [];

	const customerIds = threads.map((t) => t.customerId).filter(Boolean) as string[];
	const records = customerIds.length
		? ((await db().execute(sql`
				select * from (
					select 'enquiry' as kind, br.id::text, br.customer_id::text, br.reference, br.status::text,
						coalesce(br.estimated_total::text,'0') as total, '0' as amount_paid, br.currency,
						br.adults, br.notes, br.updated_at, null::text as converted_booking_id,
						null::text as active_request_status, br.assignee_user_id::text
					from booking_requests br
					where br.tenant_id = ${tenantId}::uuid and br.deleted_at is null and br.customer_id::text in ${customerIds}
						and br.status in ('NEW','UNDER_REVIEW','CONTACTED','QUOTED')
					union all
					select 'quotation', q.id::text, q.customer_id::text, q.reference, q.status::text, q.total::text, '0', q.currency,
						q.adults, q.notes, q.updated_at, q.converted_booking_id::text, null, null
					from quotations q
					where q.tenant_id = ${tenantId}::uuid and q.customer_id::text in ${customerIds}
						and q.status in ('DRAFT','SENT','VIEWED','ACCEPTED')
					union all
					select 'booking', b.id::text, b.customer_id::text, b.booking_reference, b.status::text, b.total::text,
						b.amount_paid::text, b.currency, b.adults, null, b.updated_at, null,
						(select pr.status::text from payment_requests pr where pr.booking_id = b.id
							and pr.status in ('REQUESTED','REPORTED','PARTIALLY_PAID') order by pr.created_at desc limit 1),
						null
					from bookings b
					where b.tenant_id = ${tenantId}::uuid and b.deleted_at is null and b.customer_id::text in ${customerIds}
						and b.status not in ('COMPLETED','CANCELLED','REFUNDED')
					union all
					select 'order', o.id::text, o.customer_id::text, o.order_number, o.status::text, o.total::text,
						o.amount_paid::text, o.currency, null, o.notes, o.updated_at, null,
						(select pr.status::text from payment_requests pr where pr.order_id = o.id
							and pr.status in ('REQUESTED','REPORTED','PARTIALLY_PAID') order by pr.created_at desc limit 1),
						null
					from orders o
					where o.tenant_id = ${tenantId}::uuid and o.customer_id::text in ${customerIds}
						and o.status not in ('DELIVERED','CANCELLED','REFUNDED')
				) t
				order by updated_at desc
			`)) as unknown as OpenRecord[])
		: [];

	const ability = {
		orders: can('orders:write'),
		payments: can('payments:write'),
		verifyPayments: can('payments:verify'),
		quotations: can('quotations:write'),
		bookings: can('bookings:read'),
		bookingsWrite: can('bookings:write'),
		// Without these the inbox would still recommend the retired booking-level
		// "Start trip" while the booking page recommends the handover. hasTrip is not
		// known here, and an unknown reads as not-handed-over on purpose: the action
		// is a link to the booking, which then shows the truth.
		trips: can('trips:read'),
		tripsWrite: can('trips:write')
	};
	const READABLE = {
		enquiry: 'booking_requests:read',
		quotation: 'quotations:read',
		booking: 'bookings:read',
		order: 'orders:read'
	} as const;
	const MODULE = { enquiry: 'enquiries', quotation: 'quotations', booking: 'bookings', order: 'orders' } as const;
	const money = (r: OpenRecord) => Math.max(0, Number(r.total) - Number(r.amount_paid));

	const items: ContinueItem[] = threads.map((thread) => {
		const name = [thread.firstName, thread.lastName].filter(Boolean).join(' ').trim() || `+${thread.externalId ?? ''}`;
		const mine = thread.assignedToUserId === viewer.userId;

		// Only records this person may see, in a workspace that runs them.
		const forCustomer = records.filter(
			(r) => r.customer_id === thread.customerId && rel(MODULE[r.kind]) && can(READABLE[r.kind])
		);
		const withNext = forCustomer.map((r) => ({
			record: r,
			next:
				r.kind === 'order'
					? nextForOrder(
							{ id: r.id, status: r.status, outstanding: money(r), activeRequestStatus: r.active_request_status },
							ability
						)
					: r.kind === 'booking'
						? nextForBooking(
								{ id: r.id, status: r.status, outstanding: money(r), activeRequestStatus: r.active_request_status },
								ability
							)
						: r.kind === 'quotation'
							? nextForQuotation({ id: r.id, status: r.status, convertedBookingId: r.converted_booking_id }, ability)
							: nextForEnquiry(
									{ id: r.id, status: r.status, hasQuotation: forCustomer.some((q) => q.kind === 'quotation') },
									ability
								)
		}));

		// The record whose next step matters most; failing that, the newest one.
		const top = pickNext(withNext.map((w) => w.next));
		const chosen = (top ? withNext.find((w) => w.next?.key === top.key) : withNext[0]) ?? null;

		if (!chosen) {
			return {
				customer: name,
				state: 'New WhatsApp conversation',
				detail: rel('enquiries') ? 'No enquiry yet' : 'No order yet',
				kind: 'conversation' as const,
				conversationId: thread.id,
				recordId: null,
				next: null,
				mine,
				at: thread.lastMessageAt
			};
		}

		const r = chosen.record;
		return {
			customer: name,
			state: describeState(r, chosen.next?.key ?? null),
			detail: describeDetail(r),
			kind: r.kind,
			conversationId: thread.id,
			recordId: r.id,
			next: chosen.next ? { key: chosen.next.key, label: chosen.next.label } : null,
			mine: mine || r.assignee_user_id === viewer.userId,
			at: r.updated_at
		};
	});

	return items
		.sort((a, b) => {
			if (a.mine !== b.mine) return a.mine ? -1 : 1;
			// Something waiting on us beats something waiting on the customer.
			const actionable = (i: ContinueItem) => (i.next ? 0 : 1);
			if (actionable(a) !== actionable(b)) return actionable(a) - actionable(b);
			return new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime();
		})
		.slice(0, 4);
}

/** "Quotation · Waiting for response" — what it is, and why it is sitting there. */
function describeState(record: OpenRecord, nextKey: string | null): string {
	const noun = { enquiry: 'Enquiry', quotation: 'Quotation', booking: 'Booking', order: 'Order' }[record.kind];
	if (record.active_request_status === 'REPORTED') return `${noun} · Customer says they've paid`;
	if (record.active_request_status === 'REQUESTED') return `${noun} · Waiting for payment`;
	switch (nextKey) {
		case 'create_quotation':
			return `${noun} · Needs a quotation`;
		case 'send_quotation':
			return `${noun} · Not sent yet`;
		case 'accept_quotation':
			return `${noun} · Waiting for the customer`;
		case 'request_payment':
			return `${noun} · Needs a payment request`;
		case 'confirm_order':
			return `${noun} · Needs confirming`;
		case 'confirm_booking':
			return `${noun} · Ready to confirm`;
		case 'mark_ready':
			return `${noun} · Being prepared`;
		case 'dispatch_order':
			return `${noun} · Ready to go out`;
		case 'mark_delivered':
			return `${noun} · On its way`;
		case 'start_trip':
			return `${noun} · Confirmed`;
		default:
			return `${noun} · ${statusLabel(record.status)}`;
	}
}

/** The one fact that makes the row useful: money owed, size of party, or a reference. */
function describeDetail(record: OpenRecord): string | null {
	const outstanding = Math.max(0, Number(record.total) - Number(record.amount_paid));
	if (outstanding > 0 && record.kind !== 'enquiry') {
		return `${record.currency} ${outstanding.toLocaleString('en-US', { minimumFractionDigits: 0 })} outstanding`;
	}
	if (record.kind === 'enquiry') {
		const bits: string[] = [];
		if (record.adults) bits.push(`${record.adults} ${record.adults === 1 ? 'traveller' : 'travellers'}`);
		if (record.notes) bits.push(record.notes.split(/[.\n]/)[0].trim().slice(0, 40));
		return bits.length ? bits.join(' · ') : record.reference;
	}
	return record.reference;
}
