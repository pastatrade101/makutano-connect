// §21/§27 — usage against entitlements across the platform.
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { currentPeriod } from '$lib/server/billing';
import { usageSummary } from '$lib/server/entitlements';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const tenants = await db()
		.select({ tenant: schema.tenants, plan: schema.plans })
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.where(eq(schema.tenants.deletedAt, schema.tenants.deletedAt)) // no-op keeps the type simple
		.orderBy(schema.tenants.name);

	// Used / limit per tenant — the limit comes from effective entitlements, so an
	// override shows up here exactly as the tenant experiences it.
	const rows = await Promise.all(
		tenants
			.filter((t) => !t.tenant.deletedAt)
			.map(async (t) => ({
				tenantId: t.tenant.id,
				name: t.tenant.name,
				slug: t.tenant.slug,
				status: t.tenant.status,
				plan: t.plan?.code ?? 'NONE',
				usage: await usageSummary(t.tenant.id)
			}))
	);

	const subscriptions = await db()
		.select({ subscription: schema.subscriptions, tenant: schema.tenants, plan: schema.plans })
		.from(schema.subscriptions)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
		.innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
		.orderBy(desc(schema.subscriptions.createdAt));

	return { period: currentPeriod(), rows, subscriptions };
};
