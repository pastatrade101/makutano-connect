// Entitlements — the authoritative SaaS gate.
//
//   Plan defaults  +  tenant overrides  =  effective entitlements  →  enforcement
//
// Rules that make this safe to build on:
//   * keys are GENERIC and dotted ('orders.enabled', 'whatsapp.maxNumbers') — never
//     `if (plan === 'PRO')`, so plans can evolve without touching a single controller;
//   * a tenant stores ONLY the keys it overrides, so a plan change still flows through
//     for everything else;
//   * numeric 0 means UNLIMITED, matching the convention the legacy `limits` column
//     already used (ENTERPRISE depends on it);
//   * this module decides ACCESS. It never decides WhatsApp policy — compliance is a
//     separate, stricter layer that entitlements cannot loosen.
import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { currentPeriod, usageFor, type UsageMetric } from './billing';
import { AppError } from './errors';

export type EntitlementValue = boolean | number;
export type EntitlementKind = 'boolean' | 'number';

export type EntitlementDefinition = {
	key: string;
	label: string;
	group: 'Platform' | 'WhatsApp' | 'Bookings' | 'Orders' | 'Quotations' | 'Forms' | 'Payments';
	kind: EntitlementKind;
	/** Usage metric this limit is measured against, when it is a monthly allowance. */
	metric?: UsageMetric;
	/** Fallback when neither plan nor override defines it — chosen to preserve today's behaviour. */
	fallback: EntitlementValue;
	hint?: string;
};

/**
 * The registry. Adding a feature means adding a row here and one assertion at the
 * write path — nothing else in the codebase needs to know about plans.
 */
export const ENTITLEMENTS: EntitlementDefinition[] = [
	// --- Platform -----------------------------------------------------------
	{ key: 'platform.maxUsers', label: 'Team members', group: 'Platform', kind: 'number', fallback: 0 },
	{ key: 'api.enabled', label: 'API access', group: 'Platform', kind: 'boolean', fallback: true },
	{ key: 'api.maxKeys', label: 'API keys', group: 'Platform', kind: 'number', fallback: 0 },
	{
		key: 'api.requestsPerMinute',
		label: 'API requests / minute',
		group: 'Platform',
		kind: 'number',
		fallback: 60,
		hint: 'Rate limit applied per tenant'
	},
	{
		key: 'api.maxRequestsPerMonth',
		label: 'API requests / month',
		group: 'Platform',
		kind: 'number',
		metric: 'api_requests',
		fallback: 0
	},
	{ key: 'webhooks.enabled', label: 'Outbound webhooks', group: 'Platform', kind: 'boolean', fallback: false },

	// --- WhatsApp -----------------------------------------------------------
	{ key: 'whatsapp.enabled', label: 'WhatsApp', group: 'WhatsApp', kind: 'boolean', fallback: true },
	{ key: 'whatsapp.maxNumbers', label: 'Connected numbers', group: 'WhatsApp', kind: 'number', fallback: 1 },
	{
		key: 'whatsapp.maxOutboundPerMonth',
		label: 'Outbound messages / month',
		group: 'WhatsApp',
		kind: 'number',
		metric: 'whatsapp_outbound',
		fallback: 0
	},
	{ key: 'whatsapp.templatesEnabled', label: 'Custom templates', group: 'WhatsApp', kind: 'boolean', fallback: true },
	{ key: 'whatsapp.maxTemplates', label: 'Templates', group: 'WhatsApp', kind: 'number', fallback: 0 },
	{
		key: 'automation.enabled',
		label: 'Event automation',
		group: 'WhatsApp',
		kind: 'boolean',
		fallback: true,
		hint: 'Event → template notifications'
	},

	// --- Bookings -----------------------------------------------------------
	{ key: 'bookings.enabled', label: 'Bookings', group: 'Bookings', kind: 'boolean', fallback: true },
	{
		key: 'bookings.maxRequestsPerMonth',
		label: 'Booking requests / month',
		group: 'Bookings',
		kind: 'number',
		metric: 'booking_requests',
		fallback: 0
	},

	// --- Orders -------------------------------------------------------------
	{ key: 'orders.enabled', label: 'Orders', group: 'Orders', kind: 'boolean', fallback: true },
	{ key: 'orders.maxPerMonth', label: 'Orders / month', group: 'Orders', kind: 'number', metric: 'orders', fallback: 0 },

	// --- Quotations ---------------------------------------------------------
	{ key: 'quotations.enabled', label: 'Quotations', group: 'Quotations', kind: 'boolean', fallback: true },
	{
		key: 'quotations.maxPerMonth',
		label: 'Quotations / month',
		group: 'Quotations',
		kind: 'number',
		metric: 'quotations',
		fallback: 0
	},

	// --- Forms --------------------------------------------------------------
	{ key: 'forms.hostedEnabled', label: 'Hosted forms', group: 'Forms', kind: 'boolean', fallback: true },
	{ key: 'forms.embeddedEnabled', label: 'Embeddable widgets', group: 'Forms', kind: 'boolean', fallback: true },
	{ key: 'forms.maxForms', label: 'Forms', group: 'Forms', kind: 'number', fallback: 0 },

	// --- Payments -----------------------------------------------------------
	{ key: 'payments.enabled', label: 'Payments', group: 'Payments', kind: 'boolean', fallback: false }
];

