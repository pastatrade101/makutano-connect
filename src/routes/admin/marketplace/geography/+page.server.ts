// Platform geography — the canonical countries and destinations every listing points at.
//
// The reason these tables are platform-owned is duplication: a vendor who could type a
// destination would give the marketplace "Serengeti", "Serengeti NP" and "Serengeti
// National Park" as three rival entities chasing one search result. So the composer only
// ever SELECTS from here, and here is the single place these rows are written.
//
// No guard is repeated in this file: src/routes/admin/+layout.server.ts already requires
// locals.user.isSuperAdmin for everything below /admin, and a second check that could
// drift from the first is worse than none.
//
// There is no service module behind this because there is no business rule to hold —
// marketplace.ts reads these tables and tours.ts joins them; neither writes them. What
// this file does own is the slug (unique globally, because the public URLs carry no
// country segment) and the delete guard.
import { fail } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { AppError, toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { deleteMedia, MAX_BYTES, mediaEnabled, publicMedia, uploadMedia } from '$lib/server/media';
import type { Actions, PageServerLoad } from './$types';

/** The two tables this screen edits. Both carry a globally unique slug and a hero. */
type Scope = 'country' | 'destination';

/* ------------------------------------------------------------ form input ---- */

/** Empty means CLEARED — a blank field must become NULL, not an empty string sitting
 *  in a <meta> tag or under a heading on the public page. */
const text = (data: FormData, key: string): string | null => String(data.get(key) ?? '').trim() || null;

/** Highlights and travel tips are typed one per line. That is the entire editor, and
 *  it is enough: these render as a bulleted list and nothing else. */
const lines = (data: FormData, key: string): string[] =>
	String(data.get(key) ?? '')
		.split('\n')
		.map((v) => v.trim())
		.filter(Boolean);

const wholeNumber = (data: FormData, key: string): number | null => {
	const raw = String(data.get(key) ?? '').trim();
	if (!raw) return null;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : null;
};

/** An enum value out of a browser is a claim. Postgres would reject an unknown one with
 *  a cast error, which reads to an operator like a bug rather than a bad form. */
function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T, label: string): T {
	if (!raw) return fallback;
	if (!(values as readonly string[]).includes(raw)) throw new AppError('VALIDATION_ERROR', `Unknown ${label}.`);
	return raw as T;
}

const scopeOf = (data: FormData): Scope => {
	const raw = String(data.get('scope') ?? '');
	if (raw !== 'country' && raw !== 'destination') throw new AppError('VALIDATION_ERROR', 'Unknown record.');
	return raw;
};

/** ISO 3166-1 alpha-2. The column is uniquely indexed WHERE NOT NULL, so a blank one has
 *  to be NULL — two empty strings would collide and the second country would be refused. */
function isoCode(data: FormData): string | null {
	const raw = String(data.get('isoCode') ?? '')
		.trim()
		.toUpperCase();
	if (!raw) return null;
	if (!/^[A-Z]{2}$/.test(raw)) throw new AppError('VALIDATION_ERROR', 'An ISO code is two letters, like TZ or KE.');
	return raw;
}

/** "5 to 2 nights" is a typo, and the destination page would render it as one. */
function stay(data: FormData): { min: number | null; max: number | null } {
	const min = wholeNumber(data, 'recommendedStayMin');
	const max = wholeNumber(data, 'recommendedStayMax');
	if (min !== null && max !== null && max < min) {
		throw new AppError('VALIDATION_ERROR', 'The longest recommended stay cannot be shorter than the shortest.');
	}
	return { min, max };
}

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ slugs ---- */

const SLUG_MAX = 80;

/**
 * Deliberately NOT tours.tourSlug.
 *
 * That one walks to `-2` on a collision, which is right for two operators selling
 * similarly-named trips and exactly wrong here: `serengeti-2` sitting beside `serengeti`
 * IS the duplicate entity this table exists to prevent. A taken slug is reported to the
 * person typing it instead of quietly worked around.
 */
function geoSlug(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX)
		.replace(/-+$/, '');
}

