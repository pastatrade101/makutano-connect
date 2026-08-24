// Self-signup: provisioning integrity, and the boundaries a public signup form must
// never let anyone cross.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

if (!TEST_DB) {
	console.warn('\n⚠️  TEST_DATABASE_URL is not set — self-signup tests were SKIPPED.\n');
}

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	provisioning: typeof import('../src/lib/server/provisioning');
	signup: typeof import('../src/lib/server/signup');
	verification: typeof import('../src/lib/server/auth/verification');
	entitlements: typeof import('../src/lib/server/entitlements');
};

let ctx: Ctx;
const stamp = Date.now();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function newUser(suffix: string, verified = true) {
	const { db, schema } = ctx.db;
	const { user } = await ctx.signup.createAccount({
		email: `signup-${suffix}-${stamp}@example.com`,
		fullName: 'Test Owner',
		password: 'a-perfectly-fine-passphrase-9'
	});
	createdUserIds.push(user.id);
	if (verified) {
		const { eq } = await import('drizzle-orm');
		await db().update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
		return (await db().select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1))[0];
	}
	return user;
}

suite('self-signup', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			provisioning: await import('../src/lib/server/provisioning'),
			signup: await import('../src/lib/server/signup'),
			verification: await import('../src/lib/server/auth/verification'),
			entitlements: await import('../src/lib/server/entitlements')
		};
	});

	afterAll(async () => {
		if (!ctx?.db) return;
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		if (createdTenantIds.length) await db().delete(schema.tenants).where(inArray(schema.tenants.id, createdTenantIds));
		if (createdUserIds.length) await db().delete(schema.users).where(inArray(schema.users.id, createdUserIds));
		await ctx.db.closeDb();
	});

	/* ------------------------------------------------------------ passwords -- */

	it('rejects short, common and email-derived passwords', () => {
		const { checkPassword } = ctx.signup;
		expect(checkPassword('short').ok).toBe(false);
		expect(checkPassword('password123').ok).toBe(false);
		expect(checkPassword('amina-and-more', 'amina@example.com').ok).toBe(false);
		expect(checkPassword('aaaaaaaaaaaaaa').ok).toBe(false); // letters only, no second class
		expect(checkPassword('a-perfectly-fine-passphrase-9').ok).toBe(true);
	});

	/* --------------------------------------------------------- verification -- */

	it('verification tokens are single-use', async () => {
		const user = await newUser('token');
		const { token } = await ctx.verification.issueToken(user.id, 'EMAIL_VERIFICATION');
		expect((await ctx.verification.consumeToken(token, 'EMAIL_VERIFICATION'))?.id).toBe(user.id);
		// A replayed link must be inert, not merely unrecognised.
		expect(await ctx.verification.consumeToken(token, 'EMAIL_VERIFICATION')).toBeNull();
	});

	it('a token cannot be spent for a different purpose', async () => {
		const user = await newUser('purpose');
		const { token } = await ctx.verification.issueToken(user.id, 'EMAIL_VERIFICATION');
		expect(await ctx.verification.consumeToken(token, 'PASSWORD_RESET')).toBeNull();
	});

	it('issuing a new token retires the previous one', async () => {
		const user = await newUser('reissue');
		const first = await ctx.verification.issueToken(user.id, 'EMAIL_VERIFICATION');
		await ctx.verification.issueToken(user.id, 'EMAIL_VERIFICATION');
		expect(await ctx.verification.consumeToken(first.token, 'EMAIL_VERIFICATION')).toBeNull();
	});

	it('an expired token is refused', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const user = await newUser('expired');
		const { token } = await ctx.verification.issueToken(user.id, 'EMAIL_VERIFICATION');
		await db()
			.update(schema.verificationTokens)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(schema.verificationTokens.userId, user.id));
		expect(await ctx.verification.consumeToken(token, 'EMAIL_VERIFICATION')).toBeNull();
	});

	/* ------------------------------------------------------------- accounts -- */

	it('never creates a super admin, whatever the input', async () => {
		const user = await newUser('privilege');
		expect(user.isSuperAdmin).toBe(false);
	});

	it('an existing verified address is reported as not-created, without leaking it', async () => {
		const user = await newUser('duplicate');
		const again = await ctx.signup.createAccount({
			email: user.email,
			fullName: 'Someone Else',
			password: 'another-fine-passphrase-77'
		});
		expect(again.created).toBe(false);
		expect(again.user.id).toBe(user.id);
		// The impostor's name and password must not have been written.
		expect(again.user.fullName).toBe('Test Owner');
	});

	/* --------------------------------------------------------- provisioning -- */

	it('provisions a self-service tenant with the owner, plan, subscription and usage period', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const user = await newUser('provision');

		const { tenant, reused } = await ctx.provisioning.provisionTenant({
			name: `Signup Co ${stamp}`,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: user.id },
			industry: 'RETAIL',
			capabilities: 'ORDERS',
			onboardingProfile: { primaryGoal: 'ORDERS', systemSource: 'CONNECT_MANUAL' },
			country: 'TZ',
			actor: { type: 'user', userId: user.id }
		});
		createdTenantIds.push(tenant.id);

		expect(reused).toBe(false);
		expect(tenant.provisioningSource).toBe('SELF_SERVICE');
		expect(tenant.planId).toBeTruthy();
		expect(tenant.settings).toMatchObject({
			capabilities: 'ORDERS',
			onboardingGoal: 'ORDERS',
			systemSource: 'CONNECT_MANUAL'
		});
		// Trials are real: a trial tenant is TRIAL, never silently ACTIVE-as-if-paid.
		expect(['TRIAL', 'PENDING']).toContain(tenant.status);

		const membership = (
			await db().select().from(schema.tenantMemberships).where(eq(schema.tenantMemberships.tenantId, tenant.id))
		)[0];
		expect(membership.role).toBe('OWNER');
		expect(membership.userId).toBe(user.id);

		const usage = await db().select().from(schema.usageRecords).where(eq(schema.usageRecords.tenantId, tenant.id));
		expect(usage.length).toBeGreaterThan(0);

		const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, tenant.id));
		const actions = audits.map((a) => a.action);
		expect(actions).toContain('tenant.provisioned');
		expect(actions).toContain('plan.selected');
	});

	it('describes legacy plans from their stored limits without inventing unlimited access', () => {
		const highlights = ctx.provisioning.planHighlights(
			{},
			{ whatsapp_outbound_per_month: 1000, booking_requests_per_month: 200, members: 3 },
			{ whatsapp: true, multiple_numbers: false, quotations: true, payments: false, client_webhooks: false }
		);

		expect(highlights).toEqual([
			'1 WhatsApp number · 1,000 outbound / month',
			'Up to 3 team members',
			'200 enquiries / month',
			'Quotations'
		]);
		expect(highlights.join(' ')).not.toContain('Unlimited');
	});

	it('is idempotent — a resubmitted signup resumes the same tenant', async () => {
		const user = await newUser('idempotent');
		const input = {
			name: `Idempotent Co ${stamp}`,
			source: 'SELF_SERVICE' as const,
			owner: { kind: 'existing' as const, userId: user.id },
			actor: { type: 'user' as const, userId: user.id }
		};
		const first = await ctx.provisioning.provisionTenant(input);
		createdTenantIds.push(first.tenant.id);

		// Two simultaneous submits — the advisory lock must serialise them.
		const [a, b] = await Promise.all([
			ctx.provisioning.provisionTenant(input),
			ctx.provisioning.provisionTenant(input)
		]);
		expect(a.tenant.id).toBe(first.tenant.id);
		expect(b.tenant.id).toBe(first.tenant.id);
		expect(a.reused).toBe(true);
		expect(b.reused).toBe(true);
	});

	it('disambiguates a colliding business name instead of failing', async () => {
		const one = await newUser('slug-one');
		const two = await newUser('slug-two');
		const name = `Same Name Ltd ${stamp}`;
		const a = await ctx.provisioning.provisionTenant({
			name,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: one.id },
			actor: { type: 'user', userId: one.id }
		});
		const b = await ctx.provisioning.provisionTenant({
			name,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: two.id },
			actor: { type: 'user', userId: two.id }
		});
		createdTenantIds.push(a.tenant.id, b.tenant.id);
		expect(a.tenant.slug).not.toBe(b.tenant.slug);
	});

	it('a tampered planId cannot grant a plan that is not offered', async () => {
		const user = await newUser('tamper');
		// A well-formed but unknown plan id: provisioning must fall back to the default
		// plan rather than trusting the client's number.
		const { tenant } = await ctx.provisioning.provisionTenant({
			name: `Tamper Co ${stamp}`,
			planId: crypto.randomUUID(),
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: user.id },
			actor: { type: 'user', userId: user.id }
		});
		createdTenantIds.push(tenant.id);

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const plan = (await db().select().from(schema.plans).where(eq(schema.plans.id, tenant.planId!)).limit(1))[0];
		expect(plan.code).toBe(ctx.provisioning.defaultSignupPlanCode());
	});

	it('an inactive plan is never selectable at signup', async () => {
		const plans = await ctx.provisioning.selectablePlans();
		expect(plans.every((p) => p.code !== 'ENTERPRISE')).toBe(true);
		expect(plans.length).toBeGreaterThan(0);
	});

	it('provisioning is atomic — a failure leaves no tenant behind', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const slug = `atomic-${stamp}`;
		// An admin provision with an explicit, already-taken slug is rejected. The tenant
		// insert has already run inside the transaction at that point, so if the rollback
		// did not work a ghost row would remain.
		const first = await ctx.provisioning.provisionTenant({
			name: 'Atomic One',
			slug,
			source: 'ADMIN',
			actor: { type: 'system' }
		});
		createdTenantIds.push(first.tenant.id);

		await expect(
			ctx.provisioning.provisionTenant({ name: 'Atomic Two', slug, source: 'ADMIN', actor: { type: 'system' } })
		).rejects.toThrow();

		const rows = await db().select().from(schema.tenants).where(eq(schema.tenants.slug, slug));
		expect(rows.length).toBe(1);
		expect(rows[0].id).toBe(first.tenant.id);
	});

	/* ------------------------------------------------------------- lifecycle -- */

	it('a PENDING tenant is blocked from writing, with its own message', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const user = await newUser('pending');
		const { tenant } = await ctx.provisioning.provisionTenant({
			name: `Pending Co ${stamp}`,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: user.id },
			actor: { type: 'user', userId: user.id }
		});
		createdTenantIds.push(tenant.id);

		await db().update(schema.tenants).set({ status: 'PENDING' }).where(eq(schema.tenants.id, tenant.id));
		ctx.entitlements.invalidateEntitlements(tenant.id);

		await expect(ctx.entitlements.assertTenantActive(tenant.id)).rejects.toMatchObject({
			code: 'SUBSCRIPTION_INACTIVE'
		});
	});

	it('a trial tenant still has real entitlements and limits', async () => {
		const user = await newUser('trial');
		const { tenant } = await ctx.provisioning.provisionTenant({
			name: `Trial Co ${stamp}`,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: user.id },
			actor: { type: 'user', userId: user.id }
		});
		createdTenantIds.push(tenant.id);

		const resolved = await ctx.entitlements.effectiveEntitlements(tenant.id);
		expect(resolved.planCode).toBeTruthy();
		// Not an unlimited free-for-all: at least one numeric cap is actually in force.
		const caps = Object.values(resolved.resolved).filter((r) => typeof r.effective === 'number');
		expect(caps.some((c) => Number(c.effective) > 0)).toBe(true);
	});

	/* ----------------------------------------------------------------- stage -- */

	it('routes users to the stage their stored state actually implies', async () => {
		const unverified = await newUser('stage-unverified', false);
		expect(await ctx.signup.stageForUser(unverified)).toBe('VERIFY_EMAIL');

		const verified = await newUser('stage-verified');
		expect(await ctx.signup.stageForUser(verified)).toBe('BUSINESS');

		const { tenant } = await ctx.provisioning.provisionTenant({
			name: `Stage Co ${stamp}`,
			source: 'SELF_SERVICE',
			owner: { kind: 'existing', userId: verified.id },
			actor: { type: 'user', userId: verified.id }
		});
		createdTenantIds.push(tenant.id);
		expect(await ctx.signup.stageForUser(verified)).toBe('READY');
	});

	it('a member of an existing tenant is never blocked by verification', async () => {
		// Admin-provisioned members predate self-signup; the gate must not lock them out.
		const user = await newUser('legacy-member', false);
		const { tenant } = await ctx.provisioning.provisionTenant({
			name: `Legacy Co ${stamp}`,
			source: 'ADMIN',
			owner: { kind: 'existing', userId: user.id },
			actor: { type: 'system' }
		});
		createdTenantIds.push(tenant.id);
		expect(await ctx.signup.stageForUser(user)).toBe('READY');
	});
});