export const ENTITLEMENT_KEYS = ENTITLEMENTS.map((e) => e.key);
const BY_KEY = new Map(ENTITLEMENTS.map((e) => [e.key, e]));

export function entitlementDefinition(key: string): EntitlementDefinition | undefined {
	return BY_KEY.get(key);
}

/** 0 (or a non-finite value) means unlimited, everywhere. */
export function isUnlimited(limit: number): boolean {
	return !Number.isFinite(limit) || limit <= 0;
}

export type ResolvedEntitlement = {
	key: string;
	definition: EntitlementDefinition;
	planValue: EntitlementValue | null;
	override: EntitlementValue | null;
	effective: EntitlementValue;
};

export type TenantEntitlements = {
	tenantId: string;
	tenantStatus: schema.Tenant['status'];
	planCode: string;
	planName: string;
	subscriptionStatus: string | null;
	resolved: Record<string, ResolvedEntitlement>;
	value: (key: string) => EntitlementValue;
};

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: TenantEntitlements; expires: number }>();

export function invalidateEntitlements(tenantId?: string): void {
	if (tenantId) cache.delete(tenantId);
	else cache.clear();
}

/**
 * Resolve a tenant's effective entitlements. Cached briefly — an admin change calls
 * invalidateEntitlements(), so overrides take effect immediately rather than after a TTL.
 */
export async function effectiveEntitlements(tenantId: string): Promise<TenantEntitlements> {
	const hit = cache.get(tenantId);
	if (hit && hit.expires > Date.now()) return hit.value;

	const rows = await db()
		.select({ tenant: schema.tenants, plan: schema.plans })
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.where(eq(schema.tenants.id, tenantId))
		.limit(1);
	const row = rows[0];
	if (!row) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	const subs = await db()
		.select({ status: schema.subscriptions.status })
		.from(schema.subscriptions)
		.where(eq(schema.subscriptions.tenantId, tenantId))
		.orderBy(sql`${schema.subscriptions.createdAt} desc`)
		.limit(1);

	const planEntitlements = (row.plan?.entitlements ?? {}) as Record<string, EntitlementValue>;
	const overrides = (row.tenant.entitlementOverrides ?? {}) as Record<string, EntitlementValue>;

	const resolved: Record<string, ResolvedEntitlement> = {};
	for (const definition of ENTITLEMENTS) {
		const planValue = Object.prototype.hasOwnProperty.call(planEntitlements, definition.key)
			? planEntitlements[definition.key]
			: null;
		const override = Object.prototype.hasOwnProperty.call(overrides, definition.key) ? overrides[definition.key] : null;
		const effective = override !== null ? override : planValue !== null ? planValue : definition.fallback;
		resolved[definition.key] = { key: definition.key, definition, planValue, override, effective };
	}

	const value: TenantEntitlements = {
		tenantId,
		tenantStatus: row.tenant.status,
		planCode: row.plan?.code ?? 'NONE',
		planName: row.plan?.name ?? 'No plan',
		subscriptionStatus: subs[0]?.status ?? null,
		resolved,
		value: (key: string) => resolved[key]?.effective ?? (BY_KEY.get(key)?.fallback ?? false)
	};
	cache.set(tenantId, { value, expires: Date.now() + CACHE_TTL_MS });
	return value;
}

/* ------------------------------------------------------------ queries ----- */

export async function can(tenantId: string, key: string): Promise<boolean> {
	const ent = await effectiveEntitlements(tenantId);
	return ent.value(key) === true;
}

export async function getLimit(tenantId: string, key: string): Promise<number> {
	const ent = await effectiveEntitlements(tenantId);
	const raw = ent.value(key);
	return typeof raw === 'number' ? raw : 0;
}

/** How much of a monthly allowance is left. null = unlimited. */
export async function remaining(tenantId: string, key: string): Promise<number | null> {
	const definition = BY_KEY.get(key);
	if (!definition?.metric) return null;
	const limit = await getLimit(tenantId, key);
	if (isUnlimited(limit)) return null;
	const used = await usageFor(tenantId, definition.metric);
	return Math.max(0, limit - used);
}

