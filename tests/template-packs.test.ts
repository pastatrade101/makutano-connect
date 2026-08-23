// Template packs: workspace selection, no-overwrite guarantee, pre-wired mappings,
// and the version stamp that makes a future V2 rollout targetable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	packs: typeof import('../src/lib/server/whatsapp/template-packs');
};

let ctx: Ctx;
const stamp = `${Date.now()}-pack`;
const tenantIds: string[] = [];

async function mkTenant(workspace: string) {
	const tenant = await provisionTestTenant({
		name: `Pack ${workspace}`,
		slug: `pack-${workspace.toLowerCase()}-${stamp}`
	});
	const { db, schema } = ctx.db;
	const { eq } = await import('drizzle-orm');
	await db()
		.update(schema.tenants)
		.set({ settings: { capabilities: workspace } })
		.where(eq(schema.tenants.id, tenant.id));
	tenantIds.push(tenant.id);
	return tenant.id;
}

suite('template packs', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			packs: await import('../src/lib/server/whatsapp/template-packs')
		};
	});

	afterAll(async () => {
		if (!ctx?.db) return;
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		if (tenantIds.length) await db().delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
		await ctx.db.closeDb();
	});

	it('selects the right subset per workspace and dedupes shared templates', () => {
		const names = (ws: 'BOOKINGS' | 'ORDERS' | 'SERVICE' | 'HYBRID') =>
			ctx.packs.packForWorkspace(ws).map((t) => t.name);

		const bookings = names('BOOKINGS');
		expect(bookings).toContain('payment_request');
		expect(bookings).toContain('booking_confirmed');
		expect(bookings).toContain('trip_reminder');
		expect(bookings).toContain('payment_received');
		expect(bookings.some((n) => n.startsWith('order_'))).toBe(false); // §clean WABA

		const orders = names('ORDERS');
		expect(orders).toContain('order_received');
		expect(orders).toContain('order_delivered');
		expect(orders).toContain('payment_received');
		expect(orders.some((n) => n.startsWith('booking_'))).toBe(false);
		expect(orders).not.toContain('quotation_ready');

		const service = names('SERVICE');
		expect(service).toContain('booking_request_received'); // enquiry ack
		expect(service).toContain('quotation_ready');
		expect(service.some((n) => n.startsWith('order_'))).toBe(false);
		expect(service).not.toContain('booking_confirmed');

		const hybrid = names('HYBRID');
		// union of both worlds, but each shared template exactly once
		expect(hybrid.filter((n) => n === 'payment_received')).toHaveLength(1);
		expect(hybrid).toContain('order_received');
		expect(hybrid).toContain('booking_confirmed');
	});

	it('drafts the pack with event mappings pre-wired and stamps the version', async () => {
		const tenantId = await mkTenant('BOOKINGS');
		// No WABA in tests: drafts are created, submission reports itself as skipped.
		const result = await ctx.packs.applyTemplatePack(tenantId, {}, { submit: false });
		expect(result.packVersion).toBe(ctx.packs.PACK_VERSION);
		expect(result.skippedExisting).toEqual([]);

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const rows = await db()
			.select()
			.from(schema.whatsappTemplates)
			.where(eq(schema.whatsappTemplates.tenantId, tenantId));
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
		expect(byName['booking_confirmed'].eventKey).toBe('BOOKING_CONFIRMED');
		expect(byName['booking_confirmed'].status).toBe('DRAFT');
		expect(byName['booking_confirmed'].variables).toEqual(['customer.first_name', 'booking.reference']);
		expect(byName['payment_received'].variables).toEqual([
			'customer.first_name',
			'payment.amount',
			'payment.reference'
		]);
		expect(byName['payment_request'].eventKey).toBe('PAYMENT_REQUESTED');
		expect(byName['payment_request'].variables).toEqual([
			'customer.first_name',
			'payment.amount_due',
			'transaction.type_label',
			'transaction.reference',
			'payment.method',
			'payment.instructions',
			'payment.reference'
		]);
		expect(byName['payment_request'].buttons).toEqual([
			{ type: 'QUICK_REPLY', text: 'I have paid' },
			{ type: 'QUICK_REPLY', text: 'Need help' }
		]);
		expect(byName['order_received']).toBeUndefined(); // BOOKINGS never gets order templates

		const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)))[0];
		const pack = ctx.packs.packState(tenant.settings as Record<string, unknown>);
		expect(pack.version).toBe(ctx.packs.PACK_VERSION);
	});

	it('never touches an existing template with the same name', async () => {
		const tenantId = await mkTenant('ORDERS');
		const { db, schema } = ctx.db;
		const { and, eq } = await import('drizzle-orm');
		// The tenant already customised order_received and Meta approved it.
		await db()
			.insert(schema.whatsappTemplates)
			.values({
				tenantId,
				name: 'order_received',
				language: 'en',
				status: 'APPROVED',
				bodyText: 'Custom body {{1}}',
				eventKey: 'ORDER_RECEIVED',
				variables: ['customer.first_name']
			});

		const result = await ctx.packs.applyTemplatePack(tenantId, {}, { submit: false });
		expect(result.skippedExisting).toContain('order_received');

		const [existing] = await db()
			.select()
			.from(schema.whatsappTemplates)
			.where(and(eq(schema.whatsappTemplates.tenantId, tenantId), eq(schema.whatsappTemplates.name, 'order_received')));
		expect(existing.status).toBe('APPROVED'); // untouched
		expect(existing.bodyText).toBe('Custom body {{1}}');
	});

	it('is idempotent — a second apply skips everything', async () => {
		const tenantId = await mkTenant('SERVICE');
		await ctx.packs.applyTemplatePack(tenantId, {}, { submit: false });
		const second = await ctx.packs.applyTemplatePack(tenantId, {}, { submit: false });
		expect(second.skippedExisting.length).toBe(ctx.packs.packForWorkspace('SERVICE').length);
		expect(second.failed.filter((f) => !f.reason.includes('drafted only'))).toEqual([]);
	});
});
