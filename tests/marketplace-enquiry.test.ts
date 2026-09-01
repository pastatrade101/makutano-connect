// The one unauthenticated endpoint that WRITES, and what it writes belongs to a
// tenant. So the tests that matter are about who ends up owning the row.
//
// The attack is simple to state: a stranger posts an enquiry and names a tenant.
// If the server ever believed them, one operator could inject leads into a
// competitor's inbox — or read a reference belonging to a business they have
// nothing to do with. The defence is that the TOUR resolves the tenant, so these
// tests post the forged fields on purpose and assert they changed nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('marketplace enquiry ownership', () => {
	let tenantA: string;
	let tenantB: string;
	let publishedSlug: string;
	let publishedTourId: string;
	let draftSlug: string;
	let route: { POST: (event: never) => Response | Promise<Response> };
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	const post = async (body: unknown, ip = '203.0.113.10') => {
		const res = await route.POST({
			request: new Request('http://localhost/api/public/enquiries', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			}),
			url: new URL('http://localhost/api/public/enquiries'),
			getClientAddress: () => ip,
			locals: {}
		} as never);
		return {
			status: res.status,
			body: (await res.json()) as { data: Record<string, unknown>; error?: unknown }
		};
	};

	beforeAll(async () => {
		const a = await provisionTestTenant({ name: 'Owner A', slug: `test-enq-a-${Date.now()}` } as never);
		const b = await provisionTestTenant({ name: 'Owner B', slug: `test-enq-b-${Date.now()}` } as never);
		tenantA = a.id;
		tenantB = b.id;
		route = await import('../src/routes/api/public/enquiries/+server');
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		const { liftLimits } = await import('./support');
		await liftLimits(tenantA);
		await liftLimits(tenantB);

		const T = await import('../src/lib/server/tours');
		const [country] = await db().select().from(schema.countries).where(eq(schema.countries.slug, 'tanzania')).limit(1);
		const [dest] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'serengeti-national-park')).limit(1);
		const [media] = await db().insert(schema.media).values({
			tenantId: tenantA, objectKey: `enq/${Date.now()}.jpg`, url: 'https://cdn.example.test/e.jpg', mimeType: 'image/jpeg'
		}).returning();

		// A published listing owned by tenant A.
		const live = await T.createTour(tenantA, {
			title: 'Ownership Probe Safari', primaryCountryId: country.id, shortDescription: 'Live.',
			durationDays: 3, priceFrom: '1500.00', currency: 'USD', heroMediaId: media.id
		});
		await T.setTourDestinations(tenantA, live.id, [dest.id]);
		await T.replaceItinerary(tenantA, live.id, [{ dayNumber: 1, title: 'Day one' }] as never);
		await db().update(schema.tours).set({ status: 'PUBLISHED', publishedAt: new Date() }).where(eq(schema.tours.id, live.id));
		publishedSlug = live.slug;
		publishedTourId = live.id;

		const draft = await T.createTour(tenantA, { title: 'Draft Probe', primaryCountryId: country.id });
		draftSlug = draft.slug;
	}, 120_000);

	/**
	 * Look the enquiry up by reference AND owner.
	 *
	 * A booking reference is unique PER TENANT, not globally — every tenant's
	 * first enquiry is RQ-…-00001 — so a lookup by reference alone quietly
	 * matches another suite's row when the whole suite runs together. Restricting
	 * to the two tenants under test keeps the ownership assertions meaningful:
	 * if the row were B's, `toBe(tenantA)` still fails, which is the point.
	 */
	const rowFor = async (reference: string) => {
		const { and, inArray } = await import('drizzle-orm');
		const [row] = await db()
			.select()
			.from(schema.bookingRequests)
			.where(
				and(
					eq(schema.bookingRequests.reference, reference),
					inArray(schema.bookingRequests.tenantId, [tenantA, tenantB])
				)
			)
			.limit(1);
		return row;
	};

	/* ---- the happy path --------------------------------------------------- */

	it('creates an ordinary booking_request owned by the tour’s tenant', async () => {
		const { status, body } = await post({
			tour: publishedSlug, firstName: 'Ada', email: 'ada@example.com', adults: 2
		}, '203.0.113.11');

		expect(status).toBe(200);
		const reference = body.data.reference as string;
		expect(reference).toBeTruthy();

		const row = await rowFor(reference);
		expect(row.tenantId).toBe(tenantA);
		expect(row.source).toBe('MARKETPLACE');
		expect(row.tourId).toBe(publishedTourId);
		expect(row.status).toBe('NEW');
	});

	/* ---- forged ownership -------------------------------------------------- */

	it('ignores a tenantId the caller supplies', async () => {
		const { status, body } = await post({
			tour: publishedSlug,
			tenantId: tenantB, // the forgery
			tenant_id: tenantB,
			tenant: tenantB,
			firstName: 'Mallory',
			email: 'mallory@example.com'
		}, '203.0.113.12');

		expect(status).toBe(200);
		const row = await rowFor(body.data.reference as string);
		expect(row.tenantId, 'the TOUR decides the owner, not the caller').toBe(tenantA);
		expect(row.tenantId).not.toBe(tenantB);
	});

	it('leaves tenant B with no enquiries at all after the forgery attempt', async () => {
		const rows = await db().select().from(schema.bookingRequests)
			.where(eq(schema.bookingRequests.tenantId, tenantB));
		expect(rows, 'nothing may be injected into another operator’s inbox').toHaveLength(0);
	});

	/* ---- enquiries from an operator storefront ------------------------------ */

	/*
	 * "Plan my trip" from a profile page. There is no tour yet — the traveller
	 * likes the operator — so the OPERATOR SLUG has to decide the owner, under
	 * exactly the rules the tour path uses.
	 */
	it('routes an operator enquiry to that operator’s tenant, with no tour attached', async () => {
		const [profile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantA))
			.limit(1);
		expect(profile, 'the tour fixture should have created a profile').toBeTruthy();

		const { status, body } = await post(
			{ operator: profile.slug, firstName: 'Grace', email: 'grace@example.com', adults: 2 },
			'203.0.113.31'
		);
		expect(status).toBe(200);

		const row = await rowFor(body.data.reference as string);
		expect(row.tenantId).toBe(tenantA);
		expect(row.source).toBe('MARKETPLACE');
		expect(row.tourId, 'there is no tour in an operator enquiry').toBeNull();
	});

	it('ignores a tenantId supplied alongside an operator slug', async () => {
		const [profile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantA))
			.limit(1);

		const { status, body } = await post(
			{
				operator: profile.slug,
				tenantId: tenantB, // the forgery
				tenant_id: tenantB,
				firstName: 'Mallory',
				email: 'mallory2@example.com'
			},
			'203.0.113.32'
		);
		expect(status).toBe(200);
		const row = await rowFor(body.data.reference as string);
		expect(row.tenantId, 'the OPERATOR decides the owner, not the caller').toBe(tenantA);
	});

	it('refuses an enquiry to an operator that has been deactivated', async () => {
		const [profile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantA))
			.limit(1);
		await db()
			.update(schema.operatorProfiles)
			.set({ isActive: false })
			.where(eq(schema.operatorProfiles.id, profile.id));

		const { status } = await post(
			{ operator: profile.slug, firstName: 'Eve', email: 'eve2@example.com' },
			'203.0.113.33'
		);
		expect(status, 'unlisting an operator has to stop the leads too').toBe(404);

		await db()
			.update(schema.operatorProfiles)
			.set({ isActive: true })
			.where(eq(schema.operatorProfiles.id, profile.id));
	});

	/*
	 * Found in production, not in review: the first version of this rule demanded
	 * `tenants.status = 'ACTIVE'`, and the live operator was on a free trial —
	 * status 'TRIAL'. Every enquiry to them was answered "no longer available".
	 * The operator most in need of their first lead was the one guaranteed not to
	 * get it.
	 */
	it.each(['TRIAL', 'PENDING', 'ACTIVE'])('still delivers to a %s tenant', async (status) => {
		const [profile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantA))
			.limit(1);
		await db()
			.update(schema.tenants)
			.set({ status: status as 'ACTIVE' })
			.where(eq(schema.tenants.id, tenantA));

		const { status: code } = await post(
			{ operator: profile.slug, firstName: 'Trial', email: `trial-${status}@example.com` },
			`203.0.113.4${status.length}`
		);
		expect(code, `a ${status} operator is a real operator`).toBe(200);

		await db().update(schema.tenants).set({ status: 'ACTIVE' }).where(eq(schema.tenants.id, tenantA));
	});

	it.each(['SUSPENDED', 'CANCELLED'])('refuses delivery to a %s tenant', async (status) => {
		const [profile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantA))
			.limit(1);
		await db()
			.update(schema.tenants)
			.set({ status: status as 'SUSPENDED' })
			.where(eq(schema.tenants.id, tenantA));

		const { status: code } = await post(
			{ operator: profile.slug, firstName: 'Nope', email: `nope-${status}@example.com` },
			`203.0.113.5${status.length}`
		);
		expect(code).toBe(404);

		await db().update(schema.tenants).set({ status: 'ACTIVE' }).where(eq(schema.tenants.id, tenantA));
	});

	it('refuses an enquiry naming an operator that does not exist', async () => {
		const { status } = await post(
			{ operator: 'no-such-operator-anywhere', firstName: 'Eve', email: 'eve3@example.com' },
			'203.0.113.34'
		);
		expect(status).toBe(404);
	});

	it('insists on naming either a tour or an operator', async () => {
		const { status } = await post({ firstName: 'Eve', email: 'eve4@example.com' }, '203.0.113.35');
		// 422 is what this API returns for a VALIDATION_ERROR; see "insists on a
		// way to reply" below.
		expect(status).toBe(422);
	});

	it('prefers the tour when both are sent', async () => {
		const [otherProfile] = await db()
			.select()
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantB))
			.limit(1);
		// Only meaningful if tenant B actually has a profile to point at.
		if (!otherProfile) return;

		const { status, body } = await post(
			{
				tour: publishedSlug,
				operator: otherProfile.slug,
				firstName: 'Ada',
				email: 'ada2@example.com'
			},
			'203.0.113.36'
		);
		expect(status).toBe(200);
		const row = await rowFor(body.data.reference as string);
		expect(row.tenantId, 'the tour is the more specific of the two').toBe(tenantA);
	});

	/* ---- unavailable listings ---------------------------------------------- */

	it('refuses an enquiry against a draft listing', async () => {
		const { status } = await post({ tour: draftSlug, firstName: 'Eve', email: 'eve@example.com' }, '203.0.113.13');
		expect(status).toBe(404);
	});

	it('answers a draft slug and an unknown slug identically', async () => {
		const draft = await post({ tour: draftSlug, firstName: 'Eve', email: 'e1@example.com' }, '203.0.113.14');
		const unknown = await post({ tour: 'no-such-tour', firstName: 'Eve', email: 'e2@example.com' }, '203.0.113.15');
		expect(draft.status).toBe(unknown.status);
		expect(JSON.stringify(draft.body.error)).toBe(JSON.stringify(unknown.body.error));
	});

	/* ---- WhatsApp absence -------------------------------------------------- */

	it('creates the enquiry even though the tenant has no connected WhatsApp', async () => {
		// Neither test tenant has a WhatsApp connection, so resolveCredentials
		// returns null for both. The enquiry must still be created and answerable —
		// a missing notification channel is not a reason to lose a customer.
		const { resolveCredentials } = await import('../src/lib/server/whatsapp/connections');
		expect(await resolveCredentials(tenantA), 'no connection means null, never a platform fallback').toBeNull();

		const { status, body } = await post({
			tour: publishedSlug, firstName: 'Grace', email: 'grace@example.com'
		}, '203.0.113.16');

		expect(status).toBe(200);
		const row = await rowFor(body.data.reference as string);
		expect(row, 'the enquiry survives having nowhere to send a notification').toBeTruthy();
		expect(row.tenantId).toBe(tenantA);
	});

	/* ---- what comes back --------------------------------------------------- */

	it('returns a reference and nothing internal', async () => {
		const { body } = await post({
			tour: publishedSlug, firstName: 'Alan', email: 'alan@example.com'
		}, '203.0.113.17');

		expect(Object.keys(body.data).sort()).toEqual(['message', 'reference']);
		const serialized = JSON.stringify(body);
		for (const secret of [tenantA, tenantB, publishedTourId]) {
			expect(serialized, 'no internal id may reach the traveller').not.toContain(secret);
		}
	});

	/* ---- attribution -------------------------------------------------------- */

	it('stores allow-listed attribution in metadata and drops the rest', async () => {
		const { body } = await post({
			tour: publishedSlug,
			firstName: 'Attr',
			email: 'attr@example.com',
			attribution: {
				utmSource: 'google',
				utmMedium: 'cpc',
				sessionId: 'sess_123',
				// Not in the allow-list — must be stripped, not stored.
				evilPayload: 'x'.repeat(5000),
				isAdmin: true
			}
		}, '203.0.113.18');

		const row = await rowFor(body.data.reference as string);
		const meta = row.metadata as { marketplace?: Record<string, unknown> };
		expect(meta.marketplace?.utmSource).toBe('google');
		expect(meta.marketplace?.sessionId).toBe('sess_123');
		expect(meta.marketplace).not.toHaveProperty('evilPayload');
		expect(meta.marketplace).not.toHaveProperty('isAdmin');
		expect(JSON.stringify(row.metadata).length, 'attribution cannot be a storage vector').toBeLessThan(2000);
	});

	/* ---- validation ---------------------------------------------------------- */

	it('insists on a way to reply', async () => {
		const { status } = await post({ tour: publishedSlug, firstName: 'Nobody' }, '203.0.113.19');
		expect(status).toBe(422);
	});

	it('rejects malformed JSON and missing fields without leaking internals', async () => {
		const { status, body } = await post({ firstName: 'NoTour' }, '203.0.113.20');
		expect(status).toBe(422);
		expect(JSON.stringify(body)).not.toContain('booking_requests');
		expect(JSON.stringify(body)).not.toContain('tenant');
	});

	it('rate-limits a single caller hammering the endpoint', async () => {
		const ip = '203.0.113.99';
		let limited = false;
		for (let i = 0; i < 15; i++) {
			const { status } = await post({ tour: publishedSlug, firstName: `Flood${i}`, email: `f${i}@example.com` }, ip);
			if (status === 429) { limited = true; break; }
		}
		expect(limited, 'an anonymous writer must hit a ceiling').toBe(true);
	});
});
