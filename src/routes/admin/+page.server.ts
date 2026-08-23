// §21 System Health — the platform at a glance. Extended to cover the domains added
// since: orders, hosted forms, entitlement overrides, suspensions and tenants running
// out of allowance (the things an operator must act on before a customer complains).
import { sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { approachingLimits } from '$lib/server/entitlements';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [counts] = (await db().execute(sql`
		select
			(select count(*) from tenants where deleted_at is null)::int as tenants,
			(select count(*) from tenants where status = 'ACTIVE' and deleted_at is null)::int as active_tenants,
			(select count(*) from tenants where status = 'SUSPENDED' and deleted_at is null)::int as suspended_tenants,
			(select count(*) from tenants where entitlement_overrides <> '{}'::jsonb and deleted_at is null)::int as overridden_tenants,
			(select count(*) from whatsapp_connections where status = 'CONNECTED')::int as connections,
			(select count(*) from whatsapp_connections where status in ('ERROR','REAUTH_REQUIRED'))::int as unhealthy_connections,
			(select count(*) from booking_requests where created_at > now() - interval '24 hours')::int as requests_24h,
			(select count(*) from orders where created_at > now() - interval '24 hours')::int as orders_24h,
			(select count(*) from orders where status in ('DRAFT','PENDING_CONFIRMATION'))::int as orders_awaiting,
			(select count(*) from messages where created_at > now() - interval '24 hours')::int as messages_24h,
			(select count(*) from messages where status = 'FAILED' and created_at > now() - interval '24 hours')::int as failed_messages_24h,
			(select count(*) from customers where whatsapp_opted_out)::int as opted_out,
			(select count(*) from forms where is_active)::int as active_forms,
			(select coalesce(sum(submission_count), 0) from forms)::int as form_submissions,
			(select count(*) from whatsapp_templates where status = 'APPROVED')::int as approved_templates,
			(select count(*) from jobs where status = 'PENDING')::int as jobs_pending,
			(select count(*) from jobs where status = 'DEAD')::int as jobs_dead,
			(select count(*) from webhook_deliveries where status = 'DEAD')::int as webhooks_dead,
			(select count(*) from payments where status = 'FAILED')::int as payments_failed
	`)) as unknown as Array<Record<string, number>>;

	const activity = (await db().execute(sql`
		with days as (select generate_series(current_date - 13, current_date, '1 day')::date as day)
		select to_char(d.day, 'DD Mon') as label,
			(select count(*)::int from messages m where m.created_at::date = d.day) as messages,
			(select count(*)::int from booking_requests br where br.created_at::date = d.day) as requests,
			(select count(*)::int from orders o where o.created_at::date = d.day) as orders
		from days d order by d.day
	`)) as unknown as Array<{ label: string; messages: number; requests: number; orders: number }>;

	const recentJobs = (await db().execute(sql`
		select kind, status, attempts, last_error, created_at
		from jobs where status in ('DEAD','FAILED') order by created_at desc limit 10
	`)) as unknown as Array<Record<string, unknown>>;

	// Plan mix, so the commercial shape of the platform is visible at a glance.
	const planMix = (await db().execute(sql`
		select coalesce(p.code, 'NO PLAN') as code, count(t.id)::int as tenants
		from tenants t left join plans p on p.id = t.plan_id
		where t.deleted_at is null group by 1 order by 2 desc
	`)) as unknown as Array<{ code: string; tenants: number }>;

	// Which tenants are running out — the actionable list, computed from effective
	// entitlements so an override is reflected exactly as the tenant experiences it.
	const tenants = await db()
		.select({ id: schema.tenants.id, name: schema.tenants.name })
		.from(schema.tenants)
		.where(sql`${schema.tenants.deletedAt} is null and ${schema.tenants.status} = 'ACTIVE'`);
	const nearLimit = (
		await Promise.all(
			tenants.map(async (t) => {
				const rows = await approachingLimits(t.id);
				return rows.map((r) => ({ tenantId: t.id, tenantName: t.name, ...r }));
			})
		)
	)
		.flat()
		.sort((a, b) => b.percent - a.percent)
		.slice(0, 8);

	return {
		counts,
		recentJobs,
		planMix,
		nearLimit,
		activity: {
			labels: activity.map((r) => r.label),
			messages: activity.map((r) => Number(r.messages)),
			requests: activity.map((r) => Number(r.requests)),
			orders: activity.map((r) => Number(r.orders))
		}
	};
};
