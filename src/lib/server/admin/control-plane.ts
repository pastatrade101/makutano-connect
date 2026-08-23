// Platform Admin operations. Every mutation here is a privileged act, so each one
// writes an audit row carrying before/after state — and never a secret.
import { desc, eq, sql } from 'drizzle-orm';
import { audit } from '../audit';
import { db, schema } from '../db';
import {
	effectiveEntitlements,
	entitlementDefinition,
	ENTITLEMENTS,
	invalidateEntitlements,
	usageSummary,
	type EntitlementValue
} from '../entitlements';
import { AppError } from '../errors';
import { industryLabel } from '../provisioning';

export type AdminActor = { userId: string; requestId?: string | null };

/* ----------------------------------------------------------- plans ------- */

export async function listPlans() {
	return db().select().from(schema.plans).orderBy(schema.plans.sortOrder);
}

export async function updatePlan(
	planId: string,
	patch: { name?: string; isActive?: boolean; priceMonthly?: string; entitlements?: Record<string, EntitlementValue> },
	actor: AdminActor
) {
	const before = (await db().select().from(schema.plans).where(eq(schema.plans.id, planId)).limit(1))[0];
	if (!before) throw new AppError('NOT_FOUND', 'Plan not found.');

	// Only keys in the registry survive — an unknown key would silently never be read.
	let entitlements = before.entitlements as Record<string, EntitlementValue>;
	if (patch.entitlements) {
		entitlements = {};
		for (const [key, value] of Object.entries(patch.entitlements)) {
			const definition = entitlementDefinition(key);
			if (!definition) continue;
			entitlements[key] = definition.kind === 'boolean' ? value === true : Math.max(0, Number(value) || 0);
		}
	}

	const [after] = await db()
		.update(schema.plans)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
			...(patch.priceMonthly !== undefined ? { priceMonthly: patch.priceMonthly } : {}),
			entitlements,
			updatedAt: new Date()
		})
		.where(eq(schema.plans.id, planId))
		.returning();

	// A plan change moves every tenant on it — drop the whole cache, not one tenant's.
	invalidateEntitlements();
	await audit(null, 'plan.updated', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'plan', id: planId }, {
		code: before.code,
		before: { name: before.name, isActive: before.isActive, entitlements: before.entitlements },
		after: { name: after.name, isActive: after.isActive, entitlements: after.entitlements }
	});
	return after;
}

/* --------------------------------------------------------- tenants ------- */

/** Everything the Control Center shows for one tenant, in a single call. */
export async function tenantControlCenter(tenantId: string) {
	const rows = await db()
		.select({ tenant: schema.tenants, plan: schema.plans })
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.where(eq(schema.tenants.id, tenantId))
		.limit(1);
	const row = rows[0];
	if (!row) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');

	const [entitlements, usage, subscription, connections, plans, counts, recentErrors, recentAudit] = await Promise.all([
		effectiveEntitlements(tenantId),
		usageSummary(tenantId),
		db()
			.select({ subscription: schema.subscriptions, plan: schema.plans })
			.from(schema.subscriptions)
			.innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
			.where(eq(schema.subscriptions.tenantId, tenantId))
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1),
		db().select().from(schema.whatsappConnections).where(eq(schema.whatsappConnections.tenantId, tenantId)),
		listPlans(),
		db().execute(sql`
			select
				(select count(*)::int from tenant_memberships m where m.tenant_id = ${tenantId}::uuid) as members,
				(select count(*)::int from api_keys k where k.tenant_id = ${tenantId}::uuid and k.status = 'ACTIVE') as api_keys,
				(select count(*)::int from forms f where f.tenant_id = ${tenantId}::uuid) as forms,
				(select count(*)::int from webhook_endpoints e where e.tenant_id = ${tenantId}::uuid) as webhooks,
				(select count(*)::int from whatsapp_templates t where t.tenant_id = ${tenantId}::uuid) as templates,
				(select count(*)::int from customers c where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null) as customers,
				(select count(*)::int from booking_requests b where b.tenant_id = ${tenantId}::uuid) as booking_requests,
				(select count(*)::int from orders o where o.tenant_id = ${tenantId}::uuid) as orders
		`),
		db().execute(sql`
			select 'webhook' as kind, wd.event as detail, wd.error_message as message, wd.created_at
			from webhook_deliveries wd where wd.tenant_id = ${tenantId}::uuid and wd.status = 'DEAD'
			union all
			select 'payment', p.reference, coalesce(p.failure_message, p.failure_code), p.created_at
			from payments p where p.tenant_id = ${tenantId}::uuid and p.status = 'FAILED'
			union all
			select 'whatsapp', m.to_address, coalesce(m.error_message, m.error_code), m.created_at
			from messages m where m.tenant_id = ${tenantId}::uuid and m.status = 'FAILED'
			order by created_at desc limit 10
		`),
		db()
			.select({ log: schema.auditLogs, user: schema.users })
			.from(schema.auditLogs)
			.leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
			.where(eq(schema.auditLogs.tenantId, tenantId))
			.orderBy(desc(schema.auditLogs.createdAt))
			.limit(15),
	]);

	// Sequential, not part of the fan-out above: the pool is a shared, finite resource
	// and this page already asks a lot of it at once.
	const members = await db()
		.select({
			email: schema.users.email,
			fullName: schema.users.fullName,
			role: schema.tenantMemberships.role,
			emailVerifiedAt: schema.users.emailVerifiedAt,
			lastLoginAt: schema.users.lastLoginAt
		})
		.from(schema.tenantMemberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
		.where(eq(schema.tenantMemberships.tenantId, tenantId))
		.orderBy(schema.tenantMemberships.createdAt);

	return {
		tenant: row.tenant,
		plan: row.plan,
		plans,
		// Serializable summary only — TenantEntitlements carries a resolver function
		// that cannot cross the server→client boundary.
		entitlements: {
			planCode: entitlements.planCode,
			planName: entitlements.planName,
			tenantStatus: entitlements.tenantStatus,
			subscriptionStatus: entitlements.subscriptionStatus
		},
		entitlementRows: ENTITLEMENTS.map((definition) => entitlements.resolved[definition.key]),
		usage,
		subscription: subscription[0] ?? null,
		connections,
		counts: (counts as unknown as Array<Record<string, number>>)[0] ?? {},
		recentErrors: recentErrors as unknown as Array<Record<string, unknown>>,
		recentAudit,
		members,
		owner: members.find((m) => m.role === 'OWNER') ?? null,
		industryLabel: row.tenant.industry ? industryLabel(row.tenant.industry) : null
	};
}

