// §21/§27 — API usage and subscription state across the platform.
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { currentPeriod } from '$lib/server/billing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const period = currentPeriod();

	const usage = (await db().execute(sql`
		select t.name as tenant_name, t.id as tenant_id,
			coalesce(max(case when u.metric = 'api_requests' then u.quantity end), 0)::int as api_requests,
			coalesce(max(case when u.metric = 'whatsapp_outbound' then u.quantity end), 0)::int as whatsapp_outbound,
			coalesce(max(case when u.metric = 'whatsapp_inbound' then u.quantity end), 0)::int as whatsapp_inbound,
			coalesce(max(case when u.metric = 'booking_requests' then u.quantity end), 0)::int as booking_requests,
			coalesce(max(case when u.metric = 'webhook_deliveries' then u.quantity end), 0)::int as webhook_deliveries
		from tenants t
		left join usage_records u on u.tenant_id = t.id and u.period = ${period}
		where t.deleted_at is null
		group by t.id, t.name
		order by api_requests desc
	`)) as unknown as Array<Record<string, string | number>>;

	const subscriptions = await db()
		.select({ subscription: schema.subscriptions, tenant: schema.tenants, plan: schema.plans })
		.from(schema.subscriptions)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
		.innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
		.orderBy(desc(schema.subscriptions.createdAt));

	return { period, usage, subscriptions };
};
