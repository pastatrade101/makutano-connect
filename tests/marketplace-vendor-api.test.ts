// The vendor API, exercised through the REAL route handlers.
//
// These routes are thin by design, so the interesting question is not whether
// they work — it is whether the thinness leaks authority. Three things are
// asserted from the outside: an API key cannot reach another tenant's listing,
// an API key cannot publish (the scope does not exist), and status is not
// something a PATCH can set.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

/** Everything a marketplace-capable key could legitimately hold. */
const SCOPES = ['tours:read', 'tours:write'];

suite('vendor tour API', () => {
	let tenantA: string;
	let tenantB: string;
	let countryId: string;
	let serengeti: string;
	let ngorongoro: string;
	let heroA: string;
	let mediaB: string;
	let tourA: string;
	let tourB: string;

	let routes: Record<string, { GET?: never; POST?: never; PATCH?: never; PUT?: never; DELETE?: never }>;
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	/** A request event shaped the way apiContext() reads it. */
	const ev = (tenantId: string, opts: { body?: unknown; params?: Record<string, string>; query?: string; scopes?: string[] } = {}) =>
		({
			locals: {
				tenant: { id: tenantId, name: 'T', currency: 'USD' },
				apiKey: { id: '00000000-0000-0000-0000-0000000000aa', scopes: opts.scopes ?? SCOPES },
				requestId: 'test'
			},
			params: opts.params ?? {},
			url: new URL(`http://localhost/api/v1/tours${opts.query ?? ''}`),
			request: new Request('http://localhost/api/v1/tours', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(opts.body ?? {})
			})
		}) as never;

	const call = async (handler: unknown, event: unknown) => {
		const res = (await (handler as (e: unknown) => Promise<Response>)(event)) as Response;
		return {
			status: res.status,
			body: (await res.json()) as {
				success: boolean;
				data: Record<string, any>;
				error?: { message: string };
			}
		};
	};

	beforeAll(async () => {
		const a = await provisionTestTenant({ name: 'Vendor A', slug: `test-va-${Date.now()}` } as never);
		const b = await provisionTestTenant({ name: 'Vendor B', slug: `test-vb-${Date.now()}` } as never);
		tenantA = a.id;
		tenantB = b.id;
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		const { liftLimits } = await import('./support');
		await liftLimits(tenantA);
		await liftLimits(tenantB);

		routes = {
			list: await import('../src/routes/api/v1/tours/+server'),
			one: await import('../src/routes/api/v1/tours/[id]/+server'),
			destinations: await import('../src/routes/api/v1/tours/[id]/destinations/+server'),
			itinerary: await import('../src/routes/api/v1/tours/[id]/itinerary/+server'),
			transitions: await import('../src/routes/api/v1/tours/[id]/transitions/+server')
		} as never;

		const [c] = await db().select().from(schema.countries).where(eq(schema.countries.slug, 'tanzania')).limit(1);
		countryId = c.id;
		const [s] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'serengeti-national-park')).limit(1);
		serengeti = s.id;
		const [n] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'ngorongoro-conservation-area')).limit(1);
		ngorongoro = n.id;

		const [ha] = await db().insert(schema.media).values({
			tenantId: tenantA, objectKey: `va/${Date.now()}.jpg`, url: 'https://cdn.test/a.jpg', mimeType: 'image/jpeg'
		}).returning();
		heroA = ha.id;
		const [mb] = await db().insert(schema.media).values({
			tenantId: tenantB, objectKey: `vb/${Date.now()}.jpg`, url: 'https://cdn.test/b.jpg', mimeType: 'image/jpeg'
		}).returning();
		mediaB = mb.id;

		const T = await import('../src/lib/server/tours');
		tourA = (await T.createTour(tenantA, { title: 'Vendor A Listing', primaryCountryId: countryId })).id;
		tourB = (await T.createTour(tenantB, { title: 'Vendor B Listing', primaryCountryId: countryId })).id;
	}, 120_000);

	/* ---- ordinary use ------------------------------------------------------ */

	it('creates a listing owned by the calling key’s tenant', async () => {
		const { status, body } = await call(routes.list.POST, ev(tenantA, {
			body: { title: 'Created Through The API', primaryCountryId: countryId, durationDays: 4 }
		}));
		expect(status).toBe(201);
		expect(body.data.tenantId).toBe(tenantA);
		expect(body.data.status, 'a new listing is never live').toBe('DRAFT');
		expect(body.data.slug).toBe('created-through-the-api');
	});

	it('lists only the calling tenant’s listings', async () => {
		const { body } = await call(routes.list.GET, ev(tenantA, { query: '?limit=100' }));
		const ids = (body.data as unknown as Array<{ id: string }>).map((t) => t.id);
		expect(ids).toContain(tourA);
		expect(ids, 'another tenant’s listing must not appear').not.toContain(tourB);
	});

	it('updates a draft', async () => {
		const { status, body } = await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourA }, body: { shortDescription: 'Edited.', durationDays: 6 }
		}));
		expect(status).toBe(200);
		expect(body.data.shortDescription).toBe('Edited.');
		expect(body.data.durationDays).toBe(6);
	});

	it('persists itinerary order and renumbers contiguously', async () => {
		const { status } = await call(routes.itinerary.PUT, ev(tenantA, {
			params: { id: tourA },
			body: { days: [
				{ dayNumber: 1, title: 'Arusha', destinationId: null },
				{ dayNumber: 2, title: 'Serengeti', destinationId: serengeti },
				{ dayNumber: 3, title: 'Ngorongoro', destinationId: ngorongoro }
			] }
		}));
		expect(status).toBe(200);

		const rows = await db().select().from(schema.tourItineraryDays)
			.where(eq(schema.tourItineraryDays.tourId, tourA));
		expect(rows.map((r) => r.dayNumber).sort((x, y) => x - y)).toEqual([1, 2, 3]);
		expect(rows.find((r) => r.dayNumber === 2)?.title).toBe('Serengeti');
	});

	/* ---- cross-tenant ------------------------------------------------------ */

	it('cannot read another tenant’s listing', async () => {
		const { status } = await call(routes.one.GET, ev(tenantA, { params: { id: tourB } }));
		expect(status, 'not 403 — that would confirm it exists').toBe(404);
	});

	it('cannot update another tenant’s listing', async () => {
		const { status } = await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourB }, body: { title: 'Hijacked' }
		}));
		expect(status).toBe(404);

		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tourB)).limit(1);
		expect(row.title).toBe('Vendor B Listing');
	});

	it('cannot delete another tenant’s listing', async () => {
		const { status } = await call(routes.one.DELETE, ev(tenantA, { params: { id: tourB } }));
		expect(status).toBe(404);
		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tourB)).limit(1);
		expect(row.deletedAt).toBeNull();
	});

	it('cannot attach another tenant’s media as its hero', async () => {
		const { status, body } = await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourA }, body: { heroMediaId: mediaB }
		}));
		expect(status).toBe(422);
		expect(body.error?.message).toMatch(/does not belong/i);
	});

	/* ---- platform-only actions --------------------------------------------- */

	it('refuses every platform action over an API key, by name', async () => {
		for (const action of ['approve', 'publish', 'request_changes', 'start_review']) {
			const { status, body } = await call(routes.transitions.POST, ev(tenantA, {
				params: { id: tourA }, body: { action, note: 'x' }
			}));
			expect(status, `${action} must be refused`).toBe(403);
			expect(body.error?.message).toMatch(/Makutano team/i);
		}
	});

	it('refuses a key that carries tours:publish anyway — the scope does not exist', async () => {
		// Even a forged scope list cannot help: requireApiScope only accepts values
		// in API_SCOPES, and tours:publish was deliberately left out of it.
		const { status } = await call(routes.transitions.POST, ev(tenantA, {
			params: { id: tourA },
			body: { action: 'publish' },
			scopes: [...SCOPES, 'tours:publish']
		}));
		expect(status).toBe(403);
	});

	it('does not let PATCH set status, featured or publishedAt', async () => {
		await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourA },
			body: { title: 'Still A Draft', status: 'PUBLISHED', featured: true, publishedAt: '2020-01-01' }
		}));
		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tourA)).limit(1);
		expect(row.title).toBe('Still A Draft');
		expect(row.status, 'status is not an editable column').toBe('DRAFT');
		expect(row.featured, 'featuring is a platform decision').toBe(false);
		expect(row.publishedAt).toBeNull();
	});

	/* ---- destinations ------------------------------------------------------- */

	it('accepts canonical destinations', async () => {
		const { status } = await call(routes.destinations.PUT, ev(tenantA, {
			params: { id: tourA }, body: { destinationIds: [serengeti, ngorongoro] }
		}));
		expect(status).toBe(200);
		const links = await db().select().from(schema.tourDestinations)
			.where(eq(schema.tourDestinations.tourId, tourA));
		expect(links).toHaveLength(2);
	});

	it('refuses an unknown destination rather than silently dropping it', async () => {
		const { status } = await call(routes.destinations.PUT, ev(tenantA, {
			params: { id: tourA },
			body: { destinationIds: [serengeti, '00000000-0000-0000-0000-000000000000'] }
		}));
		expect(status).toBe(422);
	});

	it('refuses a destination that is not published', async () => {
		// Its own throwaway row — see the note in marketplace-public-reads: these
		// are PLATFORM records shared by every suite, so mutating a seeded one
		// breaks whichever test file happens to be running beside this one.
		const slug = `probe-unpublished-${Date.now()}`;
		const [temp] = await db()
			.insert(schema.destinations)
			.values({ countryId, name: 'Unpublished Probe', slug, status: 'DRAFT' })
			.returning();

		const { status } = await call(routes.destinations.PUT, ev(tenantA, {
			params: { id: tourA }, body: { destinationIds: [temp.id] }
		}));
		expect(status).toBe(422);

		await db().delete(schema.destinations).where(eq(schema.destinations.id, temp.id));
	});

	/* ---- submission --------------------------------------------------------- */

	it('reports what is missing before submission, and blocks it', async () => {
		const { body } = await call(routes.transitions.GET, ev(tenantA, { params: { id: tourA } }));
		expect(body.data.canSubmit).toBe(false);
		expect(Array.isArray(body.data.missing)).toBe(true);

		const { status } = await call(routes.transitions.POST, ev(tenantA, {
			params: { id: tourA }, body: { action: 'submit' }
		}));
		expect(status).toBe(422);
	});

	it('submits once the listing is complete, and can be edited after changes are requested', async () => {
		// primaryCategoryId is part of "complete" now: a listing filed under no
		// category appears in no category filter, so assertPublishable counts it.
		const [category] = await db()
			.select({ id: schema.tourCategories.id })
			.from(schema.tourCategories)
			.where(eq(schema.tourCategories.isActive, true))
			.limit(1);
		await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourA },
			body: {
				shortDescription: 'Complete now.',
				priceFrom: '1900.00',
				currency: 'USD',
				heroMediaId: heroA,
				primaryCategoryId: category.id
			}
		}));

		const ready = await call(routes.transitions.GET, ev(tenantA, { params: { id: tourA } }));
		expect(ready.body.data.missing, 'nothing should be outstanding').toEqual([]);

		const submitted = await call(routes.transitions.POST, ev(tenantA, {
			params: { id: tourA }, body: { action: 'submit' }
		}));
		expect(submitted.status).toBe(200);
		expect(submitted.body.data.status).toBe('SUBMITTED');

		// The platform sends it back. Only the platform can do this, so it is done
		// through the service with canPublish: true, as the admin screen does.
		const T = await import('../src/lib/server/tours');
		await T.transitionTour(tenantA, tourA, 'request_changes', {}, {
			canPublish: true, note: 'Please add accommodation for days 3-5.'
		});

		const after = await call(routes.transitions.GET, ev(tenantA, { params: { id: tourA } }));
		expect(after.body.data.status).toBe('CHANGES_REQUESTED');
		expect(after.body.data.reviewNote).toBe('Please add accommodation for days 3-5.');

		// The vendor edits and resubmits.
		const edited = await call(routes.one.PATCH, ev(tenantA, {
			params: { id: tourA }, body: { accommodationSummary: 'Mobile camp, days 3-5.' }
		}));
		expect(edited.status).toBe(200);

		const resubmitted = await call(routes.transitions.POST, ev(tenantA, {
			params: { id: tourA }, body: { action: 'submit' }
		}));
		expect(resubmitted.status).toBe(200);
		expect(resubmitted.body.data.status).toBe('SUBMITTED');
	});

	/* ---- scopes -------------------------------------------------------------- */

	it('refuses a read-only key on writes', async () => {
		const { status } = await call(routes.list.POST, ev(tenantA, {
			body: { title: 'No Write Scope' }, scopes: ['tours:read']
		}));
		expect(status).toBe(403);
	});
});
