// Tour AI — the rails, not the model's cleverness (§45).
//
// The pure tests assert what Connect does with whatever the model returns: a budget
// never becomes a price, a past date is never accepted, impossible numbers never
// reach a consultant's screen. The database tests assert isolation, permissions,
// entitlements and metering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liftLimits, provisionTestTenant } from './support';
import { enquiryNotes, normalizeExtraction, type TripExtraction } from '../src/lib/server/ai/extract-enquiry';
import { aiActionsFor } from '../src/lib/server/ai/actions';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

/** A believable model response for a family safari — the base for the variants. */
const familySafari = (): Partial<TripExtraction> => ({
	intent: 'NEW_TRIP_ENQUIRY',
	confidence: 'HIGH',
	urgent: false,
	travellers: { total: 4, adults: 2, children: 2, childAges: [8, 12] },
	travel: {
		whenText: 'around 12 October',
		resolvedStartDate: null,
		durationDays: 7,
		destinations: ['Serengeti', 'Ngorongoro'],
		activities: ['Wildlife safari'],
		arrivalAirport: null,
		departureAirport: null
	},
	accommodation: 'MID_RANGE',
	budget: { amount: 2500, currency: 'USD', basis: 'PER_PERSON' },
	party: { honeymoon: false, family: true, group: false, solo: false, business: false },
	nationality: null,
	dietaryRequirements: null,
	mobilityRequirements: null,
	specialRequests: null,
	missing: ['What dates exactly?', 'Which airport will you arrive at?']
});

describe('trip extraction is validated, never trusted', () => {
	it('keeps a well-formed family enquiry intact', () => {
		const x = normalizeExtraction(familySafari());
		expect(x.intent).toBe('NEW_TRIP_ENQUIRY');
		expect(x.travellers).toMatchObject({ total: 4, adults: 2, children: 2, childAges: [8, 12] });
		expect(x.travel.destinations).toEqual(['Serengeti', 'Ngorongoro']);
		expect(x.accommodation).toBe('MID_RANGE');
		expect(x.budget).toMatchObject({ amount: 2500, currency: 'USD', basis: 'PER_PERSON' });
	});

	it('preserves the customer own words about timing instead of hardening them', () => {
		const x = normalizeExtraction(familySafari());
		expect(x.travel.whenText).toBe('around 12 October');
		expect(x.travel.resolvedStartDate).toBeNull();
	});

	it('refuses a resolved date in the past — that is a wrong-year guess, not a booking', () => {
		const base = familySafari();
		const x = normalizeExtraction({ ...base, travel: { ...base.travel!, resolvedStartDate: '2020-10-12' } });
		expect(x.travel.resolvedStartDate).toBeNull();

		const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
		const ok = normalizeExtraction({ ...base, travel: { ...base.travel!, resolvedStartDate: future } });
		expect(ok.travel.resolvedStartDate).toBe(future);
	});

	it('never lets a budget become a price', () => {
		const notes = enquiryNotes(normalizeExtraction(familySafari()));
		expect(notes).toContain('Customer’s stated budget'.replace('’', "'"));
		expect(notes).toContain('USD 2,500 per person');
		expect(notes).toContain('not a quoted price');
	});

	it('rejects impossible traveller counts, ages and budgets', () => {
		const x = normalizeExtraction({
			...familySafari(),
			travellers: { total: -4, adults: 0, children: 9999, childAges: [8, 45, -2, 12] },
			budget: { amount: -50, currency: 'DOLLARS', basis: 'WEEKLY' as never }
		});
		expect(x.travellers.total).toBeNull();
		expect(x.travellers.adults).toBeNull();
		expect(x.travellers.childAges).toEqual([8, 12]);
		expect(x.budget.amount).toBeNull();
		expect(x.budget.currency).toBeNull();
		expect(x.budget.basis).toBeNull();
	});

	it('derives a total from the parts rather than trusting a contradictory one', () => {
		const x = normalizeExtraction({
			...familySafari(),
			travellers: { total: null, adults: 2, children: 3, childAges: [] }
		});
		expect(x.travellers.total).toBe(5);
	});

	it('falls back to safe values for unknown intent, confidence and accommodation', () => {
		const x = normalizeExtraction({
			intent: 'BOOK_IT_NOW' as never,
			confidence: 'CERTAIN' as never,
			accommodation: 'PALATIAL' as never
		});
		expect(x.intent).toBe('OTHER');
		expect(x.confidence).toBe('LOW');
		expect(x.accommodation).toBeNull();
	});

	it('treats an empty or malformed response as nothing understood', () => {
		const x = normalizeExtraction(null);
		expect(x.intent).toBe('OTHER');
		expect(x.travellers.total).toBeNull();
		expect(x.travel.destinations).toEqual([]);
		expect(x.missing).toEqual([]);
	});

	it('marks change, cancellation and complaint threads as needing attention', () => {
		for (const intent of ['CHANGE_REQUEST', 'CANCELLATION_REQUEST', 'COMPLAINT'] as const) {
			expect(normalizeExtraction({ intent, urgent: false }).urgent).toBe(true);
		}
		expect(normalizeExtraction({ intent: 'GENERAL_QUESTION', urgent: false }).urgent).toBe(false);
		expect(normalizeExtraction({ intent: 'GENERAL_QUESTION', urgent: true }).urgent).toBe(true);
	});

	it('caps free text so a hostile message cannot flood the enquiry record', () => {
		const base = familySafari();
		const x = normalizeExtraction({
			...base,
			specialRequests: 'x'.repeat(9000),
			travel: { ...base.travel!, destinations: Array.from({ length: 50 }, () => 'D'.repeat(400)) },
			missing: Array.from({ length: 40 }, () => 'q'.repeat(400))
		});
		expect(x.specialRequests!.length).toBeLessThanOrEqual(1000);
		expect(x.travel.destinations).toHaveLength(12);
		expect(x.travel.destinations[0].length).toBeLessThanOrEqual(120);
		expect(x.missing).toHaveLength(6);
	});
});

