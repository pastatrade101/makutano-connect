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
			(select count(*) from payments where status = 'FAILED')::int as payments_failed,

			/*
			 * The marketplace, which is what this product now IS.
			 *
			 * The counts above describe a multi-tenant SaaS: tenants, messages,
			 * orders, forms. None of them answer the two questions a marketplace
			 * operator opens this page to ask — what is waiting on me, and how much
			 * inventory is actually live.
			 */
			(select count(*) from tours where status in ('SUBMITTED','IN_REVIEW') and deleted_at is null)::int as tours_awaiting_review,
			(select count(*) from tours where status = 'PUBLISHED' and deleted_at is null)::int as tours_published,
			(select count(*) from tours where status = 'DRAFT' and deleted_at is null)::int as tours_draft,
			(select count(*) from tours where status = 'CHANGES_REQUESTED' and deleted_at is null)::int as tours_changes_requested,
			(select count(*) from operator_profiles where is_active)::int as operators,
			(select count(*) from operator_profiles where is_active and is_verified)::int as operators_verified,
			(select count(*) from destinations where status = 'PUBLISHED')::int as destinations_published,
			(select count(*) from destinations d where d.status = 'PUBLISHED'
			   and exists (select 1 from tour_destinations td join tours t on t.id = td.tour_id
			               where td.destination_id = d.id and t.status = 'PUBLISHED' and t.deleted_at is null)
			)::int as destinations_with_tours,
			(select count(*) from booking_requests where source = 'MARKETPLACE')::int as marketplace_enquiries,
			(select count(*) from booking_requests where source = 'MARKETPLACE' and created_at > now() - interval '7 days')::int as marketplace_enquiries_7d
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

	// Revenue = live subscriptions × the plan's current price. Honest numbers only:
	// paying (ACTIVE) is MRR, TRIALING is pipeline, PAST_DUE is revenue at risk —
	// never summed together, and currencies are never converted into each other.
	const revenueRows = (await db().execute(sql`
		select p.id, p.code, p.name, p.currency, p.price_monthly as price, p.is_active,
			count(s.id) filter (where s.status = 'ACTIVE')::int as paying,
			count(s.id) filter (where s.status = 'TRIALING')::int as trialing,
			count(s.id) filter (where s.status = 'PAST_DUE')::int as past_due
		from plans p
		left join subscriptions s on s.plan_id = p.id
		left join tenants t on t.id = s.tenant_id
		where s.id is null or t.deleted_at is null
		group by p.id, p.code, p.name, p.currency, p.price_monthly, p.is_active
		order by p.price_monthly::numeric desc
	`)) as unknown as Array<{
		id: string;
		code: string;
		name: string;
		currency: string;
		price: string;
		is_active: boolean;
		paying: number;
		trialing: number;
		past_due: number;
	}>;

	// AI spend this month. Shown next to revenue because that is the only honest place
	// for it: assist is a cost of serving a tenant, not a feature that pays for itself.
	const aiRows = (await db()
		.execute(
			sql`
		select coalesce(t.name, 'unknown') as tenant, t.id as tenant_id,
			count(*)::int as requests,
			coalesce(sum(a.cost_usd), 0)::numeric(14,6) as cost
		from ai_usage a join tenants t on t.id = a.tenant_id
		where a.created_at >= date_trunc('month', now() at time zone 'utc')
		group by t.id, t.name
		order by cost desc
		limit 8
	`
		)
		.catch(() => [])) as unknown as Array<{ tenant: string; tenant_id: string; requests: number; cost: string }>;
	const ai = {
		tenants: aiRows.map((r) => ({
			tenant: r.tenant,
			tenantId: r.tenant_id,
			requests: Number(r.requests),
			cost: Number(r.cost)
		})),
		totalRequests: aiRows.reduce((sum, r) => sum + Number(r.requests), 0),
		totalCost: aiRows.reduce((sum, r) => sum + Number(r.cost), 0)
	};

	const revenuePlans = revenueRows.map((r) => {
		const price = Number(r.price);
		return {
			id: r.id,
			code: r.code,
			name: r.name,
			currency: r.currency,
			price,
			isActive: r.is_active,
			paying: Number(r.paying),
			trialing: Number(r.trialing),
			pastDue: Number(r.past_due),
			mrr: Number(r.paying) * price,
			trialValue: Number(r.trialing) * price,
			pastDueValue: Number(r.past_due) * price
		};
	});
	const byCurrency = new Map<
		string,
		{ currency: string; mrr: number; trialValue: number; pastDueValue: number; paying: number; trialing: number }
	>();
	for (const r of revenuePlans) {
		const t = byCurrency.get(r.currency) ?? {
			currency: r.currency,
			mrr: 0,
			trialValue: 0,
			pastDueValue: 0,
			paying: 0,
			trialing: 0
		};
		t.mrr += r.mrr;
		t.trialValue += r.trialValue;
		t.pastDueValue += r.pastDueValue;
		t.paying += r.paying;
		t.trialing += r.trialing;
		byCurrency.set(r.currency, t);
	}
	const revenue = {
		plans: revenuePlans,
		totals: [...byCurrency.values()].sort((a, b) => b.mrr - a.mrr)
	};

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
		revenue,
		ai,
		nearLimit,
		activity: {
			labels: activity.map((r) => r.label),
			messages: activity.map((r) => Number(r.messages)),
			requests: activity.map((r) => Number(r.requests)),
			orders: activity.map((r) => Number(r.orders))
		}
	};
};
