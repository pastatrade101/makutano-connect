// The lifecycle objects this person actually works on, each carrying the next step.
//
// One union, workspace-filtered and permission-filtered, with the shared next-action
// resolver applied server-side — so the phone never has to know Connect's structure
// or reimplement the precedence the portal uses.
import type { RequestHandler } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import { nextForBooking, nextForEnquiry, nextForOrder, nextForQuotation, nextForTrip } from '$lib/next-action';
import { statusLabel } from '$lib/labels';
import { ok, problem, requireViewer } from '$lib/server/mobile';

type Row = {
	kind: 'enquiry' | 'quotation' | 'booking' | 'order' | 'trip';
	id: string;
	reference: string;
	status: string;
	total: string;
	amount_paid: string;
	currency: string;
	customer_name: string | null;
	updated_at: string;
	converted_booking_id: string | null;
	active_request_status: string | null;
	/** Trips only: critical setup still outstanding, and days until departure. */
	missing_critical: number | null;
	days_to_departure: number | null;
};

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const workspace = normalizeWorkspace((event.locals.tenant?.settings as Record<string, unknown>)?.capabilities);
		const can = (p: string) => viewer.permissions.includes(p);

		const rows = (await db().execute(sql`
			select * from (
				select 'enquiry' as kind, br.id::text, br.reference, br.status::text,
					coalesce(br.estimated_total::text, '0') as total, '0' as amount_paid, br.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')) as customer_name,
					br.updated_at, null::text as converted_booking_id, null::text as active_request_status,
					null::int as missing_critical, null::int as days_to_departure
				from booking_requests br
				left join customers cu on cu.id = br.customer_id
				where br.tenant_id = ${viewer.tenantId}::uuid
					and br.status in ('NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED')
				union all
				select 'quotation', q.id::text, q.reference, q.status::text, q.total::text, '0', q.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					q.updated_at, q.converted_booking_id::text, null, null, null
				from quotations q
				left join customers cu on cu.id = q.customer_id
				where q.tenant_id = ${viewer.tenantId}::uuid and q.status in ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED')
				union all
				select 'booking', b.id::text, b.booking_reference, b.status::text, b.total::text, b.amount_paid::text, b.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					b.updated_at, null,
					(select pr.status::text from payment_requests pr
						where pr.booking_id = b.id and pr.status in ('REQUESTED', 'REPORTED', 'PARTIALLY_PAID')
						order by pr.created_at desc limit 1), null, null
				from bookings b
				left join customers cu on cu.id = b.customer_id
				where b.tenant_id = ${viewer.tenantId}::uuid
					and b.status not in ('COMPLETED', 'CANCELLED', 'REFUNDED')
					-- A booking already handed over has nothing left to ask for here;
					-- its trip is in this same list and owns what happens next.
					and not exists (select 1 from trips tx where tx.booking_id = b.id)
				union all
				select 'order', o.id::text, o.order_number, o.status::text, o.total::text, o.amount_paid::text, o.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					o.updated_at, null,
					(select pr.status::text from payment_requests pr
						where pr.order_id = o.id and pr.status in ('REQUESTED', 'REPORTED', 'PARTIALLY_PAID')
						order by pr.created_at desc limit 1), null, null
				from orders o
				left join customers cu on cu.id = o.customer_id
				where o.tenant_id = ${viewer.tenantId}::uuid
					and o.status not in ('DELIVERED', 'CANCELLED', 'REFUNDED')
				union all
				-- Trips carry no money of their own, so the commercial columns come
				-- from the booking behind them: the phone shows an outstanding
				-- balance on a trip without the trip ever owning that number.
				--
				-- The critical-check count is computed HERE rather than by loading
				-- every trip's detail, because this endpoint is one query by design.
				-- It must stay in step with readinessFor() in trips.ts — the checks
				-- flagged critical there are the ones counted here.
				select 'trip', tr.id::text, tr.trip_reference, tr.status::text,
					coalesce(b.total::text, '0'), coalesce(b.amount_paid::text, '0'), coalesce(b.currency, 'USD'),
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					tr.updated_at, null, null,
					(case when b.status in ('CONFIRMED','IN_PROGRESS','COMPLETED') then 0 else 1 end
					 + case when coalesce(b.amount_paid, 0) > 0 then 0 else 1 end
					 + case when tr.start_date is not null then 0 else 1 end
					 + case when nullif(trim(coalesce(tr.accommodation, '')), '') is not null then 0 else 1 end
					 + case when nullif(trim(coalesce(tr.vehicle, '')), '') is not null then 0 else 1 end
					 + case when nullif(trim(coalesce(tr.driver, '')), '') is not null then 0 else 1 end),
					(case when tr.start_date is null then null
						else (tr.start_date::date - current_date) end)
				from trips tr
				join bookings b on b.id = tr.booking_id
				left join customers cu on cu.id = tr.customer_id
				where tr.tenant_id = ${viewer.tenantId}::uuid
					and tr.status not in ('COMPLETED', 'CANCELLED')
			) t
			order by updated_at desc
			limit 60
		`)) as unknown as Row[];

		const ability = {
			orders: can('orders:write'),
			payments: can('payments:write'),
			verifyPayments: can('payments:verify'),
			quotations: can('quotations:write'),
			bookings: can('bookings:read'),
			bookingsWrite: can('bookings:write'),
			trips: can('trips:read'),
			tripsWrite: can('trips:write')
		};
		const MODULE = {
			enquiry: 'enquiries',
			quotation: 'quotations',
			booking: 'bookings',
			order: 'orders',
			trip: 'trips'
		} as const;
		const outstanding = (r: Row) => Math.max(0, Number(r.total) - Number(r.amount_paid));
		const hasQuotationFor = new Set(rows.filter((r) => r.kind === 'quotation').map((r) => r.customer_name));

		const items = rows
			.filter((r) => moduleRelevant(workspace, MODULE[r.kind]))
			.filter((r) => can(`${r.kind === 'enquiry' ? 'booking_requests' : r.kind + 's'}:read`))
			.map((r) => {
				const next =
					r.kind === 'trip'
						? nextForTrip(
								{
									id: r.id,
									status: r.status,
									missingCritical: r.missing_critical ?? 0,
									daysToDeparture: r.days_to_departure
								},
								ability
							)
						: r.kind === 'order'
						? nextForOrder(
								{
									id: r.id,
									status: r.status,
									outstanding: outstanding(r),
									activeRequestStatus: r.active_request_status
								},
								ability
							)
						: r.kind === 'booking'
							? nextForBooking(
									{
										id: r.id,
										status: r.status,
										outstanding: outstanding(r),
										activeRequestStatus: r.active_request_status
									},
									ability
								)
							: r.kind === 'quotation'
								? nextForQuotation({ id: r.id, status: r.status, convertedBookingId: r.converted_booking_id }, ability)
								: nextForEnquiry(
										{ id: r.id, status: r.status, hasQuotation: hasQuotationFor.has(r.customer_name) },
										ability
									);
				return {
					kind: r.kind,
					id: r.id,
					reference: r.reference,
					status: r.status,
					statusLabel: statusLabel(r.status),
					customer: (r.customer_name ?? '').trim() || null,
					total: r.total,
					outstanding: outstanding(r).toFixed(2),
					currency: r.currency,
					updatedAt: r.updated_at,
					// Only trips carry these; the phone uses them for the readiness pill.
					missingCritical: r.missing_critical,
					daysToDeparture: r.days_to_departure,
					next: next ? { key: next.key, label: next.label, hint: next.hint ?? null } : null
				};
			});

		return ok({ workspace, items });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
