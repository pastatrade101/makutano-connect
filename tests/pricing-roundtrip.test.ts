// The whole money chain, against a real database.
//
// Everything else about pricing is proven on pure functions and on the source of
// the call sites. That catches a regression in the code and NOT one in the SQL —
// a wrong column, a constraint that does not fire, a transaction that does not
// roll back. This suite reads the rows back with its own queries and asserts on
// what Postgres actually holds.
//
// It skips without TEST_DATABASE_URL, and tests/pin-database.ts refuses a URL
// that looks hosted: the reason that guard exists is that sourcing .env once put
// 27 test tenants into production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant, liftLimits } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.DIRECT_DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

if (!TEST_DB) {
	console.warn('\n⚠️  TEST_DATABASE_URL is not set — the pricing round-trip was SKIPPED.\n');
}

suite('tour pricing -> quotation -> frozen offer -> booking', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		tours: typeof import('../src/lib/server/tours');
		pricing: typeof import('../src/lib/server/tour-pricing');
		quotations: typeof import('../src/lib/server/quotations');
		customers: typeof import('../src/lib/server/customers');
		requests: typeof import('../src/lib/server/booking-requests');
	};
	let tenantId: string;
	let tourId: string;
	const stamp = `${Date.now()}-price`;

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			tours: await import('../src/lib/server/tours'),
			pricing: await import('../src/lib/server/tour-pricing'),
			quotations: await import('../src/lib/server/quotations'),
			customers: await import('../src/lib/server/customers'),
			requests: await import('../src/lib/server/booking-requests')
		};
		const tenant = await provisionTestTenant({ name: `Pricing ${stamp}` });
		tenantId = tenant.id;
		await liftLimits(tenantId);

		// A LEGACY tour: a hand-typed price and no structured pricing at all.
		const tour = await ctx.tours.createTour(tenantId, {
			title: `Northern circuit ${stamp}`,
			durationDays: 6,
			priceFrom: '1099.00',
			currency: 'USD',
			pricingType: 'PER_PERSON'
		});
		tourId = tour.id;
	}, 120_000);

	afterAll(async () => {
		await ctx?.db?.closeDb?.().catch?.(() => {});
	});

	/** Read a tour straight from Postgres, never through a cache or a service. */
	async function tourRow() {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tourId)).limit(1);
		return row;
	}

	it('starts legacy: a typed price_from and no adult_price', async () => {
		const row = await tourRow();
		expect(row.priceFrom).toBe('1099.00');
		expect(row.adultPrice).toBeNull();
		expect(row.childPrice).toBeNull();
	});

	// ---------------------------------------------------------------- A ----
	it('A: saving structured pricing derives price_from from the lowest reachable rate', async () => {
		await ctx.pricing.saveTourPricing(tenantId, tourId, {
			currency: 'USD',
			adultPrice: '1099.00',
			childPrice: '750.00',
			tiers: [
				{ minTravellers: 5, maxTravellers: 6, adult: '975.00', child: '675.00' },
				{ minTravellers: 7, maxTravellers: null, adult: '950.00', child: '650.00' }
			],
			seasons: []
		});

		const row = await tourRow();
		// 950 is the lowest adult rate a real party (7+) can be quoted.
		expect(row.priceFrom).toBe('950.00');
		expect(row.adultPrice).toBe('1099.00');
		expect(row.childPrice).toBe('750.00');

		const { db, schema } = ctx.db;
		const { eq, asc } = await import('drizzle-orm');
		const tiers = await db()
			.select()
			.from(schema.tourPriceTiers)
			.where(eq(schema.tourPriceTiers.tourId, tourId))
			.orderBy(asc(schema.tourPriceTiers.minTravellers));
		expect(tiers).toHaveLength(2);
		expect(tiers[0].minTravellers).toBe(5);
		expect(tiers[0].maxTravellers).toBe(6);
		expect(tiers[0].adultPrice).toBe('975.00');
		expect(tiers[1].maxTravellers).toBeNull();
		expect(tiers[1].adultPrice).toBe('950.00');
	}, 60_000);

	// ---------------------------------------------------------------- G ----
	it('G: an invalid configuration writes nothing and leaves the old pricing intact', async () => {
		const before = await tourRow();
		await expect(
			ctx.pricing.saveTourPricing(tenantId, tourId, {
				currency: 'USD',
				adultPrice: '800.00',
				childPrice: null,
				// 3-5 and 5-7 both match a party of five.
				tiers: [
					{ minTravellers: 3, maxTravellers: 5, adult: '800.00', child: null },
					{ minTravellers: 5, maxTravellers: 7, adult: '700.00', child: null }
				],
				seasons: []
			})
		).rejects.toThrow(/overlaps/i);

		const after = await tourRow();
		expect(after.priceFrom).toBe(before.priceFrom);
		expect(after.adultPrice).toBe(before.adultPrice);

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const tiers = await db().select().from(schema.tourPriceTiers).where(eq(schema.tourPriceTiers.tourId, tourId));
		// Still the two good tiers — no partial write.
		expect(tiers).toHaveLength(2);
		expect(tiers.some((t) => t.adultPrice === '700.00')).toBe(false);
	}, 60_000);

	// ------------------------------------------------------------- B - E ----
	it('B-E: quote a party, freeze it, move the tour, and accept the old offer', async () => {
		const { db, schema } = ctx.db;
		const { eq, desc } = await import('drizzle-orm');

		const customer = await ctx.customers.createCustomer(tenantId, {
			firstName: 'Amina',
			lastName: 'Traveller',
			email: `amina-${stamp}@example.test`
		});

		// B: an enquiry for 2 adults and 2 children — a party of four.
		const created = await ctx.requests.createBookingRequest(tenantId, {
			customer: { id: customer.id, firstName: 'Amina', email: `amina-${stamp}@example.test` },
			tourId,
			adults: 2,
			children: 2,
			startDate: '2026-09-17',
			sendAcknowledgement: false
		} as never);
		const requestId = (created as { request: { id: string } }).request.id;

		const draft = await ctx.quotations.draftQuotationFor(tenantId, requestId);
		// A party of four falls in no tier, so base rates apply.
		expect(draft.recommended?.adultPrice).toBe('1099.00');
		expect(draft.recommended?.childPrice).toBe('750.00');
		expect(draft.recommended?.childRateMissing).toBe(false);
		expect(draft.recommended?.total).toBe('3698.00');
		expect(draft.currency).toBe('USD');

		const quotation = await ctx.quotations.createQuotation(tenantId, {
			customerId: customer.id,
			bookingRequestId: requestId,
			currency: 'USD',
			adults: 2,
			children: 2,
			items: [
				{ title: 'Northern circuit — adults', quantity: 2, unitPrice: '1099.00' },
				{ title: 'Northern circuit — children', quantity: 2, unitPrice: '750.00' }
			]
		} as never);

		const [persisted] = await db().select().from(schema.quotations).where(eq(schema.quotations.id, quotation.id));
		expect(persisted.total).toBe('3698.00');

		// C: send freezes it.
		await ctx.quotations.sendQuotation(tenantId, quotation.id, null);
		const [frozen] = await db()
			.select()
			.from(schema.quotationVersions)
			.where(eq(schema.quotationVersions.quotationId, quotation.id))
			.orderBy(desc(schema.quotationVersions.version))
			.limit(1);
		const snap = frozen.snapshot as Record<string, unknown>;
		expect(snap.currency).toBe('USD');
		expect(snap.adults).toBe(2);
		expect(snap.children).toBe(2);
		expect(snap.total).toBe('3698.00');
		expect(snap.subtotal).toBe('3698.00');
		expect(snap.discount).toBe('0.00');
		expect(snap.tax).toBe('0.00');
		expect(snap.version).toBe(frozen.version);
		const snapItems = snap.items as { unitPrice: string }[];
		expect(snapItems.map((i) => i.unitPrice).sort()).toEqual(['1099.00', '750.00']);
		const frozenTotal = String(snap.total);

		// D: the tour moves, substantially, after the offer was made.
		await ctx.pricing.saveTourPricing(tenantId, tourId, {
			currency: 'USD',
			adultPrice: '1500.00',
			childPrice: '1000.00',
			tiers: [],
			seasons: []
		});
		const moved = await tourRow();
		expect(moved.priceFrom).toBe('1500.00');
		expect(moved.adultPrice).toBe('1500.00');

		// E: accept the offer that was actually made.
		const { booking } = await ctx.quotations.acceptQuotation(tenantId, quotation.id, {}, frozen.version);
		const [bookingRow] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(bookingRow.total).toBe(frozenTotal);
		expect(bookingRow.total).toBe('3698.00');
		// NOT the current pricing: 2x1500 + 2x1000 would be 5000.
		expect(bookingRow.total).not.toBe('5000.00');
		expect(bookingRow.currency).toBe('USD');
		expect(bookingRow.adults).toBe(2);
		expect(bookingRow.children).toBe(2);

		const items = await db().select().from(schema.bookingItems).where(eq(schema.bookingItems.bookingId, booking.id));
		expect(items.map((i) => i.unitPrice).sort()).toEqual(['1099.00', '750.00']);
	}, 120_000);

	// ---------------------------------------------------------------- F ----
	it('F: a stale version cannot silently accept a newer offer', async () => {
		const { db, schema } = ctx.db;
		const { eq, desc } = await import('drizzle-orm');

		const customer = await ctx.customers.createCustomer(tenantId, {
			firstName: 'Stale',
			lastName: 'Link',
			email: `stale-${stamp}@example.test`
		});
		const quotation = await ctx.quotations.createQuotation(tenantId, {
			customerId: customer.id,
			currency: 'USD',
			adults: 1,
			children: 0,
			items: [{ title: 'Circuit', quantity: 1, unitPrice: '1000.00' }]
		} as never);
		await ctx.quotations.sendQuotation(tenantId, quotation.id, null);

		const [sent] = await db()
			.select()
			.from(schema.quotationVersions)
			.where(eq(schema.quotationVersions.quotationId, quotation.id))
			.orderBy(desc(schema.quotationVersions.version))
			.limit(1);

		// A link claiming a version that was never sent must be refused, not
		// resolved to whatever is current.
		await expect(
			ctx.quotations.acceptQuotation(tenantId, quotation.id, {}, sent.version + 1)
		).rejects.toThrow(/updated since you opened it/i);

		// The quotation is untouched: nothing was accepted.
		const [after] = await db().select().from(schema.quotations).where(eq(schema.quotations.id, quotation.id));
		expect(after.status).toBe('SENT');
		expect(after.convertedBookingId).toBeNull();
	}, 120_000);

	it('refuses to accept a quotation that was never sent', async () => {
		const customer = await ctx.customers.createCustomer(tenantId, {
			firstName: 'Never',
			lastName: 'Sent',
			email: `never-${stamp}@example.test`
		});
		const quotation = await ctx.quotations.createQuotation(tenantId, {
			customerId: customer.id,
			currency: 'USD',
			adults: 1,
			children: 0,
			items: [{ title: 'Circuit', quantity: 1, unitPrice: '500.00' }]
		} as never);
		await expect(ctx.quotations.acceptQuotation(tenantId, quotation.id, {})).rejects.toThrow(/not been sent/i);
	}, 60_000);

	it('the database itself refuses overlapping tiers, not only the validator', async () => {
		const { db, schema } = ctx.db;
		await expect(
			db()
				.insert(schema.tourPriceTiers)
				.values([
					{ tenantId, tourId, minTravellers: 2, maxTravellers: 4, adultPrice: '900.00', childPrice: null },
					{ tenantId, tourId, minTravellers: 4, maxTravellers: 6, adultPrice: '800.00', childPrice: null }
				])
		).rejects.toThrow();
	}, 60_000);
});
