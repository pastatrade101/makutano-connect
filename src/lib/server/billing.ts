// Plan features, limits and usage metering (§27). Every feature gate and quota check
// funnels through canUseFeature() / checkLimit() / recordUsage() so pricing changes
// touch one module, not fifty call sites.
import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import { log } from './logger';

export type UsageMetric =
	| 'api_requests'
	| 'whatsapp_inbound'
	| 'whatsapp_outbound'
	| 'booking_requests'
	| 'bookings'
	| 'webhook_deliveries'
	| 'storage_bytes'
	| 'ai_tokens';

export type PlanFeature =
	'whatsapp' | 'quotations' | 'payments' | 'client_webhooks' | 'multiple_numbers' | 'custom_templates';

/** Fallback when a tenant has no plan attached — the free-tier shape. */
const FALLBACK = {
	limits: {
		api_requests_per_minute: 60,
		booking_requests_per_month: 100,
		whatsapp_outbound_per_month: 500,
		api_keys: 2,
		members: 3
	} as Record<string, number>,
	features: {
		whatsapp: true,
		quotations: true,
		payments: false,
		client_webhooks: false,
		multiple_numbers: false,
		custom_templates: false
	} as Record<string, boolean>
};

export type EffectivePlan = { code: string; limits: Record<string, number>; features: Record<string, boolean> };

const planCache = new Map<string, { value: EffectivePlan; expires: number }>();
const PLAN_TTL_MS = 30_000;

export async function effectivePlan(tenantId: string): Promise<EffectivePlan> {
	const cached = planCache.get(tenantId);
	if (cached && cached.expires > Date.now()) return cached.value;

	const rows = await db()
		.select({ plan: schema.plans })
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.where(eq(schema.tenants.id, tenantId))
		.limit(1);

	const plan = rows[0]?.plan;
	const value: EffectivePlan = plan
		? {
				code: plan.code,
				limits: { ...FALLBACK.limits, ...(plan.limits ?? {}) },
				features: { ...FALLBACK.features, ...(plan.features ?? {}) }
			}
		: { code: 'NONE', limits: FALLBACK.limits, features: FALLBACK.features };

	planCache.set(tenantId, { value, expires: Date.now() + PLAN_TTL_MS });
	return value;
}

export function invalidatePlanCache(tenantId?: string): void {
	if (tenantId) planCache.delete(tenantId);
	else planCache.clear();
}

export async function canUseFeature(tenantId: string, feature: PlanFeature): Promise<boolean> {
	const plan = await effectivePlan(tenantId);
	return plan.features[feature] === true;
}

export async function requireFeature(tenantId: string, feature: PlanFeature): Promise<void> {
	if (!(await canUseFeature(tenantId, feature))) {
		throw new AppError('FEATURE_NOT_AVAILABLE', `Your plan does not include ${feature.replace(/_/g, ' ')}.`);
	}
}

export function currentPeriod(now: Date = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Increment a usage counter atomically. Never throws into the caller's happy path. */
export async function recordUsage(tenantId: string, metric: UsageMetric, quantity = 1): Promise<void> {
	if (quantity === 0) return;
	try {
		await db().execute(sql`
			insert into usage_records (tenant_id, metric, period, quantity)
			values (${tenantId}::uuid, ${metric}, ${currentPeriod()}, ${quantity})
			on conflict (tenant_id, metric, period)
			do update set quantity = usage_records.quantity + ${quantity}, updated_at = now()
		`);
	} catch (err) {
		log.warn('record_usage_failed', { metric, error: (err as Error)?.message });
	}
}

export async function usageFor(tenantId: string, metric: UsageMetric, period = currentPeriod()): Promise<number> {
	const rows = (await db().execute<{ quantity: number }>(sql`
		select quantity from usage_records
		where tenant_id = ${tenantId}::uuid and metric = ${metric} and period = ${period}
		limit 1
	`)) as unknown as Array<{ quantity: number }>;
	return Number(rows[0]?.quantity ?? 0);
}

/**
 * Check a monthly quota before performing the metered action.
 * @param limitKey key inside plan.limits, e.g. `booking_requests_per_month`
 */
export async function checkLimit(tenantId: string, metric: UsageMetric, limitKey: string): Promise<void> {
	const plan = await effectivePlan(tenantId);
	const limit = plan.limits[limitKey];
	if (!Number.isFinite(limit) || limit <= 0) return; // unset or unlimited
	const used = await usageFor(tenantId, metric);
	if (used >= limit) {
		throw new AppError('PLAN_LIMIT_REACHED', `Your ${plan.code} plan limit for this month has been reached.`, {
			limit,
			used,
			metric
		});
	}
}

/** Requests-per-minute allowance for a tenant's plan (§28). */
export async function apiRateLimitFor(tenantId: string): Promise<number> {
	const plan = await effectivePlan(tenantId);
	return plan.limits.api_requests_per_minute ?? 60;
}

export const DEFAULT_PLANS = [
	{
		code: 'STARTER',
		name: 'Starter',
		priceMonthly: '29',
		sortOrder: 1,
		limits: {
			api_requests_per_minute: 60,
			booking_requests_per_month: 200,
			whatsapp_outbound_per_month: 1000,
			api_keys: 2,
			members: 3
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: false,
			client_webhooks: false,
			multiple_numbers: false,
			custom_templates: false
		}
	},
	{
		code: 'BUSINESS',
		name: 'Business',
		priceMonthly: '99',
		sortOrder: 2,
		limits: {
			api_requests_per_minute: 120,
			booking_requests_per_month: 1000,
			whatsapp_outbound_per_month: 10000,
			api_keys: 5,
			members: 10
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: false,
			custom_templates: true
		}
	},
	{
		code: 'PRO',
		name: 'Pro',
		priceMonthly: '249',
		sortOrder: 3,
		limits: {
			api_requests_per_minute: 300,
			booking_requests_per_month: 5000,
			whatsapp_outbound_per_month: 50000,
			api_keys: 15,
			members: 30
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: true,
			custom_templates: true
		}
	},
	{
		code: 'ENTERPRISE',
		name: 'Enterprise',
		priceMonthly: '0',
		sortOrder: 4,
		limits: {
			api_requests_per_minute: 1000,
			booking_requests_per_month: 0,
			whatsapp_outbound_per_month: 0,
			api_keys: 50,
			members: 200
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: true,
			custom_templates: true
		}
	}
] as const;
