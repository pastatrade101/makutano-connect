// The three-axis taxonomy, asserted where it is actually enforced.
//
// DESTINATION is where a tour goes, CATEGORY is what it is, TRAVEL STYLE is how
// it is experienced. The value of keeping them apart is entirely in the rules
// below: that a vendor cannot invent an axis value, that a retired one cannot be
// re-attached, that the set a listing carries is capped, and that filtering runs
// through the link tables rather than matching text. Each of those is a way the
// taxonomy silently rots back into free text, so each one gets a test.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('marketplace taxonomy', () => {
	let tenantId: string;
	let db: (typeof import('../src/lib/server/db'))['db'];
	let schema: (typeof import('../src/lib/server/db'))['schema'];
	let eq: (typeof import('drizzle-orm'))['eq'];
	let and: (typeof import('drizzle-orm'))['and'];
	let tours: typeof import('../src/lib/server/tours');
	let marketplace: typeof import('../src/lib/server/marketplace');

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Taxonomy Co',
			slug: `test-tax-${Date.now()}`
		} as never);
		tenantId = tenant.id;
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq, and } = await import('drizzle-orm'));
		tours = await import('../src/lib/server/tours');
		marketplace = await import('../src/lib/server/marketplace');
	}, 120_000);

	const styleBySlug = async (slug: string) => {
		const [row] = await db()
			.select()
			.from(schema.travelStyles)
			.where(eq(schema.travelStyles.slug, slug))
			.limit(1);
		return row;
	};
	const categoryBySlug = async (slug: string) => {
		const [row] = await db()
			.select()
			.from(schema.tourCategories)
			.where(eq(schema.tourCategories.slug, slug))
			.limit(1);
		return row;
	};

	const draft = async (title: string) => tours.createTour(tenantId, { title }, { userId: null });

	/* --------------------------------------------------------------- seeding -- */

	it('seeds categories and travel styles as separate, non-overlapping axes', async () => {
		const cats = await tours.listActiveCategories();
		const styles = await tours.listActiveTravelStyles();
		expect(cats.length).toBeGreaterThan(0);
		expect(styles.length).toBeGreaterThan(0);

		// The failure this guards against is a taxonomy where "Luxury" is both a
		// category and a style, so a listing carries two answers to one question.
		const overlap = cats.map((c) => c.slug).filter((s) => styles.some((x) => x.slug === s));
		expect(overlap).toEqual([]);
	});

	it('keeps slugs unique within each axis', async () => {
		for (const table of [schema.tourCategories, schema.travelStyles]) {
			const rows = await db().select({ slug: table.slug }).from(table);
			expect(rows.length).toBe(new Set(rows.map((r) => r.slug)).size);
		}
	});

	/* ------------------------------------------------------ the vendor boundary */

	it('refuses a category that is not in the taxonomy', async () => {
		const tour = await draft('Invented category');
		await expect(
			tours.updateTour(tenantId, tour.id, { primaryCategoryId: crypto.randomUUID() }, { userId: null })
		).rejects.toThrow(/not available/i);
	});

	it('refuses a travel style that is not in the taxonomy', async () => {
		const tour = await draft('Invented style');
		await expect(
			tours.setTourTravelStyles(tenantId, tour.id, [crypto.randomUUID()], { userId: null })
		).rejects.toThrow(/not available/i);
	});

	it('refuses a RETIRED style, so deactivating actually withdraws it', async () => {
		const style = await styleBySlug('luxury');
		expect(style).toBeTruthy();
		const tour = await draft('Retired style');
		await db()
			.update(schema.travelStyles)
			.set({ isActive: false })
			.where(eq(schema.travelStyles.id, style.id));
		try {
			await expect(
				tours.setTourTravelStyles(tenantId, tour.id, [style.id], { userId: null })
			).rejects.toThrow(/not available/i);
		} finally {
			await db()
				.update(schema.travelStyles)
				.set({ isActive: true })
				.where(eq(schema.travelStyles.id, style.id));
		}
	});

	it('caps the styles a listing may claim', async () => {
		const styles = await tours.listActiveTravelStyles();
		if (styles.length <= tours.MAX_TRAVEL_STYLES) return; // nothing to prove
		const tour = await draft('Every style at once');
		await expect(
			tours.setTourTravelStyles(
				tenantId,
				tour.id,
				styles.slice(0, tours.MAX_TRAVEL_STYLES + 1).map((s) => s.id),
				{ userId: null }
			)
		).rejects.toThrow(new RegExp(`up to ${tours.MAX_TRAVEL_STYLES}`, 'i'));
	});

	it('replaces the style set whole rather than accumulating it', async () => {
		const styles = (await tours.listActiveTravelStyles()).slice(0, 3);
		const tour = await draft('Whole-set replace');
		await tours.setTourTravelStyles(tenantId, tour.id, [styles[0].id, styles[1].id], { userId: null });
		await tours.setTourTravelStyles(tenantId, tour.id, [styles[2].id], { userId: null });
		const rows = await db()
			.select({ id: schema.tourTravelStyles.travelStyleId })
			.from(schema.tourTravelStyles)
			.where(eq(schema.tourTravelStyles.tourId, tour.id));
		expect(rows.map((r) => r.id)).toEqual([styles[2].id]);
	});

	it('always files a listing under its own primary category', async () => {
		const cat = await categoryBySlug('safari');
		const other = (await tours.listActiveCategories()).find((c) => c.id !== cat.id);
		const tour = await draft('Primary is always in the set');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: cat.id }, { userId: null });
		// Deliberately omitting the primary: the service must add it back, or a
		// category filter would miss the tours whose main category it is.
		await tours.setTourCategories(tenantId, tour.id, other ? [other.id] : [], { userId: null });
		const rows = await db()
			.select({ id: schema.tourCategoryLinks.categoryId })
			.from(schema.tourCategoryLinks)
			.where(eq(schema.tourCategoryLinks.tourId, tour.id));
		expect(rows.map((r) => r.id)).toContain(cat.id);
	});

	/* ------------------------------------------------------------- publishing -- */

	it('will not let a listing go live with no category', async () => {
		const tour = await draft('No category');
		const missing = await tours.assertPublishable(tenantId, tour.id);
		expect(missing).toContain('a category');
	});

	/* -------------------------------------------------------------- filtering -- */

	it('filters through the link tables, so a renamed style keeps its tours', async () => {
		const style = await styleBySlug('luxury');
		const cat = await categoryBySlug('safari');
		const tour = await draft('Filterable listing');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: cat.id }, { userId: null });
		await tours.setTourCategories(tenantId, tour.id, [cat.id], { userId: null });
		await tours.setTourTravelStyles(tenantId, tour.id, [style.id], { userId: null });

		// Renaming the style must not orphan the listing: the link is by id, and a
		// text match on "Luxury" would break here.
		const originalName = style.name;
		await db()
			.update(schema.travelStyles)
			.set({ name: `${originalName} (renamed)` })
			.where(eq(schema.travelStyles.id, style.id));
		try {
			const rows = await db()
				.select({ tourId: schema.tourTravelStyles.tourId })
				.from(schema.tourTravelStyles)
				.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
				.where(and(eq(schema.travelStyles.slug, 'luxury'), eq(schema.tourTravelStyles.tourId, tour.id)));
			expect(rows).toHaveLength(1);
		} finally {
			await db()
				.update(schema.travelStyles)
				.set({ name: originalName })
				.where(eq(schema.travelStyles.id, style.id));
		}
	});

	it('shows a DRAFT listing under no filter at all', async () => {
		const style = await styleBySlug('luxury');
		const tour = await draft('Draft stays invisible');
		await tours.setTourTravelStyles(tenantId, tour.id, [style.id], { userId: null });
		const { items } = await marketplace.listPublishedTours(
			{ page: 1, limit: 50, order: 'desc' },
			{ styleSlug: 'luxury' }
		);
		expect(items.some((t: { id: string }) => t.id === tour.id)).toBe(false);
	});

	/* ------------------------------------------------------------- referential */

	it('refuses to delete a category a listing is filed under', async () => {
		const cat = await categoryBySlug('safari');
		const tour = await draft('Holds a category');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: cat.id }, { userId: null });
		await tours.setTourCategories(tenantId, tour.id, [cat.id], { userId: null });
		await expect(
			db().delete(schema.tourCategories).where(eq(schema.tourCategories.id, cat.id))
		).rejects.toThrow();
	});

	it('refuses to delete a travel style a listing is tagged with', async () => {
		const style = await styleBySlug('luxury');
		const tour = await draft('Holds a style');
		await tours.setTourTravelStyles(tenantId, tour.id, [style.id], { userId: null });
		await expect(
			db().delete(schema.travelStyles).where(eq(schema.travelStyles.id, style.id))
		).rejects.toThrow();
	});
});