export async function setTenantStatus(
	tenantId: string,
	status: schema.Tenant['status'],
	actor: AdminActor,
	reason?: string
) {
	const before = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
	if (!before) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');

	const [after] = await db()
		.update(schema.tenants)
		.set({ status, updatedAt: new Date() })
		.where(eq(schema.tenants.id, tenantId))
		.returning();
	invalidateEntitlements(tenantId);

	await audit(
		tenantId,
		status === 'SUSPENDED' ? 'tenant.suspended' : 'tenant.reactivated',
		{ type: 'user', userId: actor.userId, requestId: actor.requestId },
		{ type: 'tenant', id: tenantId },
		{ before: before.status, after: status, reason: reason ?? null }
	);
	return after;
}

export async function changeTenantPlan(tenantId: string, planId: string, actor: AdminActor) {
	const before = (
		await db()
			.select({ tenant: schema.tenants, plan: schema.plans })
			.from(schema.tenants)
			.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
			.where(eq(schema.tenants.id, tenantId))
			.limit(1)
	)[0];
	if (!before) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');
	const plan = (await db().select().from(schema.plans).where(eq(schema.plans.id, planId)).limit(1))[0];
	if (!plan) throw new AppError('NOT_FOUND', 'Plan not found.');

	await db().update(schema.tenants).set({ planId, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));

	// Keep the subscription pointing at the same plan, creating one if the tenant
	// predates subscriptions (imported tenants did).
	const existing = (
		await db()
			.select()
			.from(schema.subscriptions)
			.where(eq(schema.subscriptions.tenantId, tenantId))
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
	)[0];
	if (existing) {
		await db().update(schema.subscriptions).set({ planId, updatedAt: new Date() }).where(eq(schema.subscriptions.id, existing.id));
	} else {
		const periodEnd = new Date();
		periodEnd.setMonth(periodEnd.getMonth() + 1);
		await db().insert(schema.subscriptions).values({ tenantId, planId, status: 'ACTIVE', currentPeriodEnd: periodEnd });
	}

	invalidateEntitlements(tenantId);
	await audit(tenantId, 'plan.changed', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'tenant', id: tenantId }, {
		before: before.plan?.code ?? null,
		after: plan.code
	});
	return plan;
}

