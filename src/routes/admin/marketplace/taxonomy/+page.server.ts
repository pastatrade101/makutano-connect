// The two discovery axes that are not geography: CATEGORY and TRAVEL STYLE.
//
// Platform-owned for the same reason destinations are. Left to vendors, "Luxury",
// "Luxury Safari", "luxury trip" and "Premium Luxury" become four filters that each
// match a fraction of the inventory, and the navigation quietly stops working. The
// composer only ever SELECTS from these tables; this file is the only place they
// are written.
//
// No guard is repeated here: admin/+layout.server.ts already requires
// locals.user.isSuperAdmin for everything under /admin, and a second check that
// could drift from the first is worse than none.
//
// DEACTIVATE, never delete. Both tables are referenced with ON DELETE RESTRICT, so
// a row a tour points at cannot be removed anyway — and should not be. Deactivating
// keeps every listing working and simply stops the marketplace offering the filter.
import { fail } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { Actions, PageServerLoad } from './$types';

type Axis = 'category' | 'style';

const table = (axis: Axis) => (axis === 'category' ? schema.tourCategories : schema.travelStyles);

const text = (d: FormData, key: string): string | null => String(d.get(key) ?? '').trim() || null;
const flag = (d: FormData, key: string): boolean => d.has(key);
const whole = (d: FormData, key: string): number => {
	const n = Number(String(d.get(key) ?? '').trim());
	return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);

/**
 * A slug is a public URL, so it is resolved rather than trusted.
 *
 * Unique per axis, not globally: /tours?category=safari and /travel-styles/luxury
 * are different namespaces and a category may legitimately share a word with a
 * style. `self` excuses a row from colliding with itself on rename.
 */
async function resolveSlug(axis: Axis, name: string, given: string | null, self: string | null) {
	const base = slugify(given || name);
	if (!base) throw new Error('That name has no usable URL in it.');
	const t = table(axis);
	const rows = await db().select({ id: t.id, slug: t.slug }).from(t);
	const taken = new Set(rows.filter((r) => r.id !== self).map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let n = 2; n < 200; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
	throw new Error('That name is already in use.');
}

const failure = (err: unknown) => fail(400, { message: toAppError(err).message });

const axisOf = (d: FormData): Axis => (String(d.get('axis') ?? '') === 'style' ? 'style' : 'category');
const label = (axis: Axis) => (axis === 'category' ? 'Category' : 'Travel style');

export const load: PageServerLoad = async () => {
	// Usage counts come from the link tables, because "can I retire this" is the
	// only question this screen is really for, and it has a number as an answer.
	const [categories, styles] = await Promise.all([
		db()
			.select({
				row: schema.tourCategories,
				tours: sql<number>`(select count(*) from tour_category_links l where l.category_id = tour_categories.id)::int`,
				primaryFor: sql<number>`(select count(*) from tours t where t.primary_category_id = tour_categories.id and t.deleted_at is null)::int`
			})
			.from(schema.tourCategories)
			.orderBy(asc(schema.tourCategories.sortOrder), asc(schema.tourCategories.name)),
		db()
			.select({
				row: schema.travelStyles,
				tours: sql<number>`(select count(*) from tour_travel_styles l where l.travel_style_id = travel_styles.id)::int`,
				primaryFor: sql<number>`0::int`
			})
			.from(schema.travelStyles)
			.orderBy(asc(schema.travelStyles.sortOrder), asc(schema.travelStyles.name))
	]);

	const project = (r: { row: typeof schema.tourCategories.$inferSelect | typeof schema.travelStyles.$inferSelect; tours: number; primaryFor: number }) => ({
		id: r.row.id,
		name: r.row.name,
		slug: r.row.slug,
		shortDescription: r.row.shortDescription,
		description: r.row.description,
		icon: r.row.icon,
		isActive: r.row.isActive,
		isFeatured: r.row.isFeatured,
		sortOrder: r.row.sortOrder,
		tours: r.tours,
		primaryFor: r.primaryFor
	});

	return { categories: categories.map(project), styles: styles.map(project) };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const d = await request.formData();
		const axis = axisOf(d);
		const name = text(d, 'name');
		if (!name) return fail(400, { message: `A ${label(axis).toLowerCase()} needs a name.` });
		try {
			const slug = await resolveSlug(axis, name, text(d, 'slug'), null);
			await db()
				.insert(table(axis))
				.values({
					name,
					slug,
					shortDescription: text(d, 'shortDescription'),
					description: text(d, 'description'),
					icon: text(d, 'icon'),
					isFeatured: flag(d, 'isFeatured'),
					sortOrder: whole(d, 'sortOrder')
				});
			return { success: true, notice: `${name} added.` };
		} catch (err) {
			return failure(err);
		}
	},

	update: async ({ request }) => {
		const d = await request.formData();
		const axis = axisOf(d);
		const name = text(d, 'name');
		if (!name) return fail(400, { message: `A ${label(axis).toLowerCase()} needs a name.` });
		try {
			const id = parseUuid(String(d.get('id') ?? ''), axis);
			// Renaming may move the public URL, so the slug is re-resolved every save.
			const slug = await resolveSlug(axis, name, text(d, 'slug'), id);
			const t = table(axis);
			const [row] = await db()
				.update(t)
				.set({
					name,
					slug,
					shortDescription: text(d, 'shortDescription'),
					description: text(d, 'description'),
					icon: text(d, 'icon'),
					isFeatured: flag(d, 'isFeatured'),
					sortOrder: whole(d, 'sortOrder'),
					updatedAt: new Date()
				})
				.where(eq(t.id, id))
				.returning({ name: t.name });
			if (!row) return fail(404, { message: 'That entry no longer exists.' });
			return { success: true, notice: `${row.name} saved.` };
		} catch (err) {
			return failure(err);
		}
	},

	/**
	 * Retire or restore.
	 *
	 * The tours already filed under a retired entry keep their link — the row still
	 * exists and RESTRICT would refuse a delete anyway. What changes is that the
	 * composer stops offering it and the marketplace stops listing it as a filter.
	 */
	setActive: async ({ request }) => {
		const d = await request.formData();
		const axis = axisOf(d);
		try {
			const id = parseUuid(String(d.get('id') ?? ''), axis);
			const active = String(d.get('isActive') ?? '') === 'true';
			const t = table(axis);
			const [row] = await db()
				.update(t)
				.set({ isActive: active, updatedAt: new Date() })
				.where(eq(t.id, id))
				.returning({ name: t.name });
			if (!row) return fail(404, { message: 'That entry no longer exists.' });
			return { success: true, notice: `${row.name} ${active ? 'is active again' : 'retired'}.` };
		} catch (err) {
			return failure(err);
		}
	}
};
