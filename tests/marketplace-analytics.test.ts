import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	marketplaceRange,
	parseMarketplaceRange,
	percentage,
	requestsPerBooking
} from '../src/lib/server/marketplace-analytics';
import { permissionsForRole } from '../src/lib/server/auth/permissions';
import { provisionTestTenant } from './support';

process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

describe('marketplace analytics definitions', () => {
	it('uses a stable 30-day default and an equal previous comparison window', () => {
		const now = new Date('2026-09-06T12:00:00.000Z');
		const range = marketplaceRange(parseMarketplaceRange('unknown'), now);
		expect(range.key).toBe('30d');
		expect(range.from?.toISOString()).toBe('2026-08-07T12:00:00.000Z');
		expect(range.previousFrom?.toISOString()).toBe('2026-07-08T12:00:00.000Z');
		expect(range.previousTo).toEqual(range.from);
	});

	it('returns honest rates, including no rate when there is no denominator', () => {
		expect(percentage(1, 3)).toBe(33.3);
		expect(percentage(0, 4)).toBe(0);
		expect(percentage(0, 0)).toBeNull();
	});

	/*
	 * The expectations below are lifted off a real SafariBookings operator report
	 * (Goldfinch Adventures, 365 days) — the still-open / not-booked / booked
	 * triples and the ratio their page printed beside them. Reproducing somebody
	 * else's arithmetic is the only way to be sure this is the measure they use
	 * and not the one it is easy to mistake it for.
	 */
	it('counts only DECIDED enquiries per booking, so new leads never worsen the ratio', () => {
		expect(requestsPerBooking(5, 6)).toBe(1.8); // 3 open, 5 lost, 6 won
		expect(requestsPerBooking(14, 4)).toBe(4.5); // 8 open
		expect(requestsPerBooking(0, 2)).toBe(1.0); // 4 open, nothing lost
		expect(requestsPerBooking(12, 3)).toBe(5.0); // 4 open
		expect(requestsPerBooking(119, 61)).toBe(3.0); // their whole-account total
	});

	it('is not enquiries-per-booking, which is the easy wrong answer', () => {
		// 3 still open, 5 not booked, 6 booked: 14 enquiries in total.
		expect(requestsPerBooking(5, 6)).toBe(1.8);
		expect(Math.round((14 / 6) * 10) / 10).toBe(2.3);
	});

	it('has no ratio to report until something has been won', () => {
		expect(requestsPerBooking(4, 0)).toBeNull();
		expect(requestsPerBooking(0, 0)).toBeNull();
	});

	it('gives performance reporting to owners and managers, not field or read-only roles', () => {
		for (const role of ['OWNER', 'ADMIN', 'BOOKING_AGENT', 'SUPER_ADMIN'] as const) {
			expect(permissionsForRole(role)).toContain('marketplace_analytics:read');
		}
		for (const role of ['SALES', 'OPERATIONS', 'VIEWER', 'CREW'] as const) {
			expect(permissionsForRole(role)).not.toContain('marketplace_analytics:read');
		}
	});

	it('keeps view ingestion trusted, slug-owned, deduplicated, and free of raw tenant input', () => {
		const route = fs.readFileSync('src/routes/api/public/analytics/view/+server.ts', 'utf8');
		const service = fs.readFileSync('src/lib/server/marketplace-analytics.ts', 'utf8');
		const migration = fs.readFileSync('drizzle/0051_marketplace_analytics.sql', 'utf8');
		expect(route).toContain('requireTrustedOrigin(event)');
		expect(route).toContain('.strict()');
		expect(route).not.toMatch(/tenantId:\s*z\./);
		expect(service).toContain('resolveTourOwner(input.slug)');
		expect(service).toContain('resolveOperatorOwner(input.slug)');
		expect(service).toContain('sha256(`marketplace-page-view:${bucketStart.toISOString()}:${input.sessionId}`)');
		expect(service).toContain('.onConflictDoNothing()');
		expect(migration).toContain('marketplace_page_views_tour_dedupe_idx');
		expect(migration).toContain('marketplace_page_views_profile_dedupe_idx');
	});
});

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