export async function updateSubscription(
	tenantId: string,
	patch: { status?: schema.Subscription['status']; extendDays?: number },
	actor: AdminActor
) {
	const existing = (
		await db()
			.select()
			.from(schema.subscriptions)
			.where(eq(schema.subscriptions.tenantId, tenantId))
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
	)[0];
	if (!existing) throw new AppError('NOT_FOUND', 'This tenant has no subscription.');

	const nextEnd = patch.extendDays
		? new Date(new Date(existing.currentPeriodEnd).getTime() + patch.extendDays * 86_400_000)
		: existing.currentPeriodEnd;

	const [after] = await db()
		.update(schema.subscriptions)
		.set({
			...(patch.status ? { status: patch.status } : {}),
			currentPeriodEnd: nextEnd,
			updatedAt: new Date()
		})
		.where(eq(schema.subscriptions.id, existing.id))
		.returning();

	invalidateEntitlements(tenantId);
	await audit(tenantId, 'subscription.modified', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'subscription', id: existing.id }, {
		before: { status: existing.status, periodEnd: existing.currentPeriodEnd },
		after: { status: after.status, periodEnd: after.currentPeriodEnd }
	});
	return after;
}

/* ------------------------------------------------------- overrides ------- */

export async function setEntitlementOverride(tenantId: string, key: string, value: EntitlementValue, actor: AdminActor) {
	const definition = entitlementDefinition(key);
	if (!definition) throw new AppError('VALIDATION_ERROR', `Unknown entitlement: ${key}`);
	const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');

	const normalised = definition.kind === 'boolean' ? value === true : Math.max(0, Number(value) || 0);
	const before = (tenant.entitlementOverrides ?? {}) as Record<string, EntitlementValue>;
	const overrides = { ...before, [key]: normalised };

	await db().update(schema.tenants).set({ entitlementOverrides: overrides, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
	invalidateEntitlements(tenantId);
	await audit(tenantId, 'entitlement.overridden', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'tenant', id: tenantId }, {
		key,
		before: before[key] ?? null,
		after: normalised
	});
}

/** Remove an override so the key inherits from the plan again. */
export async function clearEntitlementOverride(tenantId: string, key: string, actor: AdminActor) {
	const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');
	const before = (tenant.entitlementOverrides ?? {}) as Record<string, EntitlementValue>;
	if (!(key in before)) return;
	const overrides = { ...before };
	delete overrides[key];

	await db().update(schema.tenants).set({ entitlementOverrides: overrides, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
	invalidateEntitlements(tenantId);
	await audit(tenantId, 'entitlement.override_removed', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'tenant', id: tenantId }, {
		key,
		before: before[key] ?? null
	});
}

/* ------------------------------------------------- whatsapp operations --- */

/** Disable a connection from the admin side. Never exposes or logs credentials. */
export async function disableConnection(connectionId: string, actor: AdminActor, reason?: string) {
	const connection = (
		await db().select().from(schema.whatsappConnections).where(eq(schema.whatsappConnections.id, connectionId)).limit(1)
	)[0];
	if (!connection) throw new AppError('NOT_FOUND', 'Connection not found.');

	await db()
		.update(schema.whatsappConnections)
		.set({ status: 'DISCONNECTED', disconnectedAt: new Date(), updatedAt: new Date() })
		.where(eq(schema.whatsappConnections.id, connectionId));

	await audit(connection.tenantId, 'whatsapp.disconnected', { type: 'user', userId: actor.userId, requestId: actor.requestId }, { type: 'whatsapp_connection', id: connectionId }, {
		phoneNumberId: connection.phoneNumberId,
		reason: reason ?? 'Disabled by platform admin'
	});
}

/** Connection health for the admin view — status and timestamps only, never tokens. */
export async function connectionHealth(connectionId: string) {
	const rows = await db()
		.select({ connection: schema.whatsappConnections, tenant: schema.tenants })
		.from(schema.whatsappConnections)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.whatsappConnections.tenantId))
		.where(eq(schema.whatsappConnections.id, connectionId))
		.limit(1);
	const row = rows[0];
	if (!row) throw new AppError('NOT_FOUND', 'Connection not found.');

	const [templates, recentMessages] = await Promise.all([
		db().execute(sql`
			select count(*)::int as total,
				count(*) filter (where status = 'APPROVED')::int as approved,
				max(last_synced_at) as last_synced
			from whatsapp_templates where tenant_id = ${row.tenant.id}::uuid
		`),
		db().execute(sql`
			select count(*) filter (where direction = 'OUTBOUND' and created_at > now() - interval '7 days')::int as out_7d,
				count(*) filter (where direction = 'INBOUND' and created_at > now() - interval '7 days')::int as in_7d,
				count(*) filter (where status = 'FAILED' and created_at > now() - interval '7 days')::int as failed_7d
			from messages where tenant_id = ${row.tenant.id}::uuid
		`)
	]);

	return {
		connection: row.connection,
		tenant: row.tenant,
		templates: (templates as unknown as Array<Record<string, unknown>>)[0] ?? {},
		messages: (recentMessages as unknown as Array<Record<string, number>>)[0] ?? {}
	};
}
