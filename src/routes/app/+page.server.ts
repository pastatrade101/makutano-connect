import { attentionFor, continueWorking } from '$lib/server/attention';
import { normalizeWorkspace } from '$lib/workspace';
import { bookingRequestStats } from '$lib/server/booking-requests';
import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant } from '$lib/server/guards';
import { dismissOnboarding, markSystemSourceInternal, onboardingState } from '$lib/server/onboarding';
import type { Actions } from './$types';
import { bookingStats } from '$lib/server/bookings';
import { customerStats } from '$lib/server/customers';
import { paymentStats } from '$lib/server/payments';
import { listConversations } from '$lib/server/conversations';
import { listBookingRequests } from '$lib/server/booking-requests';
import { getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { db, schema } from '$lib/server/db';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { env } from '$lib/server/env';
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
			(select count(*)::int from booking_requests r where r.tenant_id = ${tenantId}::uuid) as enquiries_total,
			(select count(*)::int from orders o where o.tenant_id = ${tenantId}::uuid) as orders_total,
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

/**
 * The marketplace, from this operator's side.
 *
 * Connect is one product with a traveller's half and an operator's half, and the
 * dashboard used to show only the second — orders, batches, payments — as though
 * the listings that produce all of it were somewhere else. This is the chain the
 * whole system is built on, counted once:
 *
 *   listings → enquiries → quotations → bookings
 *
 * One query rather than five round trips, because it renders above the fold.
 */
async function marketplaceState(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			(select count(*)::int from tours t
				where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null and t.status = 'PUBLISHED') as live_tours,
			(select count(*)::int from tours t
				where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null
					and t.status in ('SUBMITTED', 'IN_REVIEW', 'APPROVED')) as tours_in_review,
			-- What is waiting on the OPERATOR, which is a different queue from what
			-- is waiting on the platform. Only one of the two is theirs to clear.
			(select count(*)::int from tours t
				where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null
					and t.status in ('DRAFT', 'CHANGES_REQUESTED')) as tours_need_you,
			(select count(*)::int from tours t
				where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null) as tours_total,
			(select count(*)::int from booking_requests br
				where br.tenant_id = ${tenantId}::uuid and br.deleted_at is null
					and br.source = 'MARKETPLACE') as marketplace_enquiries,
			(select count(*)::int from booking_requests br
				where br.tenant_id = ${tenantId}::uuid and br.deleted_at is null
					and br.status in ('NEW', 'UNDER_REVIEW', 'CONTACTED')) as enquiries_open,
			(select count(*)::int from quotations q
				where q.tenant_id = ${tenantId}::uuid and q.deleted_at is null
					and q.status in ('DRAFT', 'SENT', 'VIEWED')) as quotations_open,
			(select count(*)::int from bookings b
				where b.tenant_id = ${tenantId}::uuid and b.deleted_at is null
					and b.status not in ('CANCELLED', 'REFUNDED')) as bookings_live,
			(select count(*)::int from tour_accommodations ta
				join tours t on t.id = ta.tour_id
				where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null) as stays_attached
	`)) as unknown as Array<Record<string, unknown>>;

	const operatorLogo = alias(schema.media, 'dash_operator_logo');
	const [operator] = await db()
		.select({
			name: schema.operatorProfiles.displayName,
			slug: schema.operatorProfiles.slug,
			location: schema.operatorProfiles.location,
			verified: schema.operatorProfiles.isVerified,
			logoUrl: operatorLogo.url
		})
		.from(schema.operatorProfiles)
		.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
		.where(eq(schema.operatorProfiles.tenantId, tenantId))
		.limit(1);

	const marketplace = env().MARKETPLACE_URL.replace(/\/+$/, '');
	return {
		counts: rows[0] ?? {},
		operator: operator
			? { ...operator, publicUrl: `${marketplace}/operators/${operator.slug}` }
			: null,
		marketplaceUrl: marketplace
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenant(locals).id;
	const pagination = { page: 1, limit: 8, order: 'desc' as const };

	const viewer = { userId: locals.user!.id, permissions: locals.permissions };
	const workspace = normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities);

	const [
		requests,
		bookings,
		customers,
		payments,
		recent,
		inbox,
		connection,
		activity,
		centre,
		attention,
		continuing,
		marketplace
	] = await Promise.all([
			bookingRequestStats(tenantId),
			bookingStats(tenantId),
			customerStats(tenantId),
			paymentStats(tenantId),
			listBookingRequests(tenantId, pagination),
			listConversations(
				tenantId,
				pagination,
				{ open: true },
				{ userId: locals.user!.id, permissions: locals.permissions }
			),
			getConnectionForTenant(tenantId),
			dailySeries(tenantId),
			actionCentre(tenantId),
			// Who is looking, and what is waiting for THEM — visibility-scoped on the server.
			attentionFor(tenantId, viewer, workspace),
			// Where each customer actually stands, not a second copy of the inbox.
			continueWorking(tenantId, viewer, workspace),
			marketplaceState(tenantId)
		]);

	// Built for the person looking, not just the tenant: an item they could never
	// action is not offered to them.
	const onboarding = await onboardingState(tenantId, locals.permissions);

	return {
		marketplace,
		centre,
		attention: attention.items,
		context: attention.context,
		persona: attention.persona,
		today: attention.today,
		continueWorking: continuing,
		stats: { requests, bookings, customers, payments },
		recentRequests: recent.items,
		inbox: inbox.items,
		whatsapp: connection ? toSafeConnection(connection) : null,
		activity,
		// Hidden once dismissed or finished — a checklist that never goes away is nagging.
		onboarding: onboarding.dismissed || onboarding.allDone ? null : onboarding,
		canEditSettings: locals.permissions.includes('tenant:write')
	};
};

export const actions: Actions = {
	dismissOnboarding: async ({ locals }) => {
		await dismissOnboarding(requireTenant(locals).id);
		return { dismissed: true };
	},

	/**
	 * "We do not use an outside system."
	 *
	 * Clears the integration row by correcting the signup answer behind it, rather
	 * than by pretending an API key exists. Needs settings:write, because it edits
	 * a tenant setting — the same bar as changing it anywhere else would be.
	 */
	systemSourceInternal: async ({ locals }) => {
		requirePermission(locals.permissions, 'tenant:write');
		await markSystemSourceInternal(requireTenant(locals).id);
		return { systemSourceCleared: true };
	}
};
