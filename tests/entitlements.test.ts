// Entitlements, enforcement and WhatsApp compliance.
//
// The property that matters most is the ORDER of the checks:
//   tenant active → plan permits → allowance left → compliance permits → send
// and that compliance can only ever be stricter than the plan.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

describe('compliance helpers (pure)', () => {
	it('recognises opt-out and opt-in keywords, ignoring ordinary messages', async () => {
		const { isOptOutMessage, isOptInMessage } = await import('../src/lib/server/whatsapp/compliance');
		expect(isOptOutMessage('STOP')).toBe(true);
		expect(isOptOutMessage('  stop  ')).toBe(true);
		expect(isOptOutMessage('Simama')).toBe(true);
		expect(isOptOutMessage('please stop by tomorrow')).toBe(false); // not a bare keyword
		expect(isOptInMessage('START')).toBe(true);
	});

	it('computes the 24-hour service window', async () => {
		const { serviceWindowOpen } = await import('../src/lib/server/whatsapp/compliance');
		expect(serviceWindowOpen(new Date())).toBe(true);
		expect(serviceWindowOpen(new Date(Date.now() - 23 * 3600_000))).toBe(true);
		expect(serviceWindowOpen(new Date(Date.now() - 25 * 3600_000))).toBe(false);
		expect(serviceWindowOpen(null)).toBe(false);
	});
});

