import { bookingRequestStats } from '$lib/server/booking-requests';
import { requireTenant } from '$lib/server/guards';
import { dismissOnboarding, onboardingState } from '$lib/server/onboarding';
import type { Actions } from './$types';
import { bookingStats } from '$lib/server/bookings';
import { customerStats } from '$lib/server/customers';
import { paymentStats } from '$lib/server/payments';
import { listConversations } from '$lib/server/conversations';
import { listBookingRequests } from '$lib/server/booking-requests';
import { getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/** Daily activity for the overview chart: enquiries in, messages exchanged. */
async function dailySeries(tenantId: string) {
	const rows = (await db().execute(sql`
		with days as (select generate_series(current_date - 13, current_date, '1 day')::date as day)
		select to_char(d.day, 'DD Mon') as label,
			(select count(*)::int from booking_requests br where br.tenant_id = ${tenantId}::uuid and br.created_at::date = d.day) as requests,
			(select count(*)::int from messages m where m.tenant_id = ${tenantId}::uuid and m.created_at::date = d.day) as messages
		from days d order by d.day
	`)) as unknown as Array<{ label: string; requests: number; messages: number }>;
	return {
		labels: rows.map((r) => r.label),
		requests: rows.map((r) => Number(r.requests)),
		messages: rows.map((r) => Number(r.messages))
	};
}

/** "Needs your attention" + "Today", in one query — the header of the working day. */
async function actionCentre(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			(select count(*)::int from booking_requests r where r.tenant_id = ${tenantId}::uuid and r.status = 'NEW') as new_enquiries,
			(select count(*)::int from orders o where o.tenant_id = ${tenantId}::uuid and o.status = 'PENDING_CONFIRMATION') as orders_to_confirm,
			(select count(*)::int from orders o where o.tenant_id = ${tenantId}::uuid and o.status = 'READY') as orders_ready,
			(select count(*)::int from bookings b where b.tenant_id = ${tenantId}::uuid and b.status = 'AWAITING_PAYMENT') as bookings_unpaid,
			(select count(*)::int from quotations q where q.tenant_id = ${tenantId}::uuid and q.status = 'SENT') as quotes_waiting,
			(select count(*)::int from conversations c where c.tenant_id = ${tenantId}::uuid and c.unread_count > 0) as unread_chats,
			(select count(*)::int from payment_requests pr where pr.tenant_id = ${tenantId}::uuid and pr.status = 'REPORTED') as payments_reported,
			(select count(*)::int from conversations c where c.tenant_id = ${tenantId}::uuid and c.created_at::date = current_date) as chats_today,
			(select count(*)::int from orders o where o.tenant_id = ${tenantId}::uuid and o.created_at::date = current_date) as orders_today,
			(select count(*)::int from booking_requests r where r.tenant_id = ${tenantId}::uuid and r.created_at::date = current_date) as enquiries_today,
			(select coalesce(sum(p.amount), 0)::numeric(14,2) from payments p
				where p.tenant_id = ${tenantId}::uuid and p.status = 'SUCCEEDED' and p.created_at::date = current_date) as received_today,
			(select ob.id::text from order_batches ob
				where ob.tenant_id = ${tenantId}::uuid and ob.status = 'OPEN'
				order by ob.fulfilment_date asc nulls last, ob.created_at desc limit 1) as open_batch_id,
			(select ob.name from order_batches ob
				where ob.tenant_id = ${tenantId}::uuid and ob.status = 'OPEN'
				order by ob.fulfilment_date asc nulls last, ob.created_at desc limit 1) as open_batch_name
	`)) as unknown as Array<Record<string, unknown>>;
	return rows[0] ?? {};
}

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenant(locals).id;
	const pagination = { page: 1, limit: 8, order: 'desc' as const };

	const [requests, bookings, customers, payments, recent, inbox, connection, activity, centre] = await Promise.all([
		bookingRequestStats(tenantId),
		bookingStats(tenantId),
		customerStats(tenantId),
		paymentStats(tenantId),
		listBookingRequests(tenantId, pagination),
		listConversations(tenantId, pagination, { open: true }, { userId: locals.user!.id, permissions: locals.permissions }),
		getConnectionForTenant(tenantId),
		dailySeries(tenantId),
		actionCentre(tenantId)
	]);

	const onboarding = await onboardingState(tenantId);

	return {
		centre,
		stats: { requests, bookings, customers, payments },
		recentRequests: recent.items,
		inbox: inbox.items,
		whatsapp: connection ? toSafeConnection(connection) : null,
		activity,
		// Hidden once dismissed or finished — a checklist that never goes away is nagging.
		onboarding: onboarding.dismissed || onboarding.allDone ? null : onboarding
	};
};

export const actions: Actions = {
	dismissOnboarding: async ({ locals }) => {
		await dismissOnboarding(requireTenant(locals).id);
		return { dismissed: true };
	}
};
