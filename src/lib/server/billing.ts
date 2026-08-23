// Plan features, limits and usage metering (§27). Every feature gate and quota check
// funnels through canUseFeature() / checkLimit() / recordUsage() so pricing changes
// touch one module, not fifty call sites.
import { sql } from 'drizzle-orm';
import { db, schema } from './db';
import { invalidateEntitlements } from './entitlements';
import { log } from './logger';

export type UsageMetric =
	| 'api_requests'
	| 'whatsapp_inbound'
	| 'whatsapp_outbound'
	| 'booking_requests'
	| 'bookings'
	| 'orders'
	| 'quotations'
	| 'webhook_deliveries'
	| 'storage_bytes'
	| 'ai_tokens';







/** Kept for existing callers — plan/entitlement caching now lives in entitlements.ts. */
export function invalidatePlanCache(tenantId?: string): void {
	invalidateEntitlements(tenantId);
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