databaseSuite('marketplace analytics database behavior', () => {
	let tenantId: string;
	let db: (typeof import('../src/lib/server/db'))['db'];
	let schema: (typeof import('../src/lib/server/db'))['schema'];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Analytics Test Operator',
			slug: `analytics-test-${Date.now()}`
		} as never);
		tenantId = tenant.id;
		({ db, schema } = await import('../src/lib/server/db'));
	});

	it('keeps the first response and derives quote/booking conversion from the enquiry cohort', async () => {
		const { markMarketplaceEnquiryResponded, getMarketplacePerformance } =
			await import('../src/lib/server/marketplace-analytics');
		const [request] = await db()
			.insert(schema.bookingRequests)
			.values({
				tenantId,
				reference: `AN-RQ-${Date.now()}`,
				source: 'MARKETPLACE',
				currency: 'USD'
			})
			.returning();

		const first = new Date(request.createdAt.getTime() + 2 * 60 * 60 * 1000);
		const later = new Date(first.getTime() + 60 * 60 * 1000);
		expect(await markMarketplaceEnquiryResponded(tenantId, request.id, 'STATUS', first)).toBe(true);
		expect(await markMarketplaceEnquiryResponded(tenantId, request.id, 'QUOTATION', later)).toBe(false);

		await db()
			.insert(schema.quotations)
			.values({
				tenantId,
				reference: `AN-QT-${Date.now()}`,
				bookingRequestId: request.id,
				status: 'SENT',
				sentAt: first
			});
		await db()
			.insert(schema.bookings)
			.values({
				tenantId,
				bookingReference: `AN-BK-${Date.now()}`,
				bookingRequestId: request.id,
				source: 'MARKETPLACE'
			});

		const report = await getMarketplacePerformance(tenantId, '30d', 'UTC', later);
		expect(report.current.enquiries).toBe(1);
		expect(report.current.quoteRate).toBe(100);
		expect(report.current.bookingConversion).toBe(100);
		expect(report.current.medianResponseHours).toBe(2);

		const [stored] = await db()
			.select()
			.from(schema.bookingRequests)
			.where((await import('drizzle-orm')).eq(schema.bookingRequests.id, request.id))
			.limit(1);
		expect(stored.firstRespondedAt).toEqual(first);
		expect(stored.firstResponseChannel).toBe('STATUS');
	});
	it('splits every enquiry into exactly one of still open / not booked / booked, and prices each side', async () => {
		const { getMarketplacePerformance } = await import('../src/lib/server/marketplace-analytics');
		const stamp = Date.now();
		// Its own tenant: the suite above puts an enquiry on the shared one, and
		// these assertions are about exact totals.
		const own = await provisionTestTenant({
			name: 'Funnel Test Operator',
			slug: `funnel-test-${stamp}`
		} as never);

		const tour = async (title: string) => {
			const [row] = await db()
				.insert(schema.tours)
				.values({ tenantId: own.id, title, slug: `${title.toLowerCase()}-${stamp}` })
				.returning();
			return row;
		};
		const enquiry = async (values: Partial<typeof schema.bookingRequests.$inferInsert> = {}) => {
			const [row] = await db()
				.insert(schema.bookingRequests)
				.values({
					tenantId: own.id,
					reference: `FN-RQ-${stamp}-${reference++}`,
					source: 'MARKETPLACE',
					currency: 'USD',
					...values
				})
				.returning();
			return row;
		};
		const quote = async (bookingRequestId: string, values: Partial<typeof schema.quotations.$inferInsert> = {}) => {
			const [row] = await db()
				.insert(schema.quotations)
				.values({
					tenantId: own.id,
					reference: `FN-QT-${stamp}-${reference++}`,
					bookingRequestId,
					status: 'SENT',
					sentAt: new Date(),
					...values
				})
				.returning();
			return row;
		};
		const booking = async (
			bookingRequestId: string | null,
			values: Partial<typeof schema.bookings.$inferInsert> = {}
		) => {
			const [row] = await db()
				.insert(schema.bookings)
				.values({
					tenantId: own.id,
					bookingReference: `FN-BK-${stamp}-${reference++}`,
					bookingRequestId,
					source: 'MARKETPLACE',
					...values
				})
				.returning();
			return row;
		};
		let reference = 1;

		const alpha = await tour('Alpha');
		const beta = await tour('Beta');

		// Won, and quoted at 4,500 before it was booked at 5,000. The BOOKING is
		// what it was worth — the operator banked the booking, not the offer.
		const won = await enquiry({ tourId: alpha.id });
		await quote(won.id, { total: '4500.00', currency: 'USD' });
		await booking(won.id, { total: '5000.00', currency: 'USD' });

		// Re-quoted: two sent versions. Only the newest stands, so this is worth
		// 2,500 and not 3,500 — the trap that double-counts a negotiated deal.
		const requoted = await enquiry({ tourId: alpha.id, status: 'QUOTED' });
		await quote(requoted.id, { total: '1000.00', version: 1 });
		await quote(requoted.id, { total: '2500.00', version: 2 });

		// The traveller declined the offer, and declineQuotation leaves the
		// ENQUIRY sitting at QUOTED. Reading only the enquiry would park a dead
		// lead in the follow-up list forever.
		const declined = await enquiry({ tourId: alpha.id, status: 'QUOTED' });
		await quote(declined.id, { total: '2000.00', status: 'DECLINED' });

		// A second currency on the same listing. It must stay its own total.
		const shillings = await enquiry({ tourId: alpha.id, currency: 'TZS' });
		await quote(shillings.id, { total: '3000000.00', currency: 'TZS' });

		// Closed off before anyone quoted: counted, worth nothing.
		await enquiry({ tourId: beta.id, status: 'CANCELLED' });

		// Won, but the booking was later deleted. The enquiry still points at it,
		// so it stays won and falls back to the offer for its value.
		const orphaned = await enquiry({ tourId: beta.id });
		const removed = await booking(orphaned.id, { total: '9999.00' });
		await quote(orphaned.id, { total: '800.00' });
		const { eq } = await import('drizzle-orm');
		await db().update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, removed.id));
		await db()
			.update(schema.bookingRequests)
			.set({ convertedBookingId: removed.id })
			.where(eq(schema.bookingRequests.id, orphaned.id));

		// No tour at all: belongs to the tenant total, and to no listing's row.
		const untied = await enquiry();
		await booking(untied.id, { total: '1000.00' });

		const report = await getMarketplacePerformance(own.id, '30d', 'UTC');
		const funnel = report.current.funnel;

		expect(report.current.enquiries).toBe(7);
		expect(funnel.stillOpen.count).toBe(2);
		expect(funnel.notBooked.count).toBe(2);
		expect(funnel.booked.count).toBe(3);
		// The property the whole split rests on.
		expect(funnel.stillOpen.count + funnel.notBooked.count + funnel.booked.count).toBe(report.current.enquiries);

		// 2,500 from the newest version only, and the shillings kept apart.
		expect(funnel.stillOpen.value).toEqual([
			{ currency: 'TZS', amount: 3_000_000 },
			{ currency: 'USD', amount: 2500 }
		]);
		expect(funnel.notBooked.value).toEqual([{ currency: 'USD', amount: 2000 }]);
		// 5,000 booked + 800 fallen back to + 1,000 with no tour. Never 9,999.
		expect(funnel.booked.value).toEqual([{ currency: 'USD', amount: 6800 }]);

		// (2 lost + 3 won) / 3 won.
		expect(funnel.requestsPerBooking).toBe(1.7);
		// One definition of booked, not two.
		expect(report.current.booked).toBe(funnel.booked.count);

		const rowFor = (id: string) => report.tours.find((row) => row.id === id)!;
		expect(rowFor(alpha.id).funnel.stillOpen.count).toBe(2);
		expect(rowFor(alpha.id).funnel.stillOpen.value).toEqual([
			{ currency: 'TZS', amount: 3_000_000 },
			{ currency: 'USD', amount: 2500 }
		]);
		expect(rowFor(alpha.id).funnel.notBooked.value).toEqual([{ currency: 'USD', amount: 2000 }]);
		expect(rowFor(alpha.id).funnel.booked.value).toEqual([{ currency: 'USD', amount: 5000 }]);
		expect(rowFor(alpha.id).funnel.requestsPerBooking).toBe(2);

		expect(rowFor(beta.id).funnel.notBooked.count).toBe(1);
		// Cancelled before anyone quoted: it counts, and carries no money.
		expect(rowFor(beta.id).funnel.notBooked.value).toEqual([]);
		expect(rowFor(beta.id).funnel.booked.value).toEqual([{ currency: 'USD', amount: 800 }]);

		// The tour rows account for six of the seven; the untied one is the tenant's alone.
		const acrossTours = report.tours.reduce(
			(total, row) => total + row.funnel.stillOpen.count + row.funnel.notBooked.count + row.funnel.booked.count,
			0
		);
		expect(acrossTours).toBe(6);
	});

	it('re-quoting an expired offer puts the enquiry back on the follow-up list', async () => {
		const { getMarketplacePerformance } = await import('../src/lib/server/marketplace-analytics');
		const stamp = Date.now();
		const own = await provisionTestTenant({
			name: 'Expiry Test Operator',
			slug: `expiry-test-${stamp}`
		} as never);
		const [request] = await db()
			.insert(schema.bookingRequests)
			.values({ tenantId: own.id, reference: `EX-RQ-${stamp}`, source: 'MARKETPLACE', status: 'QUOTED' })
			.returning();
		await db()
			.insert(schema.quotations)
			.values({
				tenantId: own.id,
				reference: `EX-QT-${stamp}-1`,
				bookingRequestId: request.id,
				status: 'EXPIRED',
				version: 1,
				total: '1200.00',
				sentAt: new Date()
			});

		const lapsed = await getMarketplacePerformance(own.id, '30d', 'UTC');
		expect(lapsed.current.funnel.notBooked.count).toBe(1);
		expect(lapsed.current.funnel.stillOpen.count).toBe(0);

		await db()
			.insert(schema.quotations)
			.values({
				tenantId: own.id,
				reference: `EX-QT-${stamp}-2`,
				bookingRequestId: request.id,
				status: 'SENT',
				version: 2,
				total: '1400.00',
				sentAt: new Date()
			});

		const renewed = await getMarketplacePerformance(own.id, '30d', 'UTC');
		expect(renewed.current.funnel.stillOpen.count).toBe(1);
		expect(renewed.current.funnel.notBooked.count).toBe(0);
		expect(renewed.current.funnel.stillOpen.value).toEqual([{ currency: 'USD', amount: 1400 }]);
	});
});
