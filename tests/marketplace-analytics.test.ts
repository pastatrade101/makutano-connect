import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { marketplaceRange, parseMarketplaceRange, percentage } from '../src/lib/server/marketplace-analytics';
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
		expect(service).toContain(
			'sha256(`marketplace-page-view:${bucketStart.toISOString()}:${input.sessionId}`)'
		);
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
});
