// Global search (§28): the phone rings, the merchant types a name or number, the
// record appears. Plain indexed ILIKE over the tenant's own rows — no search
// infrastructure, and every query is tenant-scoped by construction.
import { sql } from 'drizzle-orm';
import { requireTenant } from '$lib/server/guards';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export type SearchHit = {
	kind: 'customer' | 'order' | 'booking' | 'request' | 'quotation';
	id: string;
	title: string;
	subtitle: string | null;
	status: string | null;
	href: string;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenant(locals).id;
	const q = url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
	if (q.length < 2) return { q, hits: [] as SearchHit[] };

	const term = `%${q}%`;
	const digits = q.replace(/\D/g, '');
	const phoneTerm = digits.length >= 3 ? `%${digits}%` : null;

	const rows = (await db().execute(sql`
		select * from (
			select 'customer' as kind, c.id::text,
				coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), c.whatsapp_phone, 'Customer') as title,
				coalesce('+' || c.whatsapp_phone, c.email) as subtitle, null as status, c.updated_at as at
			from customers c
			where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and (
				(c.first_name || ' ' || c.last_name) ilike ${term}
				or c.email ilike ${term}
				or (${phoneTerm}::text is not null and (c.whatsapp_phone like ${phoneTerm} or c.phone like ${phoneTerm}))
			)
			union all
			select 'order', o.id::text, o.order_number,
				(select coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), null) from customers c where c.id = o.customer_id),
				o.status::text, o.created_at
			from orders o
			where o.tenant_id = ${tenantId}::uuid and o.order_number ilike ${term}
			union all
			select 'booking', b.id::text, b.booking_reference,
				(select coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), null) from customers c where c.id = b.customer_id),
				b.status::text, b.created_at
			from bookings b
			where b.tenant_id = ${tenantId}::uuid and b.booking_reference ilike ${term}
			union all
			select 'request', r.id::text, r.reference,
				(select coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), null) from customers c where c.id = r.customer_id),
				r.status::text, r.created_at
			from booking_requests r
			where r.tenant_id = ${tenantId}::uuid and r.reference ilike ${term}
			union all
			select 'quotation', qt.id::text, qt.reference,
				(select coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), null) from customers c where c.id = qt.customer_id),
				qt.status::text, qt.created_at
			from quotations qt
			where qt.tenant_id = ${tenantId}::uuid and qt.reference ilike ${term}
		) t
		order by at desc
		limit 30
	`)) as unknown as Array<{ kind: SearchHit['kind']; id: string; title: string; subtitle: string | null; status: string | null }>;

	const HREF: Record<SearchHit['kind'], (id: string) => string> = {
		customer: () => `/app/customers`,
		order: (id) => `/app/orders/${id}`,
		booking: (id) => `/app/bookings/${id}`,
		request: (id) => `/app/booking-requests/${id}`,
		quotation: (id) => `/app/quotations/${id}`
	};

	return {
		q,
		hits: rows.map((r) => ({ ...r, href: HREF[r.kind](r.id) }) as SearchHit)
	};
};
