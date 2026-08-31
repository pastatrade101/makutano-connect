// The marketplace's geography is PLATFORM data, and these tests are about what
// the database refuses.
//
// The whole reason countries and destinations are not tenant-owned is that six
// operators would otherwise create "Serengeti", "Serengeti NP", "Serengeti
// National Park" and "The Serengeti", and the marketplace would have four rival
// pages chasing one search result. That guarantee is worth nothing if it lives
// only in a service function somebody can bypass — so it is asserted here at the
// level that actually enforces it.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('marketplace geography integrity', () => {
	let tenantId: string;
	let sql: typeof import('postgres') extends never ? never : any;
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Geography Co',
			slug: `test-geo-${Date.now()}`
		} as never);
		tenantId = tenant.id;
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
	}, 120_000);

	const country = async (slug: string) => {
		const [row] = await db()
			.select()
			.from(schema.countries)
			.where(eq(schema.countries.slug, slug))
			.limit(1);
		return row;
	};

	const destination = async (slug: string) => {
		const [row] = await db()
			.select()
			.from(schema.destinations)
			.where(eq(schema.destinations.slug, slug))
			.limit(1);
		return row;
	};

	/* ---- the reference data itself ------------------------------------- */

	it('seeds the canonical countries', async () => {
		for (const slug of ['tanzania', 'kenya', 'uganda', 'rwanda']) {
			expect(await country(slug), `country ${slug}`).toBeTruthy();
		}
	});

	it('places Zanzibar under Tanzania as a destination, not as a country', async () => {
		// The single most likely modelling mistake in East African travel, and one
		// the brief called out explicitly.
		expect(await country('zanzibar')).toBeFalsy();

		const zanzibar = await destination('zanzibar');
		expect(zanzibar).toBeTruthy();
		expect(zanzibar.destinationType).toBe('ISLAND');

		const tanzania = await country('tanzania');
		expect(zanzibar.countryId).toBe(tanzania.id);
	});

	it('classifies destinations by PLACE, never by travel style', async () => {
		// "Luxury" and "Honeymoon" are experiences, not places. If either ever
		// appears as a destination the taxonomy has been blurred.
		const rows = await db().select().from(schema.destinations);
		const names = rows.map((r) => r.name.toLowerCase());
		for (const style of ['luxury', 'honeymoon', 'family', 'budget', 'photography']) {
			expect(names, `${style} must not be a destination`).not.toContain(style);
		}
		expect(rows.find((r) => r.slug === 'serengeti-national-park')?.destinationType).toBe('NATIONAL_PARK');
		expect(rows.find((r) => r.slug === 'mount-kilimanjaro')?.destinationType).toBe('MOUNTAIN');
	});

	/* ---- referential integrity ------------------------------------------ */

	it('refuses a destination whose country does not exist', async () => {
		await expect(
			db()
				.insert(schema.destinations)
				.values({
					countryId: '00000000-0000-0000-0000-000000000000',
					name: 'Nowhere',
					slug: `nowhere-${Date.now()}`
				})
		).rejects.toThrow();
	});

	it('refuses a tour whose primary country does not exist', async () => {
		await expect(
			db()
				.insert(schema.tours)
				.values({
					tenantId,
					primaryCountryId: '00000000-0000-0000-0000-000000000000',
					title: 'Nowhere Safari',
					slug: `nowhere-safari-${Date.now()}`
				})
		).rejects.toThrow();
	});

	it('keeps destination slugs unique across the whole marketplace', async () => {
		// Global, not per country: the public URL is /destinations/<slug> with no
		// country segment, so two "victoria" rows would fight over one page.
		const tanzania = await country('tanzania');
		await expect(
			db()
				.insert(schema.destinations)
				.values({ countryId: tanzania.id, name: 'Serengeti Again', slug: 'serengeti-national-park' })
		).rejects.toThrow();
	});

	/* ---- what deletion must NOT do -------------------------------------- */

	it('refuses to delete a country that still has destinations', async () => {
		const tanzania = await country('tanzania');
		await expect(
			db().delete(schema.countries).where(eq(schema.countries.id, tanzania.id))
		).rejects.toThrow();
	});

	it('refuses to delete a destination a tour still visits', async () => {
		const tanzania = await country('tanzania');
		const serengeti = await destination('serengeti-national-park');

		const [tour] = await db()
			.insert(schema.tours)
			.values({
				tenantId,
				primaryCountryId: tanzania.id,
				title: 'Restrict Probe',
				slug: `restrict-probe-${Date.now()}`
			})
			.returning();

		await db()
			.insert(schema.tourDestinations)
			.values({ tourId: tour.id, destinationId: serengeti.id });

		// RESTRICT, not cascade: removing a place must never silently delete the
		// listings that sell it. Retire it with status instead.
		await expect(
			db().delete(schema.destinations).where(eq(schema.destinations.id, serengeti.id))
		).rejects.toThrow();

		// Cleaning up the tour DOES release the link — the protection is on the
		// destination, not on the join row.
		await db().delete(schema.tours).where(eq(schema.tours.id, tour.id));
		const links = await db()
			.select()
			.from(schema.tourDestinations)
			.where(eq(schema.tourDestinations.tourId, tour.id));
		expect(links).toHaveLength(0);
	});

	/* ---- tour slugs ------------------------------------------------------ */

	it('keeps one live tour per slug, and releases the slug on soft delete', async () => {
		const tanzania = await country('tanzania');
		const slug = `slug-probe-${Date.now()}`;

		const [first] = await db()
			.insert(schema.tours)
			.values({ tenantId, primaryCountryId: tanzania.id, title: 'Probe A', slug })
			.returning();

		await expect(
			db()
				.insert(schema.tours)
				.values({ tenantId, primaryCountryId: tanzania.id, title: 'Probe B', slug })
		).rejects.toThrow();

		// tours_slug_live_idx is PARTIAL (WHERE deleted_at IS NULL), so retiring a
		// listing hands its slug back rather than burning it forever.
		await db()
			.update(schema.tours)
			.set({ deletedAt: new Date() })
			.where(eq(schema.tours.id, first.id));

		const [reused] = await db()
			.insert(schema.tours)
			.values({ tenantId, primaryCountryId: tanzania.id, title: 'Probe C', slug })
			.returning();
		expect(reused.slug).toBe(slug);

		await db().delete(schema.tours).where(eq(schema.tours.id, reused.id));
		await db().delete(schema.tours).where(eq(schema.tours.id, first.id));
	});

	it('starts every tour in DRAFT — never publicly visible by default', async () => {
		const tanzania = await country('tanzania');
		const [tour] = await db()
			.insert(schema.tours)
			.values({
				tenantId,
				primaryCountryId: tanzania.id,
				title: 'Default Status Probe',
				slug: `default-status-${Date.now()}`
			})
			.returning();
		expect(tour.status).toBe('DRAFT');
		expect(tour.publishedAt).toBeNull();
		expect(tour.featured).toBe(false);
		await db().delete(schema.tours).where(eq(schema.tours.id, tour.id));
	});
});
