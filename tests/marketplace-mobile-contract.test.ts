// The Flutter app must not need a release because the marketplace shipped.
//
// The whole reason a marketplace enquiry is an ORDINARY booking_request — rather
// than a new "marketplace lead" type — is that the phone already understands
// enquiries. These tests assert that from the phone's side: a tour enquiry has
// to arrive as kind='enquiry' with the same payload shape as a website enquiry,
// and the two new pieces of data (source=MARKETPLACE, tour_id) have to be
// invisible to a client that has never heard of them.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('marketplace enquiry is an ordinary enquiry to the phone', () => {
	let tenantId: string;
	let tourId: string;
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];
	let createBookingRequest: typeof import('../src/lib/server/booking-requests')['createBookingRequest'];
	/**
	 * The REAL mobile route handler, not a re-implementation of its query.
	 *
	 * The attention helper that looked right is anchored on OPEN CONVERSATIONS and
	 * only returns records for those customers, so an enquiry with no thread is
	 * invisible to it. The phone's work feed is THIS route, so this route is what
	 * the contract has to be proved against.
	 */
	let workRoute: { GET: (event: never) => Response | Promise<Response> };
	let OWNER_PERMS: readonly string[] = [];

	// requireViewer() reads only event.locals, so a minimal event exercises the
	// genuine handler end to end.
	const callWorkFeed = async () => {
		const res = await workRoute.GET({
			locals: {
				user: { id: '00000000-0000-0000-0000-000000000001' },
				tenant: { id: tenantId, settings: {} },
				permissions: OWNER_PERMS
			},
			url: new URL('http://localhost/api/mobile/v1/work')
		} as never);
		const body = (await res.json()) as { data?: { items?: Array<Record<string, unknown>> } } & Record<string, unknown>;
		const items = (body.data?.items ?? (body as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<
			Record<string, unknown>
		>;
		return { status: res.status, items };
	};

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Mobile Contract Co',
			slug: `test-mobile-${Date.now()}`
		} as never);
		tenantId = tenant.id;

		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		({ createBookingRequest } = await import('../src/lib/server/booking-requests'));
		workRoute = await import('../src/routes/api/mobile/v1/work/+server');
		const { permissionsForRole } = await import('../src/lib/server/auth/permissions');
		OWNER_PERMS = permissionsForRole('OWNER');

		const { liftLimits } = await import('./support');
		await liftLimits(tenantId);

		const [country] = await db()
			.select()
			.from(schema.countries)
			.where(eq(schema.countries.slug, 'tanzania'))
			.limit(1);

		const [tour] = await db()
			.insert(schema.tours)
			.values({
				tenantId,
				primaryCountryId: country.id,
				title: 'Contract Probe Safari',
				slug: `contract-probe-${Date.now()}`,
				status: 'PUBLISHED',
				publishedAt: new Date()
			})
			.returning();
		tourId = tour.id;
	}, 120_000);

	// createBookingRequest returns { request, customer, leadId, conversationId },
	// so unwrap once here rather than at every call site.
	const makeEnquiry = async (marketplace: boolean) =>
		(await createBookingRequest(tenantId, {
			customer: { firstName: marketplace ? 'Marketplace' : 'Website', lastName: 'Traveller', email: `t${Date.now()}@example.com` },
			source: marketplace ? 'MARKETPLACE' : 'WEBSITE',
			tourId: marketplace ? tourId : null,
			adults: 2,
			notes: 'Interested in July.',
			metadata: marketplace
				? {
						marketplace: {
							utmSource: 'google',
							utmMedium: 'organic',
							landingPage: '/tours/contract-probe',
							sessionId: 'sess_probe'
						}
					}
				: {},
			// The acknowledgement path is exercised separately; keep these tests
			// about the data contract.
			sendAcknowledgement: false
		} as never)).request;

	it('stores a marketplace enquiry as a booking_request, not a new type', async () => {
		const req = await makeEnquiry(true);
		const [row] = await db()
			.select()
			.from(schema.bookingRequests)
			.where(eq(schema.bookingRequests.id, req.id))
			.limit(1);

		expect(row.source).toBe('MARKETPLACE');
		expect(row.tourId).toBe(tourId);
		// Lifecycle is untouched by where the enquiry came from.
		expect(row.status).toBe('NEW');
		expect(row.reference).toMatch(/RQ|-/);
	});

	it('surfaces it to the phone as kind="enquiry", exactly like a website enquiry', async () => {
		const marketplace = await makeEnquiry(true);
		const website = await makeEnquiry(false);

		const { status, items } = await callWorkFeed();
		expect(status, 'the work feed must answer').toBe(200);
		const byId = new Map(items.map((f) => [f.id as string, f]));

		const m = byId.get(marketplace.id);
		const w = byId.get(website.id);

		expect(m, 'marketplace enquiry must appear in the work feed').toBeTruthy();
		expect(w, 'website enquiry must appear in the work feed').toBeTruthy();
		expect(m!.kind).toBe('enquiry');
		expect(w!.kind).toBe('enquiry');
	});

	it('gives the two enquiries an IDENTICAL payload shape', async () => {
		// The contract is the SHAPE. If the marketplace row grew or lost a key the
		// phone would have to change, which is precisely what must not happen.
		const marketplace = await makeEnquiry(true);
		const website = await makeEnquiry(false);

		const { items } = await callWorkFeed();
		const m = items.find((f) => f.id === marketplace.id)!;
		const w = items.find((f) => f.id === website.id)!;
		expect(m, 'marketplace enquiry present').toBeTruthy();
		expect(w, 'website enquiry present').toBeTruthy();

		expect(Object.keys(m).sort()).toEqual(Object.keys(w).sort());
	});

	it('never leaks marketing attribution into the phone payload', async () => {
		// Attribution is acquisition context, not lifecycle state. It lives in
		// metadata and must not reach an operator's work list.
		const req = await makeEnquiry(true);
		const { items } = await callWorkFeed();
		const item = items.find((f) => f.id === req.id);
		expect(item, 'the enquiry must be in the feed to test what it exposes').toBeTruthy();

		const serialized = JSON.stringify(item);
		for (const leak of ['utmSource', 'google', 'sess_probe', 'landingPage']) {
			expect(serialized, `${leak} must not reach the phone`).not.toContain(leak);
		}
	});

	it('leaves an existing website enquiry byte-for-byte unaffected', async () => {
		// The regression that would matter most: adding a column or an enum value
		// changing what already worked.
		const req = await makeEnquiry(false);
		const [row] = await db()
			.select()
			.from(schema.bookingRequests)
			.where(eq(schema.bookingRequests.id, req.id))
			.limit(1);

		expect(row.source).toBe('WEBSITE');
		expect(row.tourId).toBeNull();
		expect(row.status).toBe('NEW');
	});

	it('keeps the enquiry when its tour is later deleted', async () => {
		// SET NULL, not cascade: a real customer's enquiry must survive an
		// operator retiring the listing that produced it.
		const [country] = await db()
			.select()
			.from(schema.countries)
			.where(eq(schema.countries.slug, 'tanzania'))
			.limit(1);
		const [doomed] = await db()
			.insert(schema.tours)
			.values({
				tenantId,
				primaryCountryId: country.id,
				title: 'Doomed Listing',
				slug: `doomed-${Date.now()}`
			})
			.returning();

		const { request: req } = await createBookingRequest(tenantId, {
			customer: { firstName: 'Survivor', lastName: 'Traveller', email: `s${Date.now()}@example.com` },
			source: 'MARKETPLACE',
			tourId: doomed.id,
			sendAcknowledgement: false
		} as never);

		await db().delete(schema.tours).where(eq(schema.tours.id, doomed.id));

		const [row] = await db()
			.select()
			.from(schema.bookingRequests)
			.where(eq(schema.bookingRequests.id, req.id))
			.limit(1);
		expect(row, 'the enquiry must outlive the listing').toBeTruthy();
		expect(row.tourId).toBeNull();
		expect(row.source).toBe('MARKETPLACE');
	});
});
