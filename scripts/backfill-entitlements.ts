// Backfill plan entitlements from the legacy limits/features columns, and create any
// missing subscription rows.
//
// The governing rule is BEHAVIOUR PRESERVATION: every tenant must be able to do
// tomorrow exactly what it can do today. So:
//   * gates that already existed (payments, client_webhooks, custom_templates,
//     multiple_numbers) carry across unchanged;
//   * capabilities that were previously UNGATED (orders, forms, api, bookings,
//     quotations, automation) are enabled everywhere, with generous tiered allowances
//     no current tenant approaches — the admin can tighten them afterwards;
//   * 0 keeps meaning unlimited, so ENTERPRISE stays unlimited.
//
// Idempotent: re-running recomputes the same values and never clobbers a tenant's
// explicit overrides. Run with --dry-run first.
import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
	console.error('DIRECT_DATABASE_URL is not set.');
	process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

type Legacy = { limits: Record<string, number>; features: Record<string, boolean> };

/** Tiered allowances for the newer modules, indexed by plan code. */
const TIERS: Record<string, { orders: number; quotations: number; forms: number; templates: number; numbers: number; apiKeys: number }> = {
	STARTER: { orders: 200, quotations: 200, forms: 3, templates: 10, numbers: 1, apiKeys: 2 },
	BUSINESS: { orders: 1000, quotations: 1000, forms: 10, templates: 25, numbers: 1, apiKeys: 5 },
	PRO: { orders: 5000, quotations: 5000, forms: 50, templates: 100, numbers: 5, apiKeys: 15 },
	ENTERPRISE: { orders: 0, quotations: 0, forms: 0, templates: 0, numbers: 0, apiKeys: 50 }
};

function entitlementsFor(code: string, legacy: Legacy): Record<string, boolean | number> {
	const limits = legacy.limits ?? {};
	const features = legacy.features ?? {};
	const tier = TIERS[code] ?? TIERS.STARTER;
	// multiple_numbers=false historically meant exactly one connected number.
	const maxNumbers = features.multiple_numbers ? tier.numbers : 1;

	return {
		'platform.maxUsers': limits.members ?? 0,
		'api.enabled': true, // never gated before
		'api.maxKeys': limits.api_keys ?? tier.apiKeys,
		'api.requestsPerMinute': limits.api_requests_per_minute ?? 60,
		'api.maxRequestsPerMonth': 0, // only a per-minute limit existed; stay unlimited
		'webhooks.enabled': features.client_webhooks === true,

		'whatsapp.enabled': features.whatsapp !== false,
		'whatsapp.maxNumbers': maxNumbers,
		'whatsapp.maxOutboundPerMonth': limits.whatsapp_outbound_per_month ?? 0,
		'whatsapp.templatesEnabled': features.custom_templates === true,
		'whatsapp.maxTemplates': tier.templates,
		'automation.enabled': true, // event→template mapping was never gated

		'bookings.enabled': true,
		'bookings.maxRequestsPerMonth': limits.booking_requests_per_month ?? 0,

		'orders.enabled': true,
		'orders.maxPerMonth': tier.orders,

		'quotations.enabled': features.quotations !== false,
		'quotations.maxPerMonth': tier.quotations,

		'forms.hostedEnabled': true,
		'forms.embeddedEnabled': true,
		'forms.maxForms': tier.forms,

		'payments.enabled': features.payments === true
	};
}

console.log(DRY_RUN ? '— DRY RUN —\n' : '— APPLYING —\n');

const plans = await sql<Array<{ id: string; code: string; name: string; limits: Record<string, number>; features: Record<string, boolean>; entitlements: Record<string, unknown> }>>`
	select id, code, name, limits, features, entitlements from plans order by sort_order`;

for (const plan of plans) {
	const next = entitlementsFor(plan.code, { limits: plan.limits, features: plan.features });
	const existing = Object.keys(plan.entitlements ?? {}).length;
	console.log(`${plan.code.padEnd(11)} ${existing ? `(has ${existing} keys — recomputing)` : '(empty — seeding)'}`);
	console.log(`   whatsapp=${next['whatsapp.enabled']} numbers=${next['whatsapp.maxNumbers']} outbound/mo=${next['whatsapp.maxOutboundPerMonth'] || 'unlimited'}`);
	console.log(`   bookings/mo=${next['bookings.maxRequestsPerMonth'] || 'unlimited'} orders/mo=${next['orders.maxPerMonth'] || 'unlimited'} forms=${next['forms.maxForms'] || 'unlimited'}`);
	console.log(`   webhooks=${next['webhooks.enabled']} payments=${next['payments.enabled']} templates=${next['whatsapp.templatesEnabled']}`);
	if (!DRY_RUN) {
		await sql`update plans set entitlements = ${sql.json(next)}, updated_at = now() where id = ${plan.id}`;
	}
}

// Tenants imported before subscriptions existed have none — create one so the control
// plane has a period to show and extend. Status mirrors the tenant so nothing changes.
const orphans = await sql<Array<{ id: string; slug: string; status: string; plan_id: string | null }>>`
	select t.id, t.slug, t.status, t.plan_id from tenants t
	where t.deleted_at is null and not exists (select 1 from subscriptions s where s.tenant_id = t.id)`;
console.log(`\nTenants without a subscription row: ${orphans.length}`);
for (const tenant of orphans) {
	if (!tenant.plan_id) {
		console.log(`  ${tenant.slug}: no plan assigned — skipping (assign a plan in the admin first)`);
		continue;
	}
	console.log(`  ${tenant.slug}: creating ACTIVE subscription (period = 1 month)`);
	if (!DRY_RUN) {
		await sql`
			insert into subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
			values (${tenant.id}, ${tenant.plan_id}, 'ACTIVE', now(), now() + interval '1 month')`;
	}
}

// Nothing may silently disable a live tenant: report what each one ends up with.
console.log('\n=== resulting effective access per tenant (overrides applied) ===');
const tenants = await sql<Array<{ slug: string; status: string; code: string | null; entitlements: Record<string, boolean | number> | null; overrides: Record<string, boolean | number> }>>`
	select t.slug, t.status, p.code, p.entitlements, t.entitlement_overrides as overrides
	from tenants t left join plans p on p.id = t.plan_id where t.deleted_at is null order by t.slug`;
for (const t of tenants) {
	const planEnt = (t.entitlements ?? {}) as Record<string, boolean | number>;
	const merged = { ...planEnt, ...(t.overrides ?? {}) };
	const shown = ['whatsapp.enabled', 'bookings.enabled', 'orders.enabled', 'quotations.enabled', 'api.enabled', 'webhooks.enabled'];
	console.log(`  ${t.slug.padEnd(18)} [${t.status}] ${t.code ?? 'NO PLAN'} → ${shown.map((k) => `${k.split('.')[0]}=${merged[k] ?? '(fallback)'}`).join(' ')}`);
}

await sql.end();
console.log(DRY_RUN ? '\nDry run complete — nothing written.' : '\nBackfill complete.');