/** Who already holds a slug, so the message can name them instead of quoting a constraint. */
async function slugHolder(scope: Scope, slug: string, exceptId: string | null): Promise<string | null> {
	const rows =
		scope === 'country'
			? await db()
					.select({ id: schema.countries.id, name: schema.countries.name })
					.from(schema.countries)
					.where(eq(schema.countries.slug, slug))
					.limit(1)
			: await db()
					.select({ id: schema.destinations.id, name: schema.destinations.name })
					.from(schema.destinations)
					.where(eq(schema.destinations.slug, slug))
					.limit(1);
	const row = rows[0];
	return row && row.id !== exceptId ? row.name : null;
}

/** The slug a write will use, or the sentence the operator should read instead. */
async function resolveSlug(
	scope: Scope,
	name: string,
	desired: string | null,
	exceptId: string | null
): Promise<string> {
	const slug = geoSlug(desired ?? name);
	if (!slug) throw new AppError('VALIDATION_ERROR', 'That name has no letters or numbers to build a web address from.');
	const holder = await slugHolder(scope, slug, exceptId);
	if (holder) {
		const segment = scope === 'country' ? 'countries' : 'destinations';
		throw new AppError(
			'CONFLICT',
			`“${holder}” already uses /${segment}/${slug}. If that is the same place, edit it — otherwise give this one a different web address.`
		);
	}
	return slug;
}

/**
 * The pre-check above is a courtesy; the unique index is the guarantee, and two admins
 * can pass the courtesy in the same millisecond. postgres.js names the constraint that
 * failed, which is the whole difference between a taken web address and a taken ISO
 * code — either way the operator reads a sentence rather than `23505`.
 */
function conflictMessage(err: unknown): string | null {
	if (!err || typeof err !== 'object' || (err as { code?: string }).code !== '23505') return null;
	const constraint = String((err as { constraint_name?: string }).constraint_name ?? '');
	if (constraint.includes('iso_code')) return 'Another country already uses that ISO code.';
	if (constraint.includes('slug')) return 'That web address was taken a moment ago. Choose a different one.';
	return 'A record with those details already exists.';
}

const failure = (err: unknown) => fail(400, { message: conflictMessage(err) ?? toAppError(err).message });

/* ------------------------------------------------------------------- hero ---- */

/**
 * The media id the ROW holds — never one the browser sent.
 *
 * A hero id read out of a form would let one country's panel delete another country's
 * photograph, since deleteMedia's platform scope reaches every platform-owned asset.
 */
async function currentHero(scope: Scope, id: string): Promise<string | null> {
	const rows =
		scope === 'country'
			? await db()
					.select({ heroMediaId: schema.countries.heroMediaId })
					.from(schema.countries)
					.where(eq(schema.countries.id, id))
					.limit(1)
			: await db()
					.select({ heroMediaId: schema.destinations.heroMediaId })
					.from(schema.destinations)
					.where(eq(schema.destinations.id, id))
					.limit(1);
	return rows[0]?.heroMediaId ?? null;
}

/* ------------------------------------------------------------------- load ---- */

export const load: PageServerLoad = async () => {
	const [countryRows, destinationRows] = await Promise.all([
		db()
			.select({
				country: schema.countries,
				hero: schema.media,
				// What is holding this row down. Written as literal SQL rather than an
				// interpolated drizzle column: an interpolated outer column renders
				// unqualified in a correlated subquery and resolves to the wrong table.
				//
				// Soft-deleted tours are COUNTED. The foreign key does not care that a
				// tour is soft-deleted — the row still points here — so filtering them
				// out would offer a delete that Postgres then refuses.
				destinations: sql<number>`(select count(*) from destinations d where d.country_id = countries.id)::int`,
				tours: sql<number>`(select count(*) from tours t where t.primary_country_id = countries.id)::int`
			})
			.from(schema.countries)
			.leftJoin(schema.media, eq(schema.media.id, schema.countries.heroMediaId))
			.orderBy(asc(schema.countries.name)),
		db()
			.select({
				destination: schema.destinations,
				hero: schema.media,
				tours: sql<number>`(select count(*) from tour_destinations td where td.destination_id = destinations.id)::int`,
				// An itinerary day's link is SET NULL, not RESTRICT, so a delete would
				// succeed here and quietly erase the route drawn on published itineraries.
				// Counted so the screen refuses that too.
				itineraryDays: sql<number>`(select count(*) from tour_itinerary_days i where i.destination_id = destinations.id)::int`
			})
			.from(schema.destinations)
			.leftJoin(schema.media, eq(schema.media.id, schema.destinations.heroMediaId))
			.orderBy(asc(schema.destinations.name))
	]);

	return {
		mediaEnabled: mediaEnabled(),
		maxImageMb: Math.round(MAX_BYTES / 1024 / 1024),
		destinationTypes: schema.DESTINATION_TYPES,
		statuses: schema.contentStatusEnum.enumValues,
		countries: countryRows.map((r) => ({
			...r.country,
			// publicMedia, never the row: objectKey is the handle that can destroy the
			// object in R2 and has no business reaching a page.
			hero: publicMedia(r.hero),
			destinationCount: r.destinations,
			tourCount: r.tours
		})),
		destinations: destinationRows.map((r) => ({
			...r.destination,
			hero: publicMedia(r.hero),
			tourCount: r.tours,
			itineraryCount: r.itineraryDays
		}))
	};
};