export async function getUsage(tenantId: string, metric: UsageMetric): Promise<number> {
	return usageFor(tenantId, metric);
}

/* ------------------------------------------------------------ assertions -- */

/**
 * A tenant must be live before ANY write. Suspension never hides data — reads and the
 * admin's view keep working; only the write paths close.
 */
export async function assertTenantActive(tenantId: string): Promise<void> {
	const ent = await effectiveEntitlements(tenantId);
	if (ent.tenantStatus === 'SUSPENDED') {
		throw new AppError('TENANT_SUSPENDED', 'This account is suspended. Please contact support.');
	}
	if (ent.tenantStatus === 'CANCELLED') {
		throw new AppError('TENANT_SUSPENDED', 'This account is closed.');
	}
	if (ent.subscriptionStatus === 'CANCELLED') {
		throw new AppError('SUBSCRIPTION_INACTIVE', 'This subscription has ended. Please renew to continue.');
	}
}

/** Feature gate. Throws FEATURE_NOT_AVAILABLE with the key, so the UI can explain it. */
export async function assertFeature(tenantId: string, key: string): Promise<void> {
	if (!(await can(tenantId, key))) {
		const label = BY_KEY.get(key)?.label ?? key;
		throw new AppError('FEATURE_NOT_AVAILABLE', `${label} is not included in your current plan.`, { feature: key });
	}
}

/**
 * Monthly allowance gate. Throws ENTITLEMENT_LIMIT_REACHED carrying safe metadata
 * (feature, usage, limit) so the tenant UI can say exactly what ran out.
 */
export async function assertWithinLimit(tenantId: string, key: string): Promise<void> {
	const definition = BY_KEY.get(key);
	if (!definition?.metric) return;
	const limit = await getLimit(tenantId, key);
	if (isUnlimited(limit)) return;
	const used = await usageFor(tenantId, definition.metric);
	if (used >= limit) {
		throw new AppError('ENTITLEMENT_LIMIT_REACHED', `You have reached your monthly limit for ${definition.label.toLowerCase()}.`, {
			feature: key,
			metric: definition.metric,
			usage: used,
			limit,
			period: currentPeriod()
		});
	}
}

/** Counted resources (numbers, keys, forms) — checked against a live count, not usage. */
export async function assertWithinCount(tenantId: string, key: string, currentCount: number): Promise<void> {
	const limit = await getLimit(tenantId, key);
	if (isUnlimited(limit)) return;
	if (currentCount >= limit) {
		const definition = BY_KEY.get(key);
		throw new AppError('ENTITLEMENT_LIMIT_REACHED', `Your plan allows ${limit} ${(definition?.label ?? key).toLowerCase()}.`, {
			feature: key,
			usage: currentCount,
			limit
		});
	}
}

/**
 * The standard gate for a tenant write: active → feature enabled → allowance left.
 * One call at the top of a service keeps the checks in one predictable order.
 */
export async function assertAllowed(
	tenantId: string,
	options: { feature?: string; limit?: string } = {}
): Promise<void> {
	await assertTenantActive(tenantId);
	if (options.feature) await assertFeature(tenantId, options.feature);
	if (options.limit) await assertWithinLimit(tenantId, options.limit);
}

/* -------------------------------------------------- admin-facing summary --- */

export type UsageSummaryRow = {
	key: string;
	label: string;
	metric: UsageMetric;
	used: number;
	limit: number;
	unlimited: boolean;
	percent: number;
};

/** Used / limit for every metered entitlement — powers both admin and tenant views. */
export async function usageSummary(tenantId: string): Promise<UsageSummaryRow[]> {
	const ent = await effectiveEntitlements(tenantId);
	const metered = ENTITLEMENTS.filter((e) => e.metric);
	const rows = await Promise.all(
		metered.map(async (definition) => {
			const limit = Number(ent.value(definition.key) ?? 0);
			const used = await usageFor(tenantId, definition.metric!);
			const unlimited = isUnlimited(limit);
			return {
				key: definition.key,
				label: definition.label,
				metric: definition.metric!,
				used,
				limit,
				unlimited,
				percent: unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100))
			};
		})
	);
	return rows;
}

/** Metered entitlements at or above the warning threshold (for tenant nudges). */
export async function approachingLimits(tenantId: string, threshold = 80): Promise<UsageSummaryRow[]> {
	return (await usageSummary(tenantId)).filter((r) => !r.unlimited && r.percent >= threshold);
}