describe('AI actions match the kind of business', () => {
	const all = { orders: true, enquiries: true };

	it('a tour operator is never offered Make order from this', () => {
		const keys = aiActionsFor('BOOKINGS', all).map((a) => a.key);
		expect(keys).toContain('enquiry');
		expect(keys).not.toContain('order');
		expect(aiActionsFor('BOOKINGS', all).find((a) => a.primary)?.key).toBe('enquiry');
	});

	it('a WhatsApp seller is never offered Create enquiry', () => {
		const keys = aiActionsFor('ORDERS', all).map((a) => a.key);
		expect(keys).toContain('order');
		expect(keys).not.toContain('enquiry');
	});

	it('a service business gets enquiries, and a hybrid gets both', () => {
		expect(aiActionsFor('SERVICE', all).map((a) => a.key)).toContain('enquiry');
		const hybrid = aiActionsFor('HYBRID', all).map((a) => a.key);
		expect(hybrid).toEqual(expect.arrayContaining(['enquiry', 'order']));
	});

	it('permission still decides: no domain write, no create action', () => {
		const keys = aiActionsFor('BOOKINGS', { orders: false, enquiries: false }).map((a) => a.key);
		expect(keys).not.toContain('enquiry');
		expect(keys).toEqual(expect.arrayContaining(['reply', 'summary']));
	});
});