suite('entitlements + enforcement', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		tenants: typeof import('../src/lib/server/tenants');
		ent: typeof import('../src/lib/server/entitlements');
		admin: typeof import('../src/lib/server/admin/control-plane');
		orders: typeof import('../src/lib/server/orders');
		requests: typeof import('../src/lib/server/booking-requests');
		billing: typeof import('../src/lib/server/billing');
		compliance: typeof import('../src/lib/server/whatsapp/compliance');
		customers: typeof import('../src/lib/server/customers');
	};
	let tenantId: string;
	let adminUserId: string;
	let starterPlanId: string;
	const stamp = `${Date.now()}-ent`;

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			tenants: await import('../src/lib/server/tenants'),
			ent: await import('../src/lib/server/entitlements'),
			admin: await import('../src/lib/server/admin/control-plane'),
			orders: await import('../src/lib/server/orders'),
			requests: await import('../src/lib/server/booking-requests'),
			billing: await import('../src/lib/server/billing'),
			compliance: await import('../src/lib/server/whatsapp/compliance'),
			customers: await import('../src/lib/server/customers')
		};
		const tenant = await provisionTestTenant({ name: 'Entitlement Co', slug: `ent-${stamp}`, planCode: 'STARTER' });
		tenantId = tenant.id;
		const { db, schema } = ctx.db;
		const [user] = await db()
			.insert(schema.users)
			.values({ email: `ent-admin-${stamp}@example.com`, fullName: 'Ent Admin', isSuperAdmin: true })
			.returning();
		adminUserId = user.id;
		starterPlanId = (await db().select().from(schema.plans).where(schema.plans.code ? undefined : undefined).limit(50)).find((p) => p.code === 'STARTER')!.id;
	}, 60_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
		await db().delete(schema.users).where(eq(schema.users.id, adminUserId));
		await ctx.db.closeDb();
	});

	it('resolves plan defaults when no override exists', async () => {
		const ent = await ctx.ent.effectiveEntitlements(tenantId);
		expect(ent.planCode).toBe('STARTER');
		expect(ent.resolved['whatsapp.enabled'].effective).toBe(true);
		expect(ent.resolved['whatsapp.enabled'].override).toBeNull();
		// STARTER historically had client_webhooks=false — that must have carried across.
		expect(ent.resolved['webhooks.enabled'].effective).toBe(false);
	});

	it('an override wins over the plan, and resetting restores the plan default', async () => {
		await ctx.admin.setEntitlementOverride(tenantId, 'webhooks.enabled', true, { userId: adminUserId });
		let ent = await ctx.ent.effectiveEntitlements(tenantId);
		expect(ent.resolved['webhooks.enabled'].planValue).toBe(false);
		expect(ent.resolved['webhooks.enabled'].override).toBe(true);
		expect(ent.resolved['webhooks.enabled'].effective).toBe(true);

		await ctx.admin.clearEntitlementOverride(tenantId, 'webhooks.enabled', { userId: adminUserId });
		ent = await ctx.ent.effectiveEntitlements(tenantId);
		expect(ent.resolved['webhooks.enabled'].override).toBeNull();
		expect(ent.resolved['webhooks.enabled'].effective).toBe(false);
	});

	it('stores ONLY overridden keys, never a copy of the plan', async () => {
		await ctx.admin.setEntitlementOverride(tenantId, 'orders.maxPerMonth', 7, { userId: adminUserId });
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [tenant] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
		expect(Object.keys(tenant.entitlementOverrides as object)).toEqual(['orders.maxPerMonth']);
		await ctx.admin.clearEntitlementOverride(tenantId, 'orders.maxPerMonth', { userId: adminUserId });
	});

	it('blocks a disabled feature server-side', async () => {
		await ctx.admin.setEntitlementOverride(tenantId, 'orders.enabled', false, { userId: adminUserId });
		await expect(
			ctx.orders.createOrder(tenantId, { items: [{ title: 'Blocked', unitPrice: '1.00' }] })
		).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });

		await ctx.admin.setEntitlementOverride(tenantId, 'orders.enabled', true, { userId: adminUserId });
		await expect(ctx.orders.createOrder(tenantId, { items: [{ title: 'Allowed', unitPrice: '1.00' }] })).resolves.toBeTruthy();
	});

	it('blocks at the monthly limit with structured metadata, and 0 means unlimited', async () => {
		// One order already exists from the previous test; cap at exactly that.
		const used = await ctx.billing.usageFor(tenantId, 'orders');
		await ctx.admin.setEntitlementOverride(tenantId, 'orders.maxPerMonth', used, { userId: adminUserId });

		let captured: { code?: string; details?: Record<string, unknown> } = {};
		try {
			await ctx.orders.createOrder(tenantId, { items: [{ title: 'Over limit', unitPrice: '1.00' }] });
		} catch (err) {
			captured = { code: (err as { code: string }).code, details: (err as { details: Record<string, unknown> }).details };
		}
		expect(captured.code).toBe('ENTITLEMENT_LIMIT_REACHED');
		expect(captured.details).toMatchObject({ feature: 'orders.maxPerMonth', limit: used });
		expect(Number(captured.details?.usage)).toBeGreaterThanOrEqual(used);

		// 0 = unlimited restores service immediately.
		await ctx.admin.setEntitlementOverride(tenantId, 'orders.maxPerMonth', 0, { userId: adminUserId });
		await expect(ctx.orders.createOrder(tenantId, { items: [{ title: 'Unlimited', unitPrice: '1.00' }] })).resolves.toBeTruthy();
		await ctx.admin.clearEntitlementOverride(tenantId, 'orders.maxPerMonth', { userId: adminUserId });
	});

	it('suspension blocks writes across domains but never reads', async () => {
		await ctx.admin.setTenantStatus(tenantId, 'SUSPENDED', { userId: adminUserId }, 'test');

		await expect(ctx.orders.createOrder(tenantId, { items: [{ title: 'X', unitPrice: '1.00' }] })).rejects.toMatchObject({
			code: 'TENANT_SUSPENDED'
		});
		await expect(
			ctx.requests.createBookingRequest(tenantId, { customer: { firstName: 'Blocked' }, sendAcknowledgement: false })
		).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });

		// Reads keep working — the admin must still be able to inspect the tenant.
		await expect(ctx.ent.effectiveEntitlements(tenantId)).resolves.toBeTruthy();
		await expect(ctx.admin.tenantControlCenter(tenantId)).resolves.toBeTruthy();

		await ctx.admin.setTenantStatus(tenantId, 'ACTIVE', { userId: adminUserId });
		await expect(ctx.orders.createOrder(tenantId, { items: [{ title: 'Back', unitPrice: '1.00' }] })).resolves.toBeTruthy();
	});

	it('a plan change moves the tenant without touching its overrides', async () => {
		await ctx.admin.setEntitlementOverride(tenantId, 'whatsapp.maxNumbers', 9, { userId: adminUserId });
		const { db, schema } = ctx.db;
		const plans = await db().select().from(schema.plans);
		const pro = plans.find((p) => p.code === 'PRO')!;
		await ctx.admin.changeTenantPlan(tenantId, pro.id, { userId: adminUserId });

		const ent = await ctx.ent.effectiveEntitlements(tenantId);
		expect(ent.planCode).toBe('PRO');
		expect(ent.resolved['whatsapp.maxNumbers'].override).toBe(9); // override survives
		expect(ent.resolved['whatsapp.maxOutboundPerMonth'].effective).toBe(50000); // plan default moved
		await ctx.admin.clearEntitlementOverride(tenantId, 'whatsapp.maxNumbers', { userId: adminUserId });
		await ctx.admin.changeTenantPlan(tenantId, starterPlanId, { userId: adminUserId });
	});

	it('records an audit row for every administrative change', async () => {
		const { db, schema } = ctx.db;
		const { and, eq, inArray } = await import('drizzle-orm');
		const rows = await db()
			.select()
			.from(schema.auditLogs)
			.where(
				and(
					eq(schema.auditLogs.tenantId, tenantId),
					inArray(schema.auditLogs.action, ['entitlement.overridden', 'entitlement.override_removed', 'tenant.suspended', 'tenant.reactivated', 'plan.changed'])
				)
			);
		const actions = new Set(rows.map((r) => r.action));
		expect(actions.has('entitlement.overridden')).toBe(true);
		expect(actions.has('entitlement.override_removed')).toBe(true);
		expect(actions.has('tenant.suspended')).toBe(true);
		expect(actions.has('tenant.reactivated')).toBe(true);
		expect(actions.has('plan.changed')).toBe(true);
		// Before/after state is captured, and no secret ever is.
		const override = rows.find((r) => r.action === 'entitlement.overridden')!;
		expect(override.metadata).toHaveProperty('key');
		expect(JSON.stringify(rows)).not.toMatch(/mk_live_|EAAG|scrypt\$/);
	});

	/* ------------------------------------------- compliance beats the plan --- */

	it('compliance blocks an opted-out customer even on an unlimited plan', async () => {
		const phone = `2557${stamp.replace(/\D/g, '').slice(-8)}`;
		const customer = await ctx.customers.findOrCreateCustomer(tenantId, { firstName: 'OptOut', whatsappPhone: phone });
		await ctx.compliance.applyInboundCompliance({ tenantId, customerId: customer.id, text: 'STOP' });

		// Maximum entitlements — must not help.
		await ctx.admin.setEntitlementOverride(tenantId, 'whatsapp.enabled', true, { userId: adminUserId });
		await ctx.admin.setEntitlementOverride(tenantId, 'whatsapp.maxOutboundPerMonth', 0, { userId: adminUserId });

		await expect(
			ctx.compliance.assertSendCompliant({ tenantId, to: phone, content: { type: 'text', text: 'hello' } })
		).rejects.toMatchObject({ code: 'WHATSAPP_POLICY_BLOCKED' });

		// Opting back in restores it, and the window is open again.
		await ctx.compliance.applyInboundCompliance({ tenantId, customerId: customer.id, text: 'START' });
		await expect(
			ctx.compliance.assertSendCompliant({ tenantId, to: phone, content: { type: 'text', text: 'hello' } })
		).resolves.toBeUndefined();
	});

	it('free-form is refused outside the 24-hour window; a template is required', async () => {
		const phone = `2556${stamp.replace(/\D/g, '').slice(-8)}`;
		const customer = await ctx.customers.findOrCreateCustomer(tenantId, { firstName: 'Stale', whatsappPhone: phone });
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.customers)
			.set({ lastInboundAt: new Date(Date.now() - 48 * 3600_000) })
			.where(eq(schema.customers.id, customer.id));

		await expect(
			ctx.compliance.assertSendCompliant({ tenantId, to: phone, content: { type: 'text', text: 'late reply' } })
		).rejects.toMatchObject({ code: 'WHATSAPP_POLICY_BLOCKED' });

		// A template Connect has never seen is left to Meta to judge — not blocked here.
		await expect(
			ctx.compliance.assertSendCompliant({ tenantId, to: phone, content: { type: 'template', templateName: 'unknown_tpl', language: 'en' } })
		).resolves.toBeUndefined();
	});

	it('refuses a known template that Meta has not approved', async () => {
		const phone = `2555${stamp.replace(/\D/g, '').slice(-8)}`;
		await ctx.customers.findOrCreateCustomer(tenantId, { firstName: 'Tpl', whatsappPhone: phone });
		const { db, schema } = ctx.db;
		await db().insert(schema.whatsappTemplates).values({
			tenantId,
			name: `pending_tpl_${stamp.replace(/\D/g, '')}`,
			language: 'en',
			status: 'PENDING',
			bodyText: 'hi'
		});
		const name = `pending_tpl_${stamp.replace(/\D/g, '')}`;
		await expect(
			ctx.compliance.assertSendCompliant({ tenantId, to: phone, content: { type: 'template', templateName: name, language: 'en' } })
		).rejects.toMatchObject({ code: 'WHATSAPP_POLICY_BLOCKED' });
	});
});
