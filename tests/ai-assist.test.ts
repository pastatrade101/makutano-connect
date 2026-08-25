// AI assist — the rails that matter more than the model's cleverness:
// the draft is sanitised before a human ever sees it, spend is metered, the plan
// gates access, and a tenant's data cannot reach another tenant's prompt.
//
// No test here calls Claude. The model is the one part we cannot assert on; what we
// CAN assert is that nothing it returns is trusted blindly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liftLimits, provisionTestTenant } from './support';
import { normalizeDraft } from '../src/lib/server/ai/extract-order';
import { estimateCostUsd } from '../src/lib/server/ai/client';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

describe('extraction output is never trusted as-is', () => {
	it('keeps a clean draft intact', () => {
		const draft = normalizeDraft({
			isOrder: true,
			confidence: 'high',
			items: [{ title: 'Fresh Fish', quantity: 3, unit: 'KG' }],
			deliveryMethod: 'DELIVERY',
			deliveryLocation: 'Mbezi',
			whenText: 'kesho',
			notes: null,
			missing: []
		});
		expect(draft).toMatchObject({
			isOrder: true,
			confidence: 'high',
			items: [{ title: 'Fresh Fish', quantity: 3, unit: 'KG' }],
			deliveryMethod: 'DELIVERY',
			whenText: 'kesho'
		});
	});

	it('refuses quantities that would create free or negative orders', () => {
		const cases = [0, -5, Number.NaN, 1e9];
		for (const quantity of cases) {
			const draft = normalizeDraft({ isOrder: true, items: [{ title: 'Fish', quantity, unit: null }] } as never);
			// 1 is the safe default: a human corrects it in one tap, whereas 0 books a
			// free order and a negative one looks like a refund.
			expect(draft.items[0].quantity).toBe(1);
		}
		const fine = normalizeDraft({ isOrder: true, items: [{ title: 'Fish', quantity: 2.6, unit: null }] } as never);
		expect(fine.items[0].quantity).toBe(3);
	});

	it('an "order" with no items is not an order, whatever the model claimed', () => {
		expect(normalizeDraft({ isOrder: true, items: [] } as never).isOrder).toBe(false);
		expect(normalizeDraft({ isOrder: true, items: [{ title: '   ', quantity: 1, unit: null }] } as never).isOrder).toBe(
			false
		);
	});

	it('defaults to low confidence and caps every free-text field', () => {
		const draft = normalizeDraft({
			isOrder: true,
			confidence: 'certain' as never,
			items: Array.from({ length: 30 }, () => ({ title: 'x'.repeat(500), quantity: 1, unit: 'y'.repeat(100) })),
			deliveryLocation: 'z'.repeat(5000),
			notes: 'n'.repeat(5000),
			missing: Array.from({ length: 20 }, () => 'm'.repeat(500))
		} as never);
		expect(draft.confidence).toBe('low'); // unknown value must not pass through
		expect(draft.items).toHaveLength(10);
		expect(draft.items[0].title.length).toBeLessThanOrEqual(300);
		expect(draft.items[0].unit!.length).toBeLessThanOrEqual(40);
		expect(draft.deliveryLocation!.length).toBeLessThanOrEqual(300);
		expect(draft.notes!.length).toBeLessThanOrEqual(1000);
		expect(draft.missing).toHaveLength(6);
	});

	it('never accepts a delivery method it did not recognise', () => {
		expect(
			normalizeDraft({
				isOrder: true,
				items: [{ title: 'a', quantity: 1, unit: null }],
				deliveryMethod: 'COURIER'
			} as never).deliveryMethod
		).toBeNull();
	});

	it('survives a null or malformed response without throwing', () => {
		expect(normalizeDraft(null).isOrder).toBe(false);
		expect(normalizeDraft({} as never).items).toEqual([]);
	});
});

describe('cost estimation', () => {
	it('prices a known model from real token counts', () => {
		// 1M input + 1M output on Opus 5 list price = $5 + $25.
		const cost = estimateCostUsd('claude-opus-5', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0
		});
		expect(cost).toBeCloseTo(30, 5);
	});

	it('prices cache reads at a tenth of input, and stays at zero for unknown models', () => {
		const cached = estimateCostUsd('claude-opus-5', {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 1_000_000,
			cacheWriteTokens: 0
		});
		expect(cached).toBeCloseTo(0.5, 5);
		// An unpriced model reports 0 rather than a number we invented.
		expect(
			estimateCostUsd('some-future-model', {
				inputTokens: 1_000_000,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			})
		).toBe(0);
	});
});

suite('AI metering and gating', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		usage: typeof import('../src/lib/server/ai/usage');
		entitlements: typeof import('../src/lib/server/entitlements');
	};
	let tenantId: string;
	const stamp = Date.now();

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			usage: await import('../src/lib/server/ai/usage'),
			entitlements: await import('../src/lib/server/entitlements')
		};
		tenantId = (await provisionTestTenant({ name: 'AI Shop', slug: `test-ai-${stamp}` })).id;
		await liftLimits(tenantId);
	}, 120_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
		await ctx.db.closeDb();
	});

	async function setEntitlements(overrides: Record<string, boolean | number>) {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db().update(schema.tenants).set({ entitlementOverrides: overrides }).where(eq(schema.tenants.id, tenantId));
		ctx.entitlements.invalidateEntitlements(tenantId);
	}

	it('refuses when the plan does not include AI assist', async () => {
		await setEntitlements({ 'ai.enabled': false });
		await expect(ctx.usage.assertAiAllowed(tenantId)).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });
	});

	it('allows an entitled tenant and reports what remains', async () => {
		await setEntitlements({ 'ai.enabled': true, 'ai.maxMonthlyRequests': 3 });
		const allowance = await ctx.usage.assertAiAllowed(tenantId);
		expect(allowance).toMatchObject({ used: 0, limit: 3, remaining: 3 });
	});

	it('counts failed calls too, and stops at the monthly ceiling', async () => {
		await setEntitlements({ 'ai.enabled': true, 'ai.maxMonthlyRequests': 2 });
		const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
		await ctx.usage.recordAiUsage({ tenantId, feature: 'order_extraction', model: 'claude-opus-5', usage, ok: true });
		// A failing prompt still consumed an upstream request — if only successes
		// counted, a broken prompt could loop past any ceiling for free.
		await ctx.usage.recordAiUsage({ tenantId, feature: 'order_extraction', model: 'claude-opus-5', usage, ok: false });

		expect(await ctx.usage.aiRequestsThisMonth(tenantId)).toBe(2);
		await expect(ctx.usage.assertAiAllowed(tenantId)).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT_REACHED' });

		// 0 means unlimited, exactly like every other numeric entitlement.
		await setEntitlements({ 'ai.enabled': true, 'ai.maxMonthlyRequests': 0 });
		await expect(ctx.usage.assertAiAllowed(tenantId)).resolves.toMatchObject({ remaining: null });
	}, 60_000);

	it('records sub-cent spend instead of rounding it away to zero', async () => {
		const summary = await ctx.usage.aiUsageSummary(tenantId);
		expect(summary.requests).toBeGreaterThanOrEqual(2);
		// 100 input + 50 output on Opus 5 ≈ $0.00175 — it must survive the round trip
		// through numeric(14,6) rather than becoming 0.00.
		expect(summary.costUsd).toBeGreaterThan(0);
		expect(summary.costUsd).toBeLessThan(0.01);
	}, 60_000);
});