suite('tour AI: isolation, permissions, entitlements, metering', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		enquiry: typeof import('../src/lib/server/ai/extract-enquiry');
		assist: typeof import('../src/lib/server/ai/assist');
		usage: typeof import('../src/lib/server/ai/usage');
		entitlements: typeof import('../src/lib/server/entitlements');
		perms: typeof import('../src/lib/server/auth/permissions');
	};
	let tenantA: string;
	let tenantB: string;
	let conversationA: string;
	let privateConversation: string;
	let ownerA: string;
	let agentA: string;
	const stamp = Date.now();

	async function setAi(tenantId: string, overrides: Record<string, boolean | number>) {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db().update(schema.tenants).set({ entitlementOverrides: overrides }).where(eq(schema.tenants.id, tenantId));
		ctx.entitlements.invalidateEntitlements(tenantId);
	}

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			enquiry: await import('../src/lib/server/ai/extract-enquiry'),
			assist: await import('../src/lib/server/ai/assist'),
			usage: await import('../src/lib/server/ai/usage'),
			entitlements: await import('../src/lib/server/entitlements'),
			perms: await import('../src/lib/server/auth/permissions')
		};
		tenantA = (await provisionTestTenant({ name: 'Safari A', slug: `test-tourai-${stamp}-a` })).id;
		tenantB = (await provisionTestTenant({ name: 'Safari B', slug: `test-tourai-${stamp}-b` })).id;
		await liftLimits(tenantA);
		await liftLimits(tenantB);

		const { db, schema } = ctx.db;
		const [owner] = await db()
			.insert(schema.users)
			.values({ email: `tourai-owner-${stamp}@example.com`, fullName: 'Owner', emailVerifiedAt: new Date() })
			.returning();
		const [agent] = await db()
			.insert(schema.users)
			.values({ email: `tourai-agent-${stamp}@example.com`, fullName: 'Agent', emailVerifiedAt: new Date() })
			.returning();
		ownerA = owner.id;
		agentA = agent.id;
		await db()
			.insert(schema.tenantMemberships)
			.values([
				{ tenantId: tenantA, userId: owner.id, role: 'OWNER', acceptedAt: new Date() },
				{ tenantId: tenantA, userId: agent.id, role: 'SALES', acceptedAt: new Date() }
			]);

		const [conv] = await db()
			.insert(schema.conversations)
			.values({ tenantId: tenantA, channel: 'WHATSAPP', externalId: '255700900777' })
			.returning();
		conversationA = conv.id;
		await db().insert(schema.messages).values({
			tenantId: tenantA,
			conversationId: conv.id,
			direction: 'INBOUND',
			type: 'TEXT',
			status: 'DELIVERED',
			body: 'Habari, tupo watu 5 tunataka safari Serengeti around October 20'
		});

		const [priv] = await db()
			.insert(schema.conversations)
			.values({ tenantId: tenantA, channel: 'WHATSAPP', externalId: '255700900888', visibility: 'PRIVATE' })
			.returning();
		privateConversation = priv.id;
		await db().insert(schema.messages).values({
			tenantId: tenantA,
			conversationId: priv.id,
			direction: 'INBOUND',
			type: 'TEXT',
			status: 'DELIVERED',
			body: 'Private thread the agent may not read'
		});

		await setAi(tenantA, { 'ai.enabled': true, 'ai.maxMonthlyRequests': 0 });
		await setAi(tenantB, { 'ai.enabled': true, 'ai.maxMonthlyRequests': 0 });
	}, 180_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { inArray, like } = await import('drizzle-orm');
		await db()
			.delete(schema.tenants)
			.where(inArray(schema.tenants.id, [tenantA, tenantB]));
		await db()
			.delete(schema.users)
			.where(like(schema.users.email, `tourai-%-${stamp}@example.com`));
		await ctx.db.closeDb();
	});

	const viewerOwner = () => ({ userId: ownerA, permissions: ctx.perms.permissionsForRole('OWNER') });
	const viewerAgent = () => ({ userId: agentA, permissions: ctx.perms.permissionsForRole('SALES') });

	it('tenant isolation: tenant B cannot read tenant A conversation through AI', async () => {
		await expect(
			ctx.enquiry.suggestEnquiry(tenantB, conversationA, viewerOwner(), { scope: 'conversation' })
		).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
		await expect(ctx.assist.suggestReply(tenantB, conversationA, viewerOwner())).rejects.toMatchObject({
			code: 'CONVERSATION_NOT_FOUND'
		});
		await expect(ctx.assist.summarizeConversation(tenantB, conversationA, viewerOwner())).rejects.toMatchObject({
			code: 'CONVERSATION_NOT_FOUND'
		});
	}, 60_000);

	it('a private conversation stays private — AI is not a way around it', async () => {
		await expect(
			ctx.enquiry.suggestEnquiry(tenantA, privateConversation, viewerAgent(), { scope: 'conversation' })
		).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
		await expect(ctx.assist.summarizeConversation(tenantA, privateConversation, viewerAgent())).rejects.toMatchObject({
			code: 'CONVERSATION_NOT_FOUND'
		});
	}, 60_000);

	it('refuses when the plan excludes AI, before any model call', async () => {
		await setAi(tenantA, { 'ai.enabled': false });
		await expect(
			ctx.enquiry.suggestEnquiry(tenantA, conversationA, viewerOwner(), { scope: 'conversation' })
		).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });
		await setAi(tenantA, { 'ai.enabled': true, 'ai.maxMonthlyRequests': 0 });
	}, 60_000);

	it('stops at the monthly ceiling', async () => {
		await setAi(tenantA, { 'ai.enabled': true, 'ai.maxMonthlyRequests': 1 });
		await ctx.usage.recordAiUsage({
			tenantId: tenantA,
			feature: 'tour_enquiry_extraction',
			model: 'claude-opus-5',
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			ok: true
		});
		await expect(
			ctx.enquiry.suggestEnquiry(tenantA, conversationA, viewerOwner(), { scope: 'conversation' })
		).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT_REACHED' });
		await setAi(tenantA, { 'ai.enabled': true, 'ai.maxMonthlyRequests': 0 });
	}, 60_000);

	it('the platform kill switch stops every tenant at once', async () => {
		process.env.AI_ENABLED = 'off';
		try {
			await expect(ctx.usage.assertAiAllowed(tenantA)).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });
		} finally {
			process.env.AI_ENABLED = 'on';
		}
		await expect(ctx.usage.assertAiAllowed(tenantA)).resolves.toBeTruthy();
	}, 60_000);

	it('records what the human did with a suggestion, scoped to the tenant', async () => {
		const usageId = await ctx.usage.recordAiUsage({
			tenantId: tenantA,
			feature: 'reply_draft',
			model: 'claude-opus-5',
			usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
			ok: true
		});
		expect(usageId).toBeTruthy();

		// Another tenant cannot write an outcome onto this row.
		await ctx.usage.recordAiOutcome(tenantB, usageId!, 'ACCEPTED');
		let rows = await ctx.usage.aiAcceptance(tenantA);
		expect(rows.find((r) => r.feature === 'reply_draft')?.accepted ?? 0).toBe(0);

		await ctx.usage.recordAiOutcome(tenantA, usageId!, 'EDITED');
		rows = await ctx.usage.aiAcceptance(tenantA);
		const reply = rows.find((r) => r.feature === 'reply_draft');
		expect(reply?.generated).toBeGreaterThanOrEqual(1);
		expect(reply?.edited).toBe(1);
	}, 60_000);

	it('the usage ledger never stores the customer message text', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const rows = await db()
			.select({ metadata: schema.aiUsage.metadata })
			.from(schema.aiUsage)
			.where(eq(schema.aiUsage.tenantId, tenantA));
		for (const row of rows) {
			const blob = JSON.stringify(row.metadata ?? {});
			expect(blob).not.toContain('Serengeti');
			expect(blob).not.toContain('Habari');
		}
	}, 60_000);
});
