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
import { criticalMissing, listTripsForWork } from '$lib/server/trips';

type Row = {
	kind: 'enquiry' | 'quotation' | 'booking' | 'order';
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
					br.updated_at, null::text as converted_booking_id, null::text as active_request_status
				from booking_requests br
				left join customers cu on cu.id = br.customer_id
				where br.tenant_id = ${viewer.tenantId}::uuid
					and br.deleted_at is null
					and br.status in ('NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED')
				union all
				select 'quotation', q.id::text, q.reference, q.status::text, q.total::text, '0', q.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					q.updated_at, q.converted_booking_id::text, null
				from quotations q
				left join customers cu on cu.id = q.customer_id
				where q.tenant_id = ${viewer.tenantId}::uuid and q.status in ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED')
				union all
				select 'booking', b.id::text, b.booking_reference, b.status::text, b.total::text, b.amount_paid::text, b.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					b.updated_at, null,
					(select pr.status::text from payment_requests pr
						where pr.booking_id = b.id and pr.status in ('REQUESTED', 'REPORTED', 'PARTIALLY_PAID')
						order by pr.created_at desc limit 1)
				from bookings b
				left join customers cu on cu.id = b.customer_id
				where b.tenant_id = ${viewer.tenantId}::uuid
					and b.deleted_at is null
					and b.status not in ('COMPLETED', 'CANCELLED', 'REFUNDED')
					-- A booking with a LIVE trip has nothing left to ask for here; its trip
					-- is in this same list and owns what happens next. Once that trip is
					-- finished or stood down the booking must come back, or a balance
					-- still owed on a completed trip would never be chased again.
					and not exists (
						select 1 from trips tx
						where tx.booking_id = b.id and tx.status in ('PREPARING', 'READY', 'IN_PROGRESS')
					)
				union all
				select 'order', o.id::text, o.order_number, o.status::text, o.total::text, o.amount_paid::text, o.currency,
					trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')),
					o.updated_at, null,
					(select pr.status::text from payment_requests pr
						where pr.order_id = o.id and pr.status in ('REQUESTED', 'REPORTED', 'PARTIALLY_PAID')
						order by pr.created_at desc limit 1)
				from orders o
				left join customers cu on cu.id = o.customer_id
				where o.tenant_id = ${viewer.tenantId}::uuid
					and o.status not in ('DELIVERED', 'CANCELLED', 'REFUNDED')

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
		const MODULE = { enquiry: 'enquiries', quotation: 'quotations', booking: 'bookings', order: 'orders' } as const;
		const outstanding = (r: Row) => Math.max(0, Number(r.total) - Number(r.amount_paid));
		const hasQuotationFor = new Set(rows.filter((r) => r.kind === 'quotation').map((r) => r.customer_name));

		const items = rows
			.filter((r) => moduleRelevant(workspace, MODULE[r.kind]))
			.filter((r) => can(`${r.kind === 'enquiry' ? 'booking_requests' : r.kind + 's'}:read`))
			.map((r) => {
				const next =
					r.kind === 'order'
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
					missingCritical: null as number | null,
					daysToDeparture: null as number | null,
					next: next ? { key: next.key, label: next.label, hint: next.hint ?? null } : null
				};
			});

		// Trips come from their own query rather than the union, because their
		// readiness is decided by CHECKS in trips.ts and restating those rules in
		// SQL is how the phone and the portal end up disagreeing. One extra query
		// buys one definition of "can this leave".
		const tripItems =
			can('trips:read') && moduleRelevant(workspace, 'trips')
				? (await listTripsForWork(viewer.tenantId)).map((row) => {
						const missing = criticalMissing(row.trip, row.booking);
						const next = nextForTrip(
							{
								id: row.trip.id,
								status: row.trip.status,
								missingCritical: missing,
								daysToDeparture: row.daysToDeparture
							},
							ability
						);
						// A trip is read by more people than a booking is. Whoever can see
						// trips learns THAT money is owed, because a balance before
						// departure is operational; they do not learn the sale's pricing
						// unless they may read bookings.
						const outstandingNow = Math.max(0, Number(row.booking.total) - Number(row.booking.amountPaid));
						const commercial = can('bookings:read');
						return {
							kind: 'trip' as const,
							id: row.trip.id,
							reference: row.trip.tripReference,
							status: row.trip.status,
							statusLabel: statusLabel(row.trip.status),
							customer: row.customerName,
							total: commercial ? row.booking.total : null,
							outstanding: commercial ? outstandingNow.toFixed(2) : null,
							hasBalance: outstandingNow > 0,
							currency: row.booking.currency,
							updatedAt: row.trip.updatedAt.toISOString(),
							missingCritical: missing,
							daysToDeparture: row.daysToDeparture,
							next: next ? { key: next.key, label: next.label, hint: next.hint ?? null } : null
						};
					})
				: [];

		const merged = [...items, ...tripItems].sort(
			(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
		);

		return ok({ workspace, items: merged });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
