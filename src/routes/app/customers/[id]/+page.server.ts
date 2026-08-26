// One customer, one story. Everything this page shows already existed in Connect —
// it was just spread across six lists, so nobody could see a relationship, only rows.
//
// Cost discipline: five bounded queries, never one per record. The transactional
// records arrive in a single union so adding a kind never adds a round trip.
import { error, fail, type Actions } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { getCustomer, updateCustomer } from '$lib/server/customers';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'customer id');

export type CustomerRecord = {
	kind: 'enquiry' | 'quotation' | 'booking' | 'order';
	id: string;
	reference: string;
	status: string;
	total: string;
	amount_paid: string;
	currency: string;
	created_at: string;
	updated_at: string;
	converted_booking_id: string | null;
};

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'customers:read');
	const tenantId = requireTenant(locals).id;
	const customerId = idOf(params);

	let customer;
	try {
		customer = await getCustomer(tenantId, customerId);
	} catch {
		error(404, 'Customer not found');
	}

	const [records, conversations, requests, payments] = await Promise.all([
		// Everything they have transacted, newest first, in one round trip.
		db().execute(sql`
			select * from (
				select 'enquiry' as kind, br.id::text, br.reference, br.status::text,
					coalesce(br.estimated_total::text, '0') as total, '0' as amount_paid, br.currency,
					br.created_at, br.updated_at, null::text as converted_booking_id
				from booking_requests br
				where br.tenant_id = ${tenantId}::uuid and br.customer_id = ${customerId}::uuid
				union all
				select 'quotation', q.id::text, q.reference, q.status::text, q.total::text, '0', q.currency,
					q.created_at, q.updated_at, q.converted_booking_id::text
				from quotations q
				where q.tenant_id = ${tenantId}::uuid and q.customer_id = ${customerId}::uuid
				union all
				select 'booking', b.id::text, b.booking_reference, b.status::text, b.total::text, b.amount_paid::text, b.currency,
					b.created_at, b.updated_at, null::text
				from bookings b
				where b.tenant_id = ${tenantId}::uuid and b.customer_id = ${customerId}::uuid
				union all
				select 'order', o.id::text, o.order_number, o.status::text, o.total::text, o.amount_paid::text, o.currency,
					o.created_at, o.updated_at, null::text
				from orders o
				where o.tenant_id = ${tenantId}::uuid and o.customer_id = ${customerId}::uuid
			) t
			order by updated_at desc
			limit 24
		`) as unknown as Promise<CustomerRecord[]>,

		db()
			.select({
				id: schema.conversations.id,
				channel: schema.conversations.channel,
				unreadCount: schema.conversations.unreadCount,
				lastMessageAt: schema.conversations.lastMessageAt,
				assignedToUserId: schema.conversations.assignedToUserId
			})
			.from(schema.conversations)
			.where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.customerId, customerId)))
			.orderBy(desc(schema.conversations.lastMessageAt))
			.limit(5),

		db()
			.select({
				id: schema.paymentRequests.id,
				status: schema.paymentRequests.status,
				amountRequested: schema.paymentRequests.amountRequested,
				amountReceived: schema.paymentRequests.amountReceived,
				currency: schema.paymentRequests.currency,
				orderId: schema.paymentRequests.orderId,
				bookingId: schema.paymentRequests.bookingId,
				createdAt: schema.paymentRequests.createdAt,
				reportedAt: schema.paymentRequests.reportedAt
			})
			.from(schema.paymentRequests)
			.where(and(eq(schema.paymentRequests.tenantId, tenantId), eq(schema.paymentRequests.customerId, customerId)))
			.orderBy(desc(schema.paymentRequests.createdAt))
			.limit(10),

		db()
			.select({
				id: schema.payments.id,
				amount: schema.payments.amount,
				currency: schema.payments.currency,
				status: schema.payments.status,
				provider: schema.payments.provider,
				createdAt: schema.payments.createdAt
			})
			.from(schema.payments)
			.where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.customerId, customerId)))
			.orderBy(desc(schema.payments.createdAt))
			.limit(5)
	]);

	return { customer, records, conversations, requests, payments };
};

export const actions: Actions = {
	/** Notes are the one thing staff write here; everything else happens on the record. */
	note: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'customers:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		try {
			await updateCustomer(tenantId, idOf(params), { notes: String(data.get('notes') ?? '').trim() || null });
			return { success: true, notice: 'Note saved' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
