// Import an accommodation export into the directory.
//
//   node --experimental-strip-types scripts/import-accommodations.ts <file.json>
//
// Idempotent: matched on slug, so re-running updates rather than duplicating.
//
// IMAGES ARE FILTERED. The export marks each image `onR2` — true where the file
// sits in the exporting system's own bucket, false where it is hotlinked from a
// lodge's own website. The export's own note says the hotlinked ones "are not
// ours to reuse", so this script skips them and says how many it skipped. That
// is a licensing decision, not a technical one; do not relax it to make the
// numbers look better.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import * as schema from '../src/lib/server/db/schema.ts';
import { normaliseBestFor } from '../src/lib/tour-options.ts';

type SourceImage = {
	url: string;
	role?: string | null;
	host?: string;
	onR2?: boolean;
	alt?: string | null;
	caption?: string | null;
	category?: string | null;
};
type SourceProperty = {
	name: string;
	slug: string;
	status?: string;
	shortDescription?: string | null;
	description?: string | null;
	whyWeRecommend?: string | null;
	websiteUrl?: string | null;
	currency?: string | null;
	accommodationLevel?: string | null;
	lodgeType?: string | null;
	bestFor?: string[] | null;
	isFeatured?: boolean;
	flyInAvailable?: boolean;
	transferAvailable?: boolean;
	destination?: { name?: string; slug?: string } | null;
	images?: SourceImage[];
};

const file = process.argv[2];
if (!file) {
	console.error('Usage: import-accommodations.ts <file.json>');
	process.exit(1);
}

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL / SUPABASE_DB_URL.');
	process.exit(1);
}

/** Lower-case, hyphenated, and stable — the export's slug is trusted where it has one. */
const slugify = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFD')
		// Combining marks, written as escapes so the source stays legible.
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/**
 * Title-case a name that was typed in caps, and leave anything else alone.
 *
 * "ARUSHA FARM HOUSE" is a shouting data-entry artefact, not a brand; "The
 * Retreat at Ngorongoro" is how its owner writes it. Only all-caps names are
 * touched, so nothing with deliberate casing is mangled.
 */
const properName = (raw: string) => {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name !== name.toUpperCase()) return name;
	return name
		.toLowerCase()
		.split(' ')
		.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
		.join(' ');
};

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const raw = JSON.parse(readFileSync(file, 'utf8')) as {
	source?: string;
	accommodation?: SourceProperty[];
};
const properties = raw.accommodation ?? [];
const source = raw.source ?? file;

/*
 * Destinations are matched by SLUG against the platform directory, and a slug
 * that does not resolve is left null rather than created. The destination
 * directory is curated — "central-serengeti" is a real entry, and letting an
 * import mint new ones would fragment exactly the list it is meant to join.
 */
const destinationSlugs = [
	...new Set(
		properties.map((p) => p.destination?.slug?.trim()).filter((slug): slug is string => Boolean(slug))
	)
];
const destinationRows = destinationSlugs.length
	? await db
			.select({ id: schema.destinations.id, slug: schema.destinations.slug, countryId: schema.destinations.countryId })
			.from(schema.destinations)
			.where(inArray(schema.destinations.slug, destinationSlugs))
	: [];
const destinationBySlug = new Map(destinationRows.map((d) => [d.slug, d]));
const unmatchedDestinations = destinationSlugs.filter((slug) => !destinationBySlug.has(slug));

const LEVELS = ['LUXURY', 'MID_RANGE', 'BUDGET'];
const LODGE_TYPES = ['SAFARI_LODGE', 'HOTEL', 'TENTED_CAMP', 'BEACH_RESORT', 'ECO_LODGE', 'BOUTIQUE_HOTEL'];
/** Anything outside the vocabulary is dropped, never stored — the CHECK agrees. */
const oneOf = (value: unknown, allowed: string[]) => {
	const text = String(value ?? '').trim().toUpperCase();
	return allowed.includes(text) ? text : null;
};
const text = (value: unknown) => {
	const out = String(value ?? '').trim();
	return out ? out : null;
};

let created = 0;
let updated = 0;
let imagesWritten = 0;
let imagesSkipped = 0;

for (const property of properties) {
	const name = properName(property.name ?? '');
	if (!name) continue;
	const slug = slugify(property.slug || name);

	const [existing] = await db
		.select({ id: schema.accommodations.id })
		.from(schema.accommodations)
		.where(eq(schema.accommodations.slug, slug))
		.limit(1);

	const destination = property.destination?.slug ? destinationBySlug.get(property.destination.slug) : undefined;
	const fields = {
		name,
		source,
		externalRef: property.slug ?? null,
		shortDescription: text(property.shortDescription),
		description: text(property.description),
		whyWeRecommend: text(property.whyWeRecommend),
		websiteUrl: text(property.websiteUrl),
		currency: text(property.currency),
		accommodationLevel: oneOf(property.accommodationLevel, LEVELS),
		lodgeType: oneOf(property.lodgeType, LODGE_TYPES),
		bestFor: normaliseBestFor(property.bestFor),
		isFeatured: property.isFeatured === true,
		flyInAvailable: property.flyInAvailable === true,
		transferAvailable: property.transferAvailable === true,
		destinationId: destination?.id ?? null,
		// The country follows the destination rather than being stated twice; a
		// lodge in Karatu is in whatever country Karatu is in.
		countryId: destination?.countryId ?? null
	};

	let id: string;
	if (existing) {
		await db
			.update(schema.accommodations)
			.set({ ...fields, updatedAt: new Date() })
			.where(eq(schema.accommodations.id, existing.id));
		id = existing.id;
		updated += 1;
	} else {
		const [row] = await db
			.insert(schema.accommodations)
			.values({ ...fields, slug })
			.returning({ id: schema.accommodations.id });
		id = row.id;
		created += 1;
	}

	// Only what the export says is ours.
	const usable = (property.images ?? []).filter((image) => {
		if (image.onR2 === true) return true;
		imagesSkipped += 1;
		return false;
	});

	// Replace rather than append: an image removed at source should disappear
	// here too, and the unique index would reject the duplicates anyway.
	await db.delete(schema.accommodationImages).where(eq(schema.accommodationImages.accommodationId, id));
	if (usable.length) {
		const seen = new Set<string>();
		const rows = usable
			.filter((image) => image.url && !seen.has(image.url) && seen.add(image.url))
			.map((image, index) => ({
				accommodationId: id,
				url: image.url,
				role: image.role ?? null,
				altText: image.alt ?? null,
				caption: image.caption ?? null,
				category: image.category ?? null,
				sortOrder: index
			}));
		if (rows.length) {
			await db.insert(schema.accommodationImages).values(rows);
			imagesWritten += rows.length;
		}
	}
}

console.log(
	`Accommodations: ${created} created, ${updated} updated. ` +
		`Images: ${imagesWritten} written, ${imagesSkipped} skipped as not ours to reuse.`
);
if (unmatchedDestinations.length) {
	// Said out loud rather than swallowed: these lodges now have no place on the
	// map, and the fix is a destination entry, not a change to this script.
	console.warn(`No destination matched: ${unmatchedDestinations.join(', ')}`);
}
await sql.end();
