// Tenant resolution and provisioning (§3, §4).
//
// The one rule that makes multi-tenancy safe: a tenant_id supplied by the browser or
// an external caller is NEVER authorization. Tenants are resolved from an
// authenticated membership or from a server API key, and every query below is scoped
// by that resolved id.
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import { permissionsForRole, type Permission } from './auth/permissions';
import type { Role } from './db/schema';

export type TenantContext = {
	tenant: schema.Tenant;
	role: Role;
	permissions: Permission[];
};

export async function getTenantById(tenantId: string): Promise<schema.Tenant | null> {
	const rows = await db()
		.select()
		.from(schema.tenants)
		.where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getTenantBySlug(slug: string): Promise<schema.Tenant | null> {
	const rows = await db()
		.select()
		.from(schema.tenants)
		.where(and(eq(schema.tenants.slug, slug), isNull(schema.tenants.deletedAt)))
		.limit(1);
	return rows[0] ?? null;
}

/** Every tenant a user may act in, with the role that grants it. */
export async function membershipsForUser(userId: string) {
	return db()
		.select({ membership: schema.tenantMemberships, tenant: schema.tenants })
		.from(schema.tenantMemberships)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
		.where(and(eq(schema.tenantMemberships.userId, userId), isNull(schema.tenants.deletedAt)));
}

/**
 * Resolve the tenant a user is acting in. `requestedTenantId` is only ever a *hint*
 * (from the session's active tenant); it is honoured solely when a membership backs it.
 */
export async function resolveTenantForUser(
	user: schema.User,
	requestedTenantId: string | null
): Promise<TenantContext | null> {
	const rows = await membershipsForUser(user.id);
	if (rows.length === 0) {
		// A super admin has no membership rows but may still operate on any tenant.
		if (user.isSuperAdmin && requestedTenantId) {
			const tenant = await getTenantById(requestedTenantId);
			if (tenant) return { tenant, role: 'SUPER_ADMIN', permissions: permissionsForRole('SUPER_ADMIN') };
		}
		return null;
	}
	const match = requestedTenantId ? rows.find((r) => r.tenant.id === requestedTenantId) : null;
	const chosen = match ?? rows[0];
	if (requestedTenantId && !match && user.isSuperAdmin) {
		const tenant = await getTenantById(requestedTenantId);
		if (tenant) return { tenant, role: 'SUPER_ADMIN', permissions: permissionsForRole('SUPER_ADMIN') };
	}
	const role: Role = user.isSuperAdmin ? 'SUPER_ADMIN' : chosen.membership.role;
	return { tenant: chosen.tenant, role, permissions: permissionsForRole(role) };
}

export type ProvisionInput = {
	name: string;
	slug: string;
	planCode?: string;
	timezone?: string;
	currency?: string;
	country?: string;
	bookingReferencePrefix?: string;
	quotationPrefix?: string;
};

/**
 * Admin/invisible provisioning (§4): the client does not register — Makutano creates
 * the tenant, assigns a plan and generates credentials.
 */
export async function provisionTenant(input: ProvisionInput): Promise<schema.Tenant> {
	const existing = await getTenantBySlug(input.slug);
	if (existing) throw new AppError('CONFLICT', `A tenant with the slug "${input.slug}" already exists.`);

	const plan = input.planCode
		? (await db().select().from(schema.plans).where(eq(schema.plans.code, input.planCode)).limit(1))[0]
		: (await db().select().from(schema.plans).where(eq(schema.plans.code, 'STARTER')).limit(1))[0];

	const prefix =
		(input.bookingReferencePrefix || input.slug.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MKT';

	const [tenant] = await db()
		.insert(schema.tenants)
		.values({
			name: input.name,
			slug: input.slug,
			planId: plan?.id ?? null,
			timezone: input.timezone ?? 'Africa/Dar_es_Salaam',
			currency: input.currency ?? 'USD',
			country: input.country ?? null,
			bookingReferencePrefix: prefix,
			quotationPrefix: input.quotationPrefix ?? 'QT'
		})
		.returning();

	if (plan) {
		const periodEnd = new Date();
		periodEnd.setMonth(periodEnd.getMonth() + 1);
		await db()
			.insert(schema.subscriptions)
			.values({ tenantId: tenant.id, planId: plan.id, currentPeriodEnd: periodEnd });
	}

	return tenant;
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}
