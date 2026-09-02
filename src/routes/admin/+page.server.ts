// The marketplace at a glance, for the person who owns it.
//
// This page used to be twenty-five equal-weight counters. Measured against production,
// ten of them were permanently zero and one was actively wrong — it reported "0 active"
// tenants because it counted status='ACTIVE' while every real customer is TRIAL. A wall
// of boxes where half say nothing is not a dashboard; it is a place to look busy.
//
// What replaced it is the loop the business actually runs on (docs/PRODUCT.md):
//
//   enquiry -> quote -> booking -> payment -> trip -> review
//
// plus the two questions the owner opens this page to answer — is a traveller waiting on
// somebody, and is anything waiting on ME — and the operators behind it. Infrastructure is
// a footnote that only speaks up when it is broken.
//
// ZERO POLICY. A zero earns its place only when it has a denominator or a name against it.
// "0 reviews from 6 bookings" is the most important thing on the page. "0 dead jobs" is not
// a fact worth a box, so it collapses into one healthy strip.
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** A traveller who has heard nothing for this long is the platform's problem too. */
const STALE_ENQUIRY_HOURS = 24;

export const load: PageServerLoad = async () => {
	const [row] = (await db().execute(sql`
		select
			/* ---- the loop, end to end ---- */
			(select count(*) from booking_requests where deleted_at is null)::int as enquiries,
			(select count(*) from quotations where deleted_at is null)::int as quotes,
			(select count(*) from bookings where deleted_at is null)::int as bookings,
			/* Anchored to a LIVE booking on purpose. Counting payments on their own let
			   this stage exceed the one before it — every succeeded payment here belongs
			   to a soft-deleted booking, so the loop read "1 booking, 3 paid" and the
			   conversion rendered as 300%. A funnel whose stages are not nested is not a
			   funnel. */
			(select count(*) from payments p where p.status = 'SUCCEEDED'
			   and exists (select 1 from bookings b where b.id = p.booking_id and b.deleted_at is null))::int as payments,
			(select count(*) from trips)::int as trips,
			(select count(*) from reviews where status = 'PUBLISHED')::int as reviews,

			/* ---- is a traveller waiting on an operator? ---- */
			(select count(*) from booking_requests
			  where status = 'NEW' and deleted_at is null)::int as unanswered,
			(select count(*) from booking_requests
			  where status = 'NEW' and deleted_at is null
			    and created_at < now() - interval '${sql.raw(String(STALE_ENQUIRY_HOURS))} hours')::int as unanswered_stale,
			(select round(max(extract(epoch from (now() - created_at)) / 86400)::numeric, 0)
			   from booking_requests where status = 'NEW' and deleted_at is null)::int as oldest_unanswered_days,

			/* ---- demand, with a direction rather than a level ---- */
			(select count(*) from booking_requests
			  where deleted_at is null and created_at > now() - interval '7 days')::int as enquiries_7d,
			(select count(*) from booking_requests
			  where deleted_at is null
			    and created_at between now() - interval '14 days' and now() - interval '7 days')::int as enquiries_prev_7d,

			/* ---- what is waiting on the PLATFORM ---- */
			(select count(*) from tours
			  where status in ('SUBMITTED','IN_REVIEW') and deleted_at is null)::int as tours_awaiting,
			/* APPROVED is a PLATFORM queue, not a finished state.
			   publish goes from APPROVED and is platform-only (tours.ts), so an approved
			   listing is one the owner has said yes to and not yet put in front of
			   anybody. Counting only SUBMITTED made this page announce "nothing is
			   waiting on you" while seventeen listings sat approved and invisible. */
			(select count(*) from tours where status = 'APPROVED' and deleted_at is null)::int as tours_ready,
			(select min(reviewed_at) from tours where status = 'APPROVED' and deleted_at is null) as tours_ready_since,
			(select count(*) from reviews where status = 'PENDING')::int as reviews_pending,
			(select count(*) from operator_profiles where is_active and not is_verified)::int as operators_awaiting,
			/* The platform's own service level: hours from submission to a decision. The
			   one number on this page that nobody else can move. */
			(select round(avg(extract(epoch from (reviewed_at - submitted_at)) / 3600)::numeric, 1)
			   from tours where reviewed_at is not null and submitted_at is not null and deleted_at is null)
			   as review_hours_avg,

			/* ---- supply ---- */
			(select count(*) from tours where status = 'PUBLISHED' and deleted_at is null)::int as tours_live,
			(select count(*) from destinations where status = 'PUBLISHED')::int as destinations,
			/* A destination page with nothing on it is a page the marketplace is selling
			   and cannot fulfil — the clearest supply gap there is. */
			(select count(*) from destinations d where d.status = 'PUBLISHED'
			   and exists (select 1 from tour_destinations td join tours t on t.id = td.tour_id
			     where td.destination_id = d.id and t.status = 'PUBLISHED' and t.deleted_at is null)
			)::int as destinations_stocked,

			/* ---- customers. TRIAL counts: it is where every real one currently is ---- */
			(select count(*) from tenants where deleted_at is null and status in ('ACTIVE','TRIAL'))::int as customers,
			(select count(*) from tenants where deleted_at is null and status = 'SUSPENDED')::int as suspended,

			/* ---- the footnote: only speaks up when broken ---- */
			(select count(*) from jobs where status = 'DEAD')::int as jobs_dead,
			(select count(*) from webhook_deliveries where status = 'DEAD')::int as webhooks_dead,
			(select count(*) from payments where status = 'FAILED')::int as payments_failed,
			(select count(*) from whatsapp_connections where status in ('ERROR','REAUTH_REQUIRED'))::int as connections_unhealthy
		// One of these columns is a timestamp (the oldest approved listing), so the row
		// is not the all-numbers shape the rest of it looks like.
	`)) as unknown as Array<Record<string, number | string | Date | null>>;

	const n = (k: string) => Number(row?.[k] ?? 0);
	const at = (k: string) => (row?.[k] as string | Date | null) ?? null;

	/*
	 * Every operator, and how far each has actually got.
	 *
	 * The per-tour numbers hide the thing that matters: an operator with fifteen live
	 * listings and no enquiries has a discovery problem, and one with none published has
	 * never started. Both are invisible in a marketplace-wide total.
	 */
	const operators = (await db().execute(sql`
		select t.id, t.name, t.status,
			coalesce(p.is_verified, false) as verified,
			(select count(*) from tours x where x.tenant_id = t.id and x.status = 'PUBLISHED' and x.deleted_at is null)::int as live,
			(select count(*) from tours x where x.tenant_id = t.id and x.status in ('SUBMITTED','IN_REVIEW') and x.deleted_at is null)::int as awaiting,
			(select count(*) from booking_requests b where b.tenant_id = t.id and b.deleted_at is null)::int as enquiries,
			(select count(*) from bookings b where b.tenant_id = t.id and b.deleted_at is null)::int as bookings
		from tenants t
		left join operator_profiles p on p.tenant_id = t.id
		where t.deleted_at is null
		order by live desc, enquiries desc, t.name
	`)) as unknown as Array<Record<string, string | number | boolean>>;

	const enquiries7d = n('enquiries_7d');
	const prev7d = n('enquiries_prev_7d');

	return {
		loop: [
			{ stage: 'Enquiries', value: n('enquiries'), href: null },
			{ stage: 'Quotes', value: n('quotes'), href: null },
			{ stage: 'Bookings', value: n('bookings'), href: null },
			{ stage: 'Paid', value: n('payments'), href: null },
			{ stage: 'Trips', value: n('trips'), href: null },
			{ stage: 'Reviews', value: n('reviews'), href: '/admin/reviews' }
		],
		demand: {
			last7: enquiries7d,
			prev7: prev7d,
			// Only a real comparison. A percentage against zero is arithmetic theatre.
			changePct: prev7d > 0 ? Math.round(((enquiries7d - prev7d) / prev7d) * 100) : null
		},
		waiting: {
			unanswered: n('unanswered'),
			unansweredStale: n('unanswered_stale'),
			oldestDays: n('oldest_unanswered_days'),
			staleAfterHours: STALE_ENQUIRY_HOURS,
			toursAwaiting: n('tours_awaiting'),
			toursReady: n('tours_ready'),
			toursReadySince: at('tours_ready_since'),
			reviewsPending: n('reviews_pending'),
			operatorsAwaiting: n('operators_awaiting'),
			reviewHoursAvg: row?.review_hours_avg == null ? null : Number(row.review_hours_avg)
		},
		supply: {
			toursLive: n('tours_live'),
			destinations: n('destinations'),
			destinationsStocked: n('destinations_stocked'),
			customers: n('customers'),
			suspended: n('suspended')
		},
		operators: operators.map((o) => ({
			id: String(o.id),
			name: String(o.name),
			status: String(o.status),
			verified: Boolean(o.verified),
			live: Number(o.live),
			awaiting: Number(o.awaiting),
			enquiries: Number(o.enquiries),
			bookings: Number(o.bookings)
		})),
		infrastructure: [
			{ label: 'Dead jobs', value: n('jobs_dead'), href: '/admin/errors' },
			{ label: 'Dead webhooks', value: n('webhooks_dead'), href: '/admin/errors' },
			{ label: 'Failed payments', value: n('payments_failed'), href: '/admin/errors' },
			{ label: 'WhatsApp needing re-auth', value: n('connections_unhealthy'), href: '/admin/whatsapp' }
		]
	};
};