/* ---------------------------------------------------------------- actions ---- */

export const actions: Actions = {
	createCountry: async ({ request }) => {
		const data = await request.formData();
		const name = text(data, 'name');
		if (!name) return fail(400, { message: 'A country needs a name.' });
		try {
			const slug = await resolveSlug('country', name, text(data, 'slug'), null);
			await db()
				.insert(schema.countries)
				.values({
					name,
					slug,
					isoCode: isoCode(data),
					shortDescription: text(data, 'shortDescription'),
					description: text(data, 'description'),
					seoTitle: text(data, 'seoTitle'),
					seoDescription: text(data, 'seoDescription')
				});
			return { success: true, notice: `${name} added.` };
		} catch (err) {
			return failure(err);
		}
	},

	updateCountry: async ({ request }) => {
		const data = await request.formData();
		const name = text(data, 'name');
		if (!name) return fail(400, { message: 'A country needs a name.' });
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'country');
			// Renaming may change the public URL, so the slug is re-resolved on every
			// save — with this row excused from its own collision check.
			const slug = await resolveSlug('country', name, text(data, 'slug'), id);
			const [row] = await db()
				.update(schema.countries)
				.set({
					name,
					slug,
					isoCode: isoCode(data),
					shortDescription: text(data, 'shortDescription'),
					description: text(data, 'description'),
					seoTitle: text(data, 'seoTitle'),
					seoDescription: text(data, 'seoDescription'),
					updatedAt: new Date()
				})
				.where(eq(schema.countries.id, id))
				.returning({ name: schema.countries.name });
			if (!row) return fail(404, { message: 'That country no longer exists.' });
			return { success: true, notice: `${row.name} saved.` };
		} catch (err) {
			return failure(err);
		}
	},

	/** Deactivating is the answer to almost every "remove this" — the row keeps its id,
	 *  every listing that points at it keeps working, and the marketplace stops offering it. */
	setCountryActive: async ({ request }) => {
		const data = await request.formData();
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'country');
			// The TARGET state is sent, never toggled from whatever the page last saw:
			// two clicks on a slow connection must not land back where they started.
			const isActive = String(data.get('isActive') ?? '') === 'true';
			const [row] = await db()
				.update(schema.countries)
				.set({ isActive, updatedAt: new Date() })
				.where(eq(schema.countries.id, id))
				.returning({ name: schema.countries.name });
			if (!row) return fail(404, { message: 'That country no longer exists.' });
			return {
				success: true,
				notice: `${row.name} is ${isActive ? 'live on the marketplace' : 'hidden from the marketplace'}.`
			};
		} catch (err) {
			return failure(err);
		}
	},

	/**
	 * Only a country nothing points at.
	 *
	 * Both foreign keys are ON DELETE RESTRICT, so Postgres would refuse anyway — this
	 * check exists so the answer is "3 destinations and 2 tours still use it" instead of
	 * a constraint name, and so the page can offer deactivation in its place.
	 */
	deleteCountry: async ({ request }) => {
		const data = await request.formData();
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'country');
			const [row] = await db()
				.select({
					name: schema.countries.name,
					heroMediaId: schema.countries.heroMediaId,
					destinations: sql<number>`(select count(*) from destinations d where d.country_id = countries.id)::int`,
					tours: sql<number>`(select count(*) from tours t where t.primary_country_id = countries.id)::int`
				})
				.from(schema.countries)
				.where(eq(schema.countries.id, id))
				.limit(1);
			if (!row) return fail(404, { message: 'That country no longer exists.' });
			if (row.destinations || row.tours) {
				return fail(400, {
					message: `${row.name} is still used by ${counted(row.destinations, 'destination')} and ${counted(row.tours, 'tour')}. Deactivate it instead — it disappears from the marketplace and every existing link keeps working.`
				});
			}

			await db().delete(schema.countries).where(eq(schema.countries.id, id));
			// Nothing cleans up the photograph on its own: media points at no country, the
			// country pointed at the media. Left alone it is paid-for storage no page can
			// ever reach again.
			if (row.heroMediaId) await deleteMedia(row.heroMediaId, { kind: 'platform' });
			return { success: true, notice: `${row.name} removed.` };
		} catch (err) {
			return failure(err);
		}
	},

	/** A new destination starts as a DRAFT. Putting a place in front of the public is a
	 *  separate, deliberate click — the same shape as a listing's lifecycle. */
	createDestination: async ({ request }) => {
		const data = await request.formData();
		const name = text(data, 'name');
		if (!name) return fail(400, { message: 'A destination needs a name.' });
		try {
			const countryId = parseUuid(String(data.get('countryId') ?? ''), 'country');
			const slug = await resolveSlug('destination', name, text(data, 'slug'), null);
			const { min, max } = stay(data);
			await db()
				.insert(schema.destinations)
				.values({
					countryId,
					name,
					slug,
					destinationType: oneOf(
						schema.DESTINATION_TYPES,
						String(data.get('destinationType') ?? ''),
						'OTHER',
						'destination type'
					),
					shortDescription: text(data, 'shortDescription'),
					description: text(data, 'description'),
					bestTimeSummary: text(data, 'bestTimeSummary'),
					recommendedStayMin: min,
					recommendedStayMax: max,
					highlights: lines(data, 'highlights'),
					travelTips: lines(data, 'travelTips'),
					seoTitle: text(data, 'seoTitle'),
					seoDescription: text(data, 'seoDescription')
				});
			return { success: true, notice: `${name} added as a draft.` };
		} catch (err) {
			return failure(err);
		}
	},

	updateDestination: async ({ request }) => {
		const data = await request.formData();
		const name = text(data, 'name');
		if (!name) return fail(400, { message: 'A destination needs a name.' });
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'destination');
			const countryId = parseUuid(String(data.get('countryId') ?? ''), 'country');
			const slug = await resolveSlug('destination', name, text(data, 'slug'), id);
			const { min, max } = stay(data);
			const [row] = await db()
				.update(schema.destinations)
				.set({
					countryId,
					name,
					slug,
					destinationType: oneOf(
						schema.DESTINATION_TYPES,
						String(data.get('destinationType') ?? ''),
						'OTHER',
						'destination type'
					),
					shortDescription: text(data, 'shortDescription'),
					description: text(data, 'description'),
					bestTimeSummary: text(data, 'bestTimeSummary'),
					recommendedStayMin: min,
					recommendedStayMax: max,
					highlights: lines(data, 'highlights'),
					travelTips: lines(data, 'travelTips'),
					seoTitle: text(data, 'seoTitle'),
					seoDescription: text(data, 'seoDescription'),
					updatedAt: new Date()
				})
				.where(eq(schema.destinations.id, id))
				.returning({ name: schema.destinations.name });
			if (!row) return fail(404, { message: 'That destination no longer exists.' });
			return { success: true, notice: `${row.name} saved.` };
		} catch (err) {
			return failure(err);
		}
	},

	setDestinationStatus: async ({ request }) => {
		const data = await request.formData();
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'destination');
			const status = oneOf(schema.contentStatusEnum.enumValues, String(data.get('status') ?? ''), 'DRAFT', 'status');
			const [row] = await db()
				.update(schema.destinations)
				.set({ status, updatedAt: new Date() })
				.where(eq(schema.destinations.id, id))
				.returning({ name: schema.destinations.name });
			if (!row) return fail(404, { message: 'That destination no longer exists.' });
			return { success: true, notice: `${row.name} is now ${status.toLowerCase()}.` };
		} catch (err) {
			return failure(err);
		}
	},

	/** Same rule as a country: archive what is in use, delete only what nothing names. */
	deleteDestination: async ({ request }) => {
		const data = await request.formData();
		try {
			const id = parseUuid(String(data.get('id') ?? ''), 'destination');
			const [row] = await db()
				.select({
					name: schema.destinations.name,
					heroMediaId: schema.destinations.heroMediaId,
					tours: sql<number>`(select count(*) from tour_destinations td where td.destination_id = destinations.id)::int`,
					itineraryDays: sql<number>`(select count(*) from tour_itinerary_days i where i.destination_id = destinations.id)::int`
				})
				.from(schema.destinations)
				.where(eq(schema.destinations.id, id))
				.limit(1);
			if (!row) return fail(404, { message: 'That destination no longer exists.' });
			if (row.tours || row.itineraryDays) {
				return fail(400, {
					message: `${row.name} is still used by ${counted(row.tours, 'tour')} and named on ${counted(row.itineraryDays, 'itinerary day')}. Archive it instead — it leaves the marketplace without breaking the itineraries that mention it.`
				});
			}

			await db().delete(schema.destinations).where(eq(schema.destinations.id, id));
			if (row.heroMediaId) await deleteMedia(row.heroMediaId, { kind: 'platform' });
			return { success: true, notice: `${row.name} removed.` };
		} catch (err) {
			return failure(err);
		}
	},

	/**
	 * The hero photograph for a country or a destination.
	 *
	 * Both owner kinds insert with tenantId NULL, and that null IS what platform-owned
	 * means: the picture of the Serengeti belongs to the marketplace, not to whichever
	 * operator happened to upload it. uploadMedia proves the row exists and checks the
	 * type, the size and the file's own signature before a byte reaches R2, so there is
	 * nothing left to pre-validate here beyond having been given a file at all.
	 */
	uploadHero: async ({ locals, request }) => {
		const data = await request.formData();
		const file = data.get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { message: 'Choose an image to upload.' });
		if (file.size > MAX_BYTES) {
			return fail(400, { message: `Images must be under ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` });
		}
		try {
			const scope = scopeOf(data);
			const id = parseUuid(String(data.get('id') ?? ''), scope);
			// Read the outgoing hero BEFORE the swap: RETURNING hands back post-update
			// values, so afterwards there is no way left to learn what was replaced.
			const previous = await currentHero(scope, id);

			const bytes = new Uint8Array(await file.arrayBuffer());
			const media = await uploadMedia(
				scope === 'country'
					? { kind: 'platform-country', countryId: id }
					: { kind: 'platform-destination', destinationId: id },
				bytes,
				file.type,
				{ altText: text(data, 'altText'), createdBy: locals.user!.id }
			);

			if (scope === 'country') {
				await db()
					.update(schema.countries)
					.set({ heroMediaId: media.id, updatedAt: new Date() })
					.where(eq(schema.countries.id, id));
			} else {
				await db()
					.update(schema.destinations)
					.set({ heroMediaId: media.id, updatedAt: new Date() })
					.where(eq(schema.destinations.id, id));
			}

			// Only once the replacement is linked. A failed swap should leave the old
			// photograph on the public page rather than an empty panel.
			if (previous) await deleteMedia(previous, { kind: 'platform' });
			return { success: true, notice: 'Photograph updated.' };
		} catch (err) {
			return failure(err);
		}
	},

	removeHero: async ({ request }) => {
		const data = await request.formData();
		try {
			const scope = scopeOf(data);
			const id = parseUuid(String(data.get('id') ?? ''), scope);
			const current = await currentHero(scope, id);
			if (!current) return fail(404, { message: 'There is no photograph to remove.' });
			// heroMediaId is ON DELETE SET NULL, so removing the media row unlinks it.
			// Writing the column as well would only be a second chance to get it wrong.
			await deleteMedia(current, { kind: 'platform' });
			return { success: true, notice: 'Photograph removed.' };
		} catch (err) {
			return failure(err);
		}
	}
};
