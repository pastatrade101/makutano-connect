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
	let sqlTag: (typeof import('drizzle-orm'))['sql'];
	let tours: typeof import('../src/lib/server/tours');
	let marketplace: typeof import('../src/lib/server/marketplace');

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Taxonomy Co',
			slug: `test-tax-${Date.now()}`
		} as never);
		tenantId = tenant.id;
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq, and, sql: sqlTag } = await import('drizzle-orm'));
		tours = await import('../src/lib/server/tours');
		marketplace = await import('../src/lib/server/marketplace');

		const stamp = Date.now();
		ownStyleSlug = `test-style-${stamp}`;
		const [cat] = await db()
			.insert(schema.tourCategories)
			.values({ name: `Test Category ${stamp}`, slug: `test-cat-${stamp}`, isActive: true, isFeatured: false })
			.returning();
		ownCategoryId = cat.id;
		const [style] = await db()
			.insert(schema.travelStyles)
			.values({ name: `Test Style ${stamp}`, slug: ownStyleSlug, isActive: true, isFeatured: false })
			.returning();
		ownStyleId = style.id;
	}, 120_000);

	/**
	 * Rows this suite OWNS.
	 *
	 * The destructive assertions below retire, rename and delete a taxonomy entry.
	 * Doing that to a seeded row locks it for the whole database, and vitest runs
	 * files in parallel — so the other suites' tour inserts queue behind the FK
	 * check and time out. These exist so this file can be destructive in private.
	 */
	let ownCategoryId: string;
	let ownStyleId: string;
	let ownStyleSlug: string;

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
		const tour = await draft('Retired style');
		await db()
			.update(schema.travelStyles)
			.set({ isActive: false })
			.where(eq(schema.travelStyles.id, ownStyleId));
		try {
			await expect(
				tours.setTourTravelStyles(tenantId, tour.id, [ownStyleId], { userId: null })
			).rejects.toThrow(/not available/i);
		} finally {
			await db()
				.update(schema.travelStyles)
				.set({ isActive: true })
				.where(eq(schema.travelStyles.id, ownStyleId));
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
		const cat = { id: ownCategoryId };
		const tour = await draft('Primary is always in the set');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: cat.id }, { userId: null });
		// Passing nothing at all: the service must still add the primary back, or a
		// category filter would miss the tours whose main category it is.
		await tours.setTourCategories(tenantId, tour.id, [], { userId: null });
		const rows = await db()
			.select({ id: schema.tourCategoryLinks.categoryId })
			.from(schema.tourCategoryLinks)
			.where(eq(schema.tourCategoryLinks.tourId, tour.id));
		expect(rows.map((r) => r.id)).toEqual([cat.id]);
	});

	/*
	 * A package belongs to exactly ONE category.
	 *
	 * A category is what the trip IS, and the axis a traveller filters on first;
	 * a listing that is two things at once ranks for neither. Enforced in the
	 * service rather than in the composer, because the composer is not the only
	 * writer — the vendor API and the mobile app call the same function, and a
	 * rule that lives in one form is not a rule.
	 */
	it('refuses a second category alongside the primary', async () => {
		const other = (await tours.listActiveCategories()).find((c) => c.id !== ownCategoryId);
		expect(other, 'the seed should provide more than one category').toBeTruthy();

		const tour = await draft('One category only');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: ownCategoryId }, { userId: null });
		// Establish the link first, so the rejection below has something it could
		// have damaged. Setting the primary column does not itself write a row.
		await tours.setTourCategories(tenantId, tour.id, [], { userId: null });

		await expect(
			tours.setTourCategories(tenantId, tour.id, [other!.id], { userId: null })
		).rejects.toThrow(/one category/i);

		// A refused write leaves the listing exactly as it was — filed under its
		// primary, not emptied by a replace that got half way.
		
		const rows = await db()
			.select({ id: schema.tourCategoryLinks.categoryId })
			.from(schema.tourCategoryLinks)
			.where(eq(schema.tourCategoryLinks.tourId, tour.id));
		expect(rows.map((r) => r.id)).toEqual([ownCategoryId]);
	});

	/* ------------------------------------------------------------- publishing -- */

	it('will not let a listing go live with no category', async () => {
		const tour = await draft('No category');
		const missing = await tours.assertPublishable(tenantId, tour.id);
		expect(missing).toContain('a category');
	});

	/* -------------------------------------------------------------- filtering -- */

	it('filters through the link tables, so a renamed style keeps its tours', async () => {
		const tour = await draft('Filterable listing');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: ownCategoryId }, { userId: null });
		await tours.setTourCategories(tenantId, tour.id, [ownCategoryId], { userId: null });
		await tours.setTourTravelStyles(tenantId, tour.id, [ownStyleId], { userId: null });

		// Renaming must not orphan the listing: the link is by id, and a filter that
		// matched on the NAME would lose the tour here. The slug is untouched.
		await db()
			.update(schema.travelStyles)
			.set({ name: 'Renamed Entirely' })
			.where(eq(schema.travelStyles.id, ownStyleId));

		const rows = await db()
			.select({ tourId: schema.tourTravelStyles.tourId })
			.from(schema.tourTravelStyles)
			.innerJoin(schema.travelStyles, eq(schema.travelStyles.id, schema.tourTravelStyles.travelStyleId))
			.where(and(eq(schema.travelStyles.slug, ownStyleSlug), eq(schema.tourTravelStyles.tourId, tour.id)));
		expect(rows).toHaveLength(1);
	});

	it('shows a DRAFT listing under no filter at all', async () => {
		const tour = await draft('Draft stays invisible');
		await tours.setTourTravelStyles(tenantId, tour.id, [ownStyleId], { userId: null });
		const { items } = await marketplace.listPublishedTours(
			{ page: 1, limit: 50, order: 'desc' },
			{ styleSlug: ownStyleSlug }
		);
		expect(items.some((t: { id: string }) => t.id === tour.id)).toBe(false);
	});

	/* ------------------------------------------------------------- referential */

	/**
	 * The delete rule, read from the catalogue rather than provoked.
	 *
	 * Provoking it — actually attempting the delete — is the more direct test and
	 * it is what this suite did first. But enforcing RESTRICT makes Postgres take
	 * locks against `tours`, the busiest table in the schema, and vitest runs
	 * suites in parallel against ONE database. The attempt did not fail, it
	 * queued: two minutes later it was still waiting, and it took the vendor-api
	 * suite down with it. Neither a lock_timeout nor a statement_timeout helps,
	 * because the wait is for a transaction connection before any statement runs.
	 *
	 * So this asserts the rule that Postgres enforces, rather than re-testing
	 * that Postgres enforces its own rules. What could actually regress here is
	 * somebody changing a migration to CASCADE — and that is exactly what this
	 * catches, without being able to jam the run.
	 */
	const deleteRuleFor = async (table: string, column: string): Promise<string> => {
		const rows = (await db().execute(sqlTag`
			select rc.delete_rule
			from information_schema.referential_constraints rc
			join information_schema.key_column_usage k
			  on k.constraint_name = rc.constraint_name
			 and k.constraint_schema = rc.constraint_schema
			where k.table_name = ${table} and k.column_name = ${column}
			limit 1
		`)) as unknown as Array<{ delete_rule: string }>;
		return rows[0]?.delete_rule ?? 'MISSING';
	};

	it('will not let a category be deleted out from under the listings filed there', async () => {
		const tour = await draft('Holds a category');
		await tours.updateTour(tenantId, tour.id, { primaryCategoryId: ownCategoryId }, { userId: null });
		await tours.setTourCategories(tenantId, tour.id, [ownCategoryId], { userId: null });

		// The link exists, and both routes to the category refuse a delete.
		const links = await db()
			.select({ id: schema.tourCategoryLinks.categoryId })
			.from(schema.tourCategoryLinks)
			.where(eq(schema.tourCategoryLinks.tourId, tour.id));
		expect(links.map((l) => l.id)).toContain(ownCategoryId);
		expect(await deleteRuleFor('tours', 'primary_category_id')).toBe('RESTRICT');
		expect(await deleteRuleFor('tour_category_links', 'category_id')).toBe('RESTRICT');
	});

	it('will not let a travel style be deleted out from under the listings tagged with it', async () => {
		const tour = await draft('Holds a style');
		await tours.setTourTravelStyles(tenantId, tour.id, [ownStyleId], { userId: null });

		const links = await db()
			.select({ id: schema.tourTravelStyles.travelStyleId })
			.from(schema.tourTravelStyles)
			.where(eq(schema.tourTravelStyles.tourId, tour.id));
		expect(links.map((l) => l.id)).toContain(ownStyleId);
		expect(await deleteRuleFor('tour_travel_styles', 'travel_style_id')).toBe('RESTRICT');
	});
});
