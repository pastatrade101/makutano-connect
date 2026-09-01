// What the public is allowed to see, and what it must never see.
//
// Two failures would matter here and neither is visible by reading a route:
//   - an unpublished listing leaking into a public list or resolving by slug;
//   - an operator's internal identity (tenant id, review notes, storage keys)
//     riding along inside an otherwise innocent-looking response.
//
// resolveTourOwner is tested hardest, because it is the function that decides
// which business an enquiry belongs to. If it ever answered for a draft, a
// stranger could attach an enquiry to a listing that was never published.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

const HIDDEN = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'UNPUBLISHED', 'ARCHIVED'] as const;

suite('marketplace public reads', () => {
	let tenantId: string;
	let countryId: string;
	let serengeti: string;
	let ngorongoro: string;
	let mediaId: string;
	let MP: typeof import('../src/lib/server/marketplace');
	let T: typeof import('../src/lib/server/tours');
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Public Reads Co', slug: `test-pub-${Date.now()}` } as never);
		tenantId = tenant.id;
		MP = await import('../src/lib/server/marketplace');
		T = await import('../src/lib/server/tours');
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		const { liftLimits } = await import('./support');
		await liftLimits(tenantId);

		const [c] = await db().select().from(schema.countries).where(eq(schema.countries.slug, 'tanzania')).limit(1);
		countryId = c.id;
		const [s] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'serengeti-national-park')).limit(1);
		serengeti = s.id;
		const [n] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'ngorongoro-conservation-area')).limit(1);
		ngorongoro = n.id;
		const [m] = await db().insert(schema.media).values({
			tenantId, objectKey: `pub/${Date.now()}.jpg`, url: 'https://cdn.example.test/h.jpg', mimeType: 'image/jpeg'
		}).returning();
		mediaId = m.id;

		// An operator profile, so the public tour detail has one to project.
		await db().insert(schema.operatorProfiles).values({
			tenantId, slug: `pub-operator-${Date.now()}`, displayName: 'Public Reads Safaris',
			location: 'Arusha, Tanzania', isVerified: true, specialties: ['Migration'], languages: ['English']
		});
	}, 120_000);

	const buildTour = async (status: string, title = `Public Probe ${Math.random().toString(36).slice(2, 8)}`) => {
		const tour = await T.createTour(tenantId, {
			title, primaryCountryId: countryId, shortDescription: 'Visible only when published.',
			durationDays: 4, priceFrom: '2000.00', currency: 'USD', heroMediaId: mediaId
		});
		await T.setTourDestinations(tenantId, tour.id, [serengeti, ngorongoro]);
		await T.replaceItinerary(tenantId, tour.id, [
			{ dayNumber: 1, title: 'Arrive', destinationId: serengeti },
			{ dayNumber: 2, title: 'Serengeti again', destinationId: serengeti },
			{ dayNumber: 3, title: 'Crater', destinationId: ngorongoro },
			{ dayNumber: 4, title: 'Depart', destinationId: ngorongoro }
		] as never);
		await db().update(schema.tours)
			.set({ status: status as never, publishedAt: status === 'PUBLISHED' ? new Date() : null })
			.where(eq(schema.tours.id, tour.id));
		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tour.id)).limit(1);
		return row;
	};

	/* ---- published-only enforcement -------------------------------------- */

	it('lists a published tour', async () => {
		const tour = await buildTour('PUBLISHED');
		const { items } = await MP.listPublishedTours({ page: 1, perPage: 50 } as never);
		expect(items.map((t) => t.slug)).toContain(tour.slug);
	});

	it('hides a tour in EVERY non-published state, from list and from slug alike', async () => {
		for (const status of HIDDEN) {
			const tour = await buildTour(status);

			const { items } = await MP.listPublishedTours({ page: 1, perPage: 100 } as never);
			expect(items.map((t) => t.slug), `${status} must not be listed`).not.toContain(tour.slug);

			expect(await MP.getPublishedTourBySlug(tour.slug), `${status} must 404 like an unknown slug`).toBeNull();
		}
	});

	it('hides a soft-deleted tour even though it is still PUBLISHED', async () => {
		// The nastiest case: the status column still says PUBLISHED, and only
		// deletedAt says otherwise. A filter that checks one and not the other
		// leaves a deleted listing on the public site.
		const tour = await buildTour('PUBLISHED');
		await db().update(schema.tours).set({ deletedAt: new Date() }).where(eq(schema.tours.id, tour.id));

		const { items } = await MP.listPublishedTours({ page: 1, perPage: 100 } as never);
		expect(items.map((t) => t.slug)).not.toContain(tour.slug);
		expect(await MP.getPublishedTourBySlug(tour.slug)).toBeNull();
	});

	it('returns an unknown slug and an unpublished slug IDENTICALLY', async () => {
		const draft = await buildTour('DRAFT');
		expect(await MP.getPublishedTourBySlug(draft.slug)).toBeNull();
		expect(await MP.getPublishedTourBySlug('no-such-tour-at-all')).toBeNull();
	});

	/* ---- ownership resolution -------------------------------------------- */

	it('resolves the owning tenant from a published tour', async () => {
		const tour = await buildTour('PUBLISHED');
		const owner = await MP.resolveTourOwner(tour.slug);
		expect(owner).toEqual({ tourId: tour.id, tenantId });
	});

	it('refuses to resolve an owner for an unpublished tour', async () => {
		// Otherwise a stranger could attach an enquiry to a listing that was
		// never put in front of the public.
		for (const status of HIDDEN) {
			const tour = await buildTour(status);
			expect(await MP.resolveTourOwner(tour.slug), `${status} must not resolve an owner`).toBeNull();
			expect(await MP.resolveTourOwner(tour.id), `${status} must not resolve by id either`).toBeNull();
		}
	});

	it('survives junk input without throwing a database cast error', async () => {
		// A uuid column compared against arbitrary text is a Postgres error, not a
		// miss — so the resolver has to tell the two shapes apart.
		for (const junk of ['', '   ', 'not-a-uuid', "'; drop table tours; --", '../../etc/passwd']) {
			expect(await MP.resolveTourOwner(junk)).toBeNull();
		}
	});

	/* ---- what must never appear in a public payload ---------------------- */

	it('never exposes tenant identity, review notes or storage keys', async () => {
		const tour = await buildTour('PUBLISHED');
		await db().update(schema.tours)
			.set({ reviewNote: 'INTERNAL-REVIEW-NOTE', metadata: { secret: 'INTERNAL-METADATA' } })
			.where(eq(schema.tours.id, tour.id));

		const detail = await MP.getPublishedTourBySlug(tour.slug);
		expect(detail).toBeTruthy();

		const serialized = JSON.stringify(detail);
		for (const secret of [tenantId, 'INTERNAL-REVIEW-NOTE', 'INTERNAL-METADATA', 'objectKey', 'storage_key']) {
			expect(serialized, `${secret} must never reach the public`).not.toContain(secret);
		}
		expect(detail).not.toHaveProperty('tenantId');
	});

	it('gives an operator card only the fields a public page needs', async () => {
		const tour = await buildTour('PUBLISHED');
		const detail = await MP.getPublishedTourBySlug(tour.slug);
		const operator = (detail as { operator?: Record<string, unknown> }).operator;

		if (operator) {
			expect(Object.keys(operator).sort()).toEqual(
				[
					'about',
					'cover',
					'displayName',
					'isVerified',
					'languages',
					'location',
					'logo',
					// The public contact block. NULL when the operator did not publish
					// it — never a fallback to the account's own operational details.
					'publicEmail',
					'publicPhone',
					'slug',
					'specialties',
					'websiteUrl',
					'yearsInBusiness'
				].sort()
			);
			expect(operator).not.toHaveProperty('tenantId');
			expect(operator).not.toHaveProperty('id');
		}
	});

	/*
	 * The marketplace renders BOTH payloads from hand-written copies of these
	 * types in a different repository, and nothing type-checks the two against
	 * each other. Twice now a field the marketplace read has been missing from
	 * the projection, and both times the page 500ed on `undefined.map` — once for
	 * every listing page, the moment the first tour was published.
	 *
	 * These two tests are the guard rail: they assert the SHAPE the marketplace
	 * relies on, so the drift fails here instead of on a public page.
	 */
	it('gives a tour card every discovery axis the marketplace renders', async () => {
		const tour = await buildTour('PUBLISHED');
		const { items } = await MP.listPublishedTours({ page: 1, limit: 20 } as never);
		const card = items.find((c) => c.slug === tour.slug);
		expect(card, 'the published tour should be listed').toBeTruthy();

		// Arrays, never undefined: the card maps over all three without guarding.
		expect(Array.isArray(card!.destinations)).toBe(true);
		expect(Array.isArray(card!.styles)).toBe(true);
		expect(card!).toHaveProperty('category');
	});

	it('gives the tour detail its category and travel styles', async () => {
		const tour = await buildTour('PUBLISHED');
		const detail = await MP.getPublishedTourBySlug(tour.slug);
		expect(detail).toBeTruthy();
		expect(detail!.tour).toHaveProperty('category');
		expect(Array.isArray(detail!.tour.styles)).toBe(true);
	});

	/* ---- derived data ----------------------------------------------------- */

	it('derives the route from the itinerary, collapsing consecutive repeats', async () => {
		// Days are Serengeti, Serengeti, Ngorongoro, Ngorongoro — the traveller
		// should read "Serengeti → Ngorongoro", not the same name four times.
		const tour = await buildTour('PUBLISHED');
		const detail = await MP.getPublishedTourBySlug(tour.slug);
		const route = (detail as { route?: Array<{ name?: string; slug?: string }> }).route ?? [];

		const names = route.map((r) => r.slug ?? r.name);
		expect(names).toEqual(['serengeti-national-park', 'ngorongoro-conservation-area']);
	});

	/* ---- geography reads --------------------------------------------------- */

	it('lists only active countries and published destinations', async () => {
		const countries = await MP.listCountries();
		expect(countries.map((c) => c.slug)).toContain('tanzania');
		// Kenya, Uganda and Rwanda were DEACTIVATED, not deleted, when the
		// marketplace narrowed to Tanzania. Listing them would offer a country
		// filter that matches nothing.
		expect(countries.map((c) => c.slug)).not.toContain('kenya');

		const { items } = await MP.listDestinations({} as never);
		expect(items.every((d) => Boolean(d.slug))).toBe(true);
		expect(items.map((d) => d.slug)).toContain('serengeti-national-park');
		// Zanzibar is a destination of Tanzania, never a country of its own.
		expect(countries.map((c) => c.slug)).not.toContain('zanzibar');
		expect(items.map((d) => d.slug)).toContain('zanzibar');
	});

	it('hides a destination that is not PUBLISHED', async () => {
		// A THROWAWAY destination, not a seeded one. Countries and destinations are
		// PLATFORM data shared by every test file, and vitest runs files in
		// parallel — flipping Tsavo's status here made an unrelated suite see it
		// mid-flip. Anything that mutates shared reference data has to bring its
		// own row.
		const [tanzania] = await db()
			.select()
			.from(schema.countries)
			.where(eq(schema.countries.slug, 'tanzania'))
			.limit(1);
		const slug = `probe-hidden-${Date.now()}`;
		const [temp] = await db()
			.insert(schema.destinations)
			.values({ countryId: tanzania.id, name: 'Hidden Probe', slug, status: 'DRAFT' })
			.returning();

		const { items } = await MP.listDestinations({} as never);
		expect(items.map((d) => d.slug)).not.toContain(slug);
		expect(await MP.getDestinationBySlug(slug)).toBeNull();

		// Publishing it makes it appear — the status is genuinely what gates it.
		await db()
			.update(schema.destinations)
			.set({ status: 'PUBLISHED' })
			.where(eq(schema.destinations.id, temp.id));
		const after = await MP.listDestinations({} as never);
		expect(after.items.map((d) => d.slug)).toContain(slug);

		await db().delete(schema.destinations).where(eq(schema.destinations.id, temp.id));
	});
});
