// Import a Goldfinch tour export into an operator's marketplace listings.
//
//   node --experimental-strip-types scripts/import-goldfinch-tours.ts <file.json> \
//        --tenant makutano-digital [--apply] [--submit]
//
// Dry run unless --apply is given: it prints exactly what it would write, which
// is the only way to review a taxonomy mapping before 38 listings carry it.
//
// Idempotent on (tenant, slug). Re-running updates the listing in place — the
// itinerary, gallery and stays are replaced wholesale rather than appended,
// because a half-updated itinerary is worse than either version of it.
//
// IMAGES ARE LINKED, NOT COPIED. Every image stays on Goldfinch's own storage
// and the media row records where it came from. That is a deliberate choice for
// demonstration data: nothing here is Makutano's to hold, and the listings are
// expected to be cleared before real ones are written. Media rows are marked
// storage_provider = 'EXTERNAL' so the delete path never fires at our bucket
// with somebody else's key.
//
// NOTHING IS PUBLISHED. Listings arrive as DRAFT. With --submit, the ones that
// pass the marketplace's own readiness rules are moved to SUBMITTED — the
// platform still reviews and publishes them, which is the product's rule and not
// this script's to bypass.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import * as schema from '../src/lib/server/db/schema.ts';
import { parseMeals } from '../src/lib/tour-options.ts';

/* ------------------------------------------------------------------ input -- */

type SourceImage = { url: string; role?: string | null; onR2?: boolean; day?: number };
type SourceDay = {
	day: number;
	title?: string | null;
	description?: string | null;
	accommodation?: string | null;
	meals?: string | null;
	activities?: string | null;
	image?: SourceImage | null;
};
type SourcePackage = {
	title: string;
	slug: string;
	status?: string;
	category?: { name: string; slug: string } | null;
	destinations?: { name: string; slug: string; country?: string; primary?: boolean }[];
	durationDays?: number;
	durationNights?: number | null;
	priceFrom?: number | null;
	currency?: string | null;
	groupSizeMin?: number | null;
	groupSizeMax?: number | null;
	minimumAge?: number | null;
	experienceType?: string | null;
	budgetTier?: string | null;
	difficultyLevel?: string | null;
	startLocation?: string | null;
	endLocation?: string | null;
	isFeatured?: boolean;
	isPopular?: boolean;
	isAvailable?: boolean;
	specialist?: string | null;
	shortDescription?: string | null;
	fullDescription?: string | null;
	highlights?: string[];
	personaTags?: string[];
	customizationIntro?: string | null;
	customizationOptions?: string[];
	seoTitle?: string | null;
	metaDescription?: string | null;
	inclusions?: string[];
	exclusions?: string[];
	itinerary?: SourceDay[];
	images?: SourceImage[];
};

/**
 * The same slug the composer would have produced.
 *
 * tourSlug caps at 80 characters (tours.ts:125) — three of these titles run past
 * that. A listing whose URL could not have been created through the composer is
 * a listing the composer will quietly rename the first time somebody edits it,
 * so it is cut here instead, while nothing is published and no link exists.
 */
const SLUG_MAX = 80;
const tourSlug = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX)
		.replace(/-+$/, '') || 'tour';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const APPLY = flag('apply');
const SUBMIT = flag('submit');
const TENANT_SLUG = option('tenant') ?? 'makutano-digital';

if (!file) {
	console.error('Usage: import-goldfinch-tours.ts <file.json> --tenant <slug> [--apply] [--submit]');
	process.exit(1);
}

const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL / SUPABASE_DB_URL.');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const raw = JSON.parse(readFileSync(file, 'utf8')) as { packages?: SourcePackage[]; source?: string };
const packages = raw.packages ?? [];

/*
 * Itineraries for the three tours the export has none for.
 *
 * Kept in their own file, and read here rather than written here, because they
 * are not the export's data: they are laid out from each tour's own description,
 * which names its parks in visit order. Every day was checked back against that
 * description by readers whose instruction was to find anything it does not say.
 * A tour that already has days in the export ignores this file entirely.
 */
const fillPath = new URL('./goldfinch-itinerary-fill.json', import.meta.url);
let fill: Record<string, SourceDay[]> = {};
try {
	fill = JSON.parse(readFileSync(fillPath, 'utf8')) as Record<string, SourceDay[]>;
} catch {
	console.warn('WARN  no goldfinch-itinerary-fill.json — three tours will import with no itinerary.');
}

/* ------------------------------------------------------------------- text -- */

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	rsquo: '’',
	lsquo: '‘',
	ldquo: '“',
	rdquo: '”',
	mdash: '—',
	ndash: '–',
	hellip: '…'
};

/**
 * The export's rich text, as the marketplace will actually render it.
 *
 * A tour description is escaped on the way out — an operator's textarea is not a
 * place to accept markup — so HTML arriving here would be READ as "<p><strong>"
 * by a traveller. Block tags become blank lines, because the page splits on
 * those to rebuild paragraphs; everything else is dropped.
 */
function htmlToText(value: string | null | undefined): string | null {
	if (!value) return null;
	const text = String(value)
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n\n')
		.replace(/<\s*li[^>]*>/gi, '• ')
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m)
		.replace(/[ \t ]+/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text || null;
}

/** "Picnic lunch\nGame drive" is two activities; the column is a list. */
const splitLines = (value: string | null | undefined): string[] =>
	(value ?? '')
		.split(/\r?\n|;/)
		.map((line) => line.replace(/^[\s•*-]+/, '').trim())
		.filter(Boolean);

/** List items carry markup too: ten highlights arrive wrapped in <p>. */
const textList = (values: string[] | null | undefined, max: number, cap: number): string[] =>
	(values ?? [])
		.map((v) => clamp(htmlToText(v)?.replace(/\n+/g, ' '), max))
		.filter((v): v is string => Boolean(v))
		.slice(0, cap);

const clamp = (value: string | null | undefined, max: number): string | null => {
	if (!value) return null;
	const text = value.trim();
	if (!text) return null;
	return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

const norm = (value: string | null | undefined) =>
	(value ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/* --------------------------------------------------------------- taxonomy -- */

/*
 * Goldfinch's destination list is finer than the platform directory in one
 * place: it splits the Serengeti into regions and calls the conservation area a
 * crater. The directory is curated, so an import joins it rather than growing
 * it — a listing pointing at a "central-serengeti" nobody else uses is a
 * listing that appears on no destination page.
 */
const DESTINATION_ALIAS: Record<string, string> = {
	'ngorongoro-crater': 'ngorongoro-conservation-area',
	'central-serengeti': 'serengeti-national-park',
	'northern-serengeti': 'serengeti-national-park',
	'western-serengeti': 'serengeti-national-park'
};

/*
 * Extra names for places the directory spells differently, or spells only once.
 *
 * The export writes "Ngorongoro Crater" and "Ngorongoro Highlands" for what the
 * directory calls the Conservation Area, splits the Serengeti into regions, and
 * still uses Selous for Nyerere. Matching on these is reading the operator's own
 * words, not inventing a place.
 */
const PLACE_WORDS: Record<string, string> = {
	'ngorongoro crater': 'ngorongoro-conservation-area',
	'ngorongoro highlands': 'ngorongoro-conservation-area',
	ngorongoro: 'ngorongoro-conservation-area',
	'central serengeti': 'serengeti-national-park',
	'northern serengeti': 'serengeti-national-park',
	'western serengeti': 'serengeti-national-park',
	serengeti: 'serengeti-national-park',
	// The bare park names, as day titles actually write them ("Full Day
	// Tarangire"). Without these a day resolves to nothing and drops off the
	// route the composer draws.
	tarangire: 'tarangire-national-park',
	'lake manyara': 'lake-manyara-national-park',
	manyara: 'lake-manyara-national-park',
	'stone town': 'zanzibar',
	nyerere: 'nyerere-national-park',
	selous: 'nyerere-national-park',
	mikumi: 'mikumi-national-park'
};

/*
 * ONE category per listing, and the service layer enforces it. Goldfinch's four
 * are marketing groupings — "Safari from Zanzibar (Fly In)" is a route, not a
 * kind of trip — and every one of the 38 is a safari. The original name is kept
 * in metadata so nothing is lost.
 */
const CATEGORY_SLUG = 'safari';

/**
 * How a trip is experienced, read from the words the operator already wrote.
 *
 * Only styles that are genuinely claimed: "solo" describes who may come, which
 * is the soloFriendly flag, not a style; "group" is the group type. Neither is
 * turned into a badge on the listing.
 */
function travelStylesFor(pkg: SourcePackage): string[] {
	const text = norm([pkg.experienceType, ...(pkg.personaTags ?? []), pkg.category?.name, pkg.title].join(' '));
	const styles = new Set<string>();
	if (/wildlife|safari|migration|game drive/.test(text)) styles.add('wildlife');
	if (/couple|honeymoon|romance/.test(text)) styles.add('honeymoon-romance');
	if (/famil/.test(text)) styles.add('family');
	if (/photograph/.test(text)) styles.add('photography');
	if (/culture|cultural/.test(text)) styles.add('cultural-immersion');
	if (/bird/.test(text)) styles.add('birding');
	if (/dive|diving|snorkel|marine|reef/.test(text)) styles.add('marine-diving');
	// A tour the operator named "Luxury" or tagged luxury is one, whatever the
	// budget tier happens to be called — several exports use 'prestige' for it.
	if (/luxur/.test(text)) styles.add('luxury');
	if (/fly-?in/.test(text)) styles.add('fly-in-safari');
	if (norm(pkg.budgetTier) === 'luxury') styles.add('luxury');
	if (norm(pkg.budgetTier) === 'budget') styles.add('budget');
	// The composer caps a listing at five, and so does the service.
	return [...styles].slice(0, 5);
}

/** Whose trip it is. Everything Goldfinch sells here is a private departure. */
function groupTypeFor(pkg: SourcePackage): string {
	const text = norm([pkg.category?.name, pkg.customizationIntro, ...(pkg.personaTags ?? [])].join(' '));
	if (/small group/.test(text)) return 'SMALL_GROUP';
	if (/private/.test(text)) return 'PRIVATE';
	return 'PRIVATE';
}

/**
 * Where a day happens, read off the title the operator wrote.
 *
 * The composer draws a route from each day's place, and an itinerary with none
 * shows the reader nothing but a list. The export has no per-day destination,
 * but every one of these titles names one — and they are written to a pattern:
 * the subject first, an em-dash, then the flavour. "From Zanzibar to Arusha
 * National Park — Active Start" is a day in Arusha, so the LAST place named
 * before the dash is the one taken. Falls back to the whole title, then to the
 * opening of the description.
 */
function placeFor(day: SourceDay, phrases: [string, string][]): string | null {
	const heads = [
		norm(String(day.title ?? '').split(/[—–|:]/)[0]),
		norm(day.title),
		norm(String(day.description ?? '').slice(0, 300))
	];
	for (const hay of heads) {
		if (!hay) continue;
		let best: { at: number; len: number; slug: string } | null = null;
		for (const [phrase, slug] of phrases) {
			const at = hay.lastIndexOf(phrase);
			if (at < 0) continue;
			// Latest mention wins; the longer name wins a tie, so "Serengeti
			// National Park" is never beaten by the bare "Serengeti".
			if (!best || at > best.at || (at === best.at && phrase.length > best.len)) {
				best = { at, len: phrase.length, slug };
			}
		}
		if (best) return best.slug;
	}
	return null;
}

/**
 * What this operator charges for a tour of this length.
 *
 * Goldfinch stores "ask us" as a price of zero, and Connect will not publish a
 * listing with no starting price — so fourteen of these would sit as drafts
 * forever. Rather than invent a number, each takes the MEDIAN of the operator's
 * own priced tours of the same duration: twenty-four of the thirty-eight carry a
 * real price, and every unpriced duration has at least one real comparable.
 *
 * It is still an estimate and it is recorded as one — `metadata.priceDerived`
 * carries the basis, so every derived price can be found and corrected. The four
 * tours the operator calls luxury will read LOW: there is no priced luxury tour
 * in the catalogue to compare them with, so they take the mid-range figure.
 */
const pricedByDuration = new Map<number, number[]>();
for (const pkg of packages) {
	if (!pkg.priceFrom || pkg.priceFrom <= 0) continue;
	const days = pkg.durationDays && pkg.durationDays > 0 ? pkg.durationDays : 1;
	pricedByDuration.set(days, [...(pricedByDuration.get(days) ?? []), pkg.priceFrom]);
}

function derivePrice(days: number): { amount: number; basis: string } | null {
	const median = (xs: number[]) => {
		const v = [...xs].sort((a, b) => a - b);
		const mid = Math.floor(v.length / 2);
		return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
	};
	const exact = pricedByDuration.get(days);
	if (exact?.length) {
		return {
			amount: median(exact),
			basis: `median of ${exact.length} of this operator's own ${days}-day tours`
		};
	}
	// No same-length comparable: sit between the nearest real ones either side.
	const known = [...pricedByDuration.keys()].sort((a, b) => a - b);
	const below = known.filter((d) => d < days).pop();
	const above = known.find((d) => d > days);
	if (below !== undefined && above !== undefined) {
		const lo = median(pricedByDuration.get(below)!);
		const hi = median(pricedByDuration.get(above)!);
		return {
			amount: Math.round(lo + ((hi - lo) * (days - below)) / (above - below)),
			basis: `between this operator's ${below}-day and ${above}-day tours`
		};
	}
	return null;
}

/**
 * How a day's stop is reached, where the operator says so.
 *
 * The route map draws the leg into a stop by this — solid for a drive, dashed
 * for a flight — and sends the matching vehicle along it, so a wrong value is a
 * claim about the trip, not a decoration. Only movement wording counts: "game
 * drive" is what you do once you are there, not how you got there.
 *
 * BOAT is deliberately NOT derived. Every candidate in this export turned out to
 * be a dhow cruise or a snorkelling trip listed as an activity on a beach day,
 * never a transfer between two stops. A dotted water leg drawn from that would
 * say the traveller crossed the sea when they did not.
 */
const FLY = /\bfly\b|\bflight\b|\bfly ?in\b|\bairstrip\b|\bby air\b/i;
const DRIVE =
	/\btransfer\b|\bdrive to\b|\bby road\b|\bdriving\b|\bcontinue (?:to|on)\b|\bhead (?:to|for)\b|\bjourney to\b/i;

function travelModeFor(day: SourceDay): 'FLY' | 'DRIVE' | null {
	const text = `${day.title ?? ''}. ${(htmlToText(day.description) ?? '').slice(0, 200)}`;
	if (FLY.test(text)) return 'FLY';
	if (DRIVE.test(text)) return 'DRIVE';
	return null;
}

/** Everything across the water from the mainland. */
const ISLAND = /^(zanzibar|stone-town-zanzibar|nungwi|kendwa|paje|jambiani|matemwe|michamvi|mnemba|pemba)/;

/**
 * The mode two places imply, where the operator's words did not say.
 *
 * Geography, not guesswork, for the first case: there is no road between the
 * mainland and Zanzibar, so a leg with one end on each is flown — and every tour
 * in this catalogue is sold as a fly-in safari. An operator who runs the ferry
 * instead can say so in the composer and that wins.
 *
 * The second is a convention rather than a fact: two mainland stops on a safari
 * are driven. A bush flight between airstrips happens, but an operator doing
 * that says so, and the words are read first.
 *
 * Both are recorded as inferred in metadata rather than passed off as stated.
 */
function modeFromGeography(fromSlug: string | null, toSlug: string | null): 'FLY' | 'DRIVE' | null {
	if (!fromSlug || !toSlug || fromSlug === toSlug) return null;
	const a = ISLAND.test(fromSlug);
	const b = ISLAND.test(toSlug);
	if (a !== b) return 'FLY';
	return a ? null : 'DRIVE';
}

/* ------------------------------------------------------------------- main -- */

const [tenant] = await db
	.select({ id: schema.tenants.id, name: schema.tenants.name, country: schema.tenants.country })
	.from(schema.tenants)
	.where(eq(schema.tenants.slug, TENANT_SLUG))
	.limit(1);
if (!tenant) {
	console.error(`No tenant with slug "${TENANT_SLUG}".`);
	process.exit(1);
}

const [country] = await db
	.select({ id: schema.countries.id })
	.from(schema.countries)
	.where(eq(schema.countries.slug, 'tanzania'))
	.limit(1);

const [category] = await db
	.select({ id: schema.tourCategories.id })
	.from(schema.tourCategories)
	.where(eq(schema.tourCategories.slug, CATEGORY_SLUG))
	.limit(1);

const destinationRows = await db
	.select({ id: schema.destinations.id, slug: schema.destinations.slug, name: schema.destinations.name })
	.from(schema.destinations);
const destinationBySlug = new Map(destinationRows.map((d) => [d.slug, d.id]));

/** Every name the directory knows, plus the operator's own words for them. */
const PLACE_PHRASES: [string, string][] = [
	...destinationRows.map((d) => [norm(d.name), d.slug] as [string, string]),
	...Object.entries(PLACE_WORDS)
].filter(([phrase, slug]) => phrase.length > 4 && destinationBySlug.has(slug));

const styleRows = await db
	.select({ id: schema.travelStyles.id, slug: schema.travelStyles.slug })
	.from(schema.travelStyles);
const styleBySlug = new Map(styleRows.map((s) => [s.slug, s.id]));

const accommodationRows = await db
	.select({ id: schema.accommodations.id, name: schema.accommodations.name })
	.from(schema.accommodations);
const accommodationByName = new Map(accommodationRows.map((a) => [norm(a.name), a.id]));

if (!country) console.warn('WARN  no country row for "tanzania" — listings will have no country.');
if (!category) console.warn(`WARN  no tour category "${CATEGORY_SLUG}" — listings will have no category.`);

/*
 * The public operator behind these listings.
 *
 * createTour() calls ensureOperatorProfile() as its very first step (see
 * src/lib/server/tours.ts) precisely because "run by the operator who listed it"
 * is the marketplace's promise, and a listing with no operator renders as an
 * empty card. This script writes tour rows DIRECTLY and so skips that call —
 * which is how a published listing ended up on the public site with no operator
 * name on it. Mirrored here rather than imported because the service reads its
 * connection through the $lib alias, which this standalone script cannot resolve.
 *
 * Idempotent: an operator who already has a profile keeps it untouched, and
 * `is_verified` is never set — verification is the platform's call, made on the
 * operator's own admin page, and a badge handed out by an import is not a signal.
 */
async function ensureOperatorProfile() {
	const [existing] = await db
		.select({ id: schema.operatorProfiles.id, slug: schema.operatorProfiles.slug })
		.from(schema.operatorProfiles)
		.where(eq(schema.operatorProfiles.tenantId, tenant.id))
		.limit(1);
	if (existing) {
		console.log(`operator profile  ${existing.slug} (already present)`);
		return;
	}
	if (!APPLY) {
		console.log(`operator profile  WOULD CREATE for ${tenant.name} — none exists`);
		return;
	}
	const base = tourSlug(TENANT_SLUG || tenant.name) || 'operator';
	for (let attempt = 0; attempt < 25; attempt++) {
		const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
		try {
			await db
				.insert(schema.operatorProfiles)
				.values({ tenantId: tenant.id, slug, displayName: tenant.name, location: tenant.country, isActive: true });
			console.log(`operator profile  created: ${slug}`);
			return;
		} catch {
			const [raced] = await db
				.select({ id: schema.operatorProfiles.id })
				.from(schema.operatorProfiles)
				.where(eq(schema.operatorProfiles.tenantId, tenant.id))
				.limit(1);
			if (raced) return;
			if (attempt === 24) throw new Error('Could not create an operator profile.');
		}
	}
}
await ensureOperatorProfile();

console.log(`${APPLY ? 'IMPORT' : 'DRY RUN'}  ${packages.length} packages -> ${tenant.name} (${TENANT_SLUG})`);
console.log('');

/** A stay that is not a lodge. These are itinerary prose, not accommodation. */
const NOT_A_STAY = /^(none|non|n\/a|not applicable|nil)\b|end of tour|departure day/i;

const report = {
	created: 0,
	updated: 0,
	days: 0,
	images: 0,
	stays: 0,
	dayPlaces: 0,
	travelModes: { FLY: 0, DRIVE: 0 } as Record<string, number>,
	inferredModes: { FLY: 0, DRIVE: 0 } as Record<string, number>,
	customStays: 0,
	submitted: 0,
	notSubmittable: [] as { slug: string; missing: string[] }[],
	nightsCorrected: [] as { slug: string; was: number; now: number }[],
	groupSizeDropped: 0,
	pricesDerived: [] as { slug: string; amount: number; basis: string }[],
	destinationsRead: [] as { slug: string; count: number }[],
	itineraryFilled: [] as string[],
	unmatchedDestinations: new Set<string>(),
	unmatchedStays: new Set<string>()
};

/**
 * A media row for an image that lives on somebody else's storage.
 *
 * Matched on url within the tenant so a re-run relinks rather than duplicating —
 * there is no unique index to lean on, and 218 images would otherwise multiply
 * on every run.
 */
async function mediaFor(url: string, altText: string | null): Promise<string | null> {
	const clean = url?.trim();
	if (!clean || !/^https:\/\//i.test(clean)) return null;

	const [existing] = await db
		.select({ id: schema.media.id })
		.from(schema.media)
		.where(and(eq(schema.media.tenantId, tenant.id), eq(schema.media.url, clean)))
		.limit(1);
	if (existing) return existing.id;
	if (!APPLY) return '00000000-0000-0000-0000-000000000000';

	const ext = clean.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
	const mime =
		ext === 'avif' ? 'image/avif' : ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';

	const [row] = await db
		.insert(schema.media)
		.values({
			tenantId: tenant.id,
			// Never under `marketplace/`, which is where our own keys live: this
			// key names a file in another system and must not be mistakable for
			// one of ours.
			storageProvider: 'EXTERNAL',
			objectKey: `external/${new URL(clean).host}${new URL(clean).pathname}`,
			url: clean,
			mimeType: mime,
			altText: clamp(altText, 300),
			sourceUrl: clean
		})
		.returning({ id: schema.media.id });
	report.images++;
	return row.id;
}

for (const pkg of packages) {
	const slug = pkg.slug ? tourSlug(pkg.slug) : '';
	if (!slug || !pkg.title?.trim()) {
		console.log(`SKIP  ${pkg.title ?? '(untitled)'} — no title or slug`);
		continue;
	}

	const description = htmlToText(pkg.fullDescription);
	const shortDescription = clamp(pkg.shortDescription ?? description, 600);

	// A price of zero is not a price. Goldfinch stores it for "ask us"; here it
	// is null, which is what the marketplace already renders as a quote request
	// and what the publish check reads as missing.
	const stated = pkg.priceFrom && pkg.priceFrom > 0 ? pkg.priceFrom : null;
	const derived = stated ? null : derivePrice(pkg.durationDays && pkg.durationDays > 0 ? pkg.durationDays : 1);
	const priceFrom = (stated ?? derived?.amount)?.toFixed(2) ?? null;
	if (derived) report.pricesDerived.push({ slug: pkg.slug, amount: derived.amount, basis: derived.basis });

	/*
	 * A trip cannot have more nights than days. One export row says 6 days and 8
	 * nights, which would print as "6 days / 8 nights" on a listing — visibly
	 * wrong, and wrong in a way that makes a reader distrust the rest of it. The
	 * days are trusted, the nights are brought back in line, and the correction
	 * is reported rather than made quietly.
	 */
	let durationNights = pkg.durationNights ?? null;
	const durationDays = pkg.durationDays && pkg.durationDays > 0 ? pkg.durationDays : 1;
	if (durationNights !== null && durationNights >= durationDays) {
		report.nightsCorrected.push({ slug, was: durationNights, now: durationDays - 1 });
		durationNights = durationDays - 1;
	}

	const destinationSlugs = (pkg.destinations ?? []).map((d) => DESTINATION_ALIAS[d.slug] ?? d.slug).filter(Boolean);
	const destinationIds: string[] = [];
	for (const s of [...new Set(destinationSlugs)]) {
		const id = destinationBySlug.get(s);
		if (id && !destinationIds.includes(id)) destinationIds.push(id);
		else if (!id) report.unmatchedDestinations.add(s);
	}

	/*
	 * One tour lists no destinations at all, which is a listing that appears on no
	 * destination page. Its own description names four parks in order — reading
	 * them from there is using the operator's words, not choosing for them.
	 */
	if (!destinationIds.length) {
		const prose = norm(`${pkg.title} ${htmlToText(pkg.fullDescription) ?? ''}`);
		const seen: { at: number; slug: string }[] = [];
		for (const [phrase, slug] of PLACE_PHRASES) {
			const at = prose.indexOf(phrase);
			if (at >= 0 && !seen.some((x) => x.slug === slug)) seen.push({ at, slug });
		}
		seen.sort((a, b) => a.at - b.at);
		for (const { slug: s } of seen) {
			const id = destinationBySlug.get(s);
			if (id && !destinationIds.includes(id)) destinationIds.push(id);
		}
		if (destinationIds.length) report.destinationsRead.push({ slug, count: destinationIds.length });
	}

	const styleIds = travelStylesFor(pkg)
		.map((s) => styleBySlug.get(s))
		.filter((id): id is string => Boolean(id));

	/*
	 * Everything Goldfinch tracks that this schema has no column for is kept
	 * rather than dropped. It is not rendered anywhere — it is here so that the
	 * import is reversible and so nobody has to go back to the export to answer
	 * "what did the original say".
	 */
	const metadata = {
		importedFrom: 'goldfinch',
		sourceSlug: slug,
		sourceStatus: pkg.status ?? null,
		// The operator stated no price; this one is an estimate from their own
		// catalogue and is here so it can be found and corrected.
		priceDerived: derived ? { amount: derived.amount, basis: derived.basis } : null,
		sourceCategory: pkg.category?.name ?? null,
		experienceType: pkg.experienceType ?? null,
		budgetTier: pkg.budgetTier ?? null,
		difficultyLevel: pkg.difficultyLevel ?? null,
		startLocation: pkg.startLocation ?? null,
		endLocation: pkg.endLocation ?? null,
		specialist: pkg.specialist ?? null,
		isPopular: pkg.isPopular ?? false,
		personaTags: pkg.personaTags ?? [],
		customizationIntro: pkg.customizationIntro ?? null,
		customizationOptions: pkg.customizationOptions ?? []
	};

	/*
	 * "1 to 100 travellers" is a form default, not a group size.
	 *
	 * Thirty-six of the thirty-eight carry it, all of them private departures —
	 * a private safari that seats a hundred people is not a claim anybody made,
	 * and the composer is explicit that every field on a listing reads as a
	 * promise. Left empty, the listing simply does not state a group size, which
	 * is the truth. The two rows with a real range keep it.
	 */
	const isDefaultRange = pkg.groupSizeMin === 1 && pkg.groupSizeMax === 100;
	const groupSize = isDefaultRange
		? { min: null, max: null }
		: {
				min: pkg.groupSizeMin && pkg.groupSizeMin > 0 ? Math.min(pkg.groupSizeMin, 200) : null,
				max: pkg.groupSizeMax && pkg.groupSizeMax > 0 ? Math.min(pkg.groupSizeMax, 200) : null
			};
	if (isDefaultRange) report.groupSizeDropped++;

	const heroUrl = (pkg.images ?? []).find((i) => i.role === 'main')?.url ?? pkg.images?.[0]?.url ?? null;
	const heroMediaId = heroUrl ? await mediaFor(heroUrl, pkg.title) : null;

	const values = {
		tenantId: tenant.id,
		primaryCountryId: country?.id ?? null,
		primaryCategoryId: category?.id ?? null,
		title: pkg.title.trim(),
		slug,
		shortDescription,
		description,
		durationDays,
		durationNights,
		priceFrom,
		currency: (pkg.currency ?? 'USD').toUpperCase(),
		pricingType: 'PER_PERSON',
		groupType: groupTypeFor(pkg),
		groupSizeMin: groupSize.min,
		groupSizeMax: groupSize.max,
		ageRequirement: pkg.minimumAge ? `Minimum age ${pkg.minimumAge}` : null,
		heroMediaId,
		// customizationIntro is the operator's own sentence about tailoring, so
		// the flag it implies is set from it rather than assumed.
		customisable: Boolean(pkg.customizationIntro || (pkg.customizationOptions ?? []).length),
		soloFriendly: (pkg.personaTags ?? []).some((t) => /solo/i.test(t)),
		startsAnyDay: false,
		availabilityType: 'YEAR_ROUND',
		seoTitle: clamp(pkg.seoTitle, 200),
		seoDescription: clamp(pkg.metaDescription, 400),
		highlights: textList(pkg.highlights, 300, 20),
		included: textList(pkg.inclusions, 300, 40),
		excluded: textList(pkg.exclusions, 300, 40),
		metadata,
		updatedAt: new Date()
	};

	const [existing] = await db
		.select({ id: schema.tours.id, status: schema.tours.status })
		.from(schema.tours)
		.where(and(eq(schema.tours.tenantId, tenant.id), eq(schema.tours.slug, slug), isNull(schema.tours.deletedAt)))
		.limit(1);

	let tourId = existing?.id ?? '';

	if (!APPLY) {
		console.log(
			`${existing ? 'UPDATE' : 'CREATE'}  ${slug}\n` +
				`        ${values.durationDays}d/${values.durationNights ?? 0}n  ` +
				`${priceFrom ? `$${priceFrom}` : 'no price'}  ` +
				`dest=${destinationIds.length}/${destinationSlugs.length}  ` +
				`styles=${styleIds.length}  days=${(pkg.itinerary ?? []).length}  ` +
				`images=${(pkg.images ?? []).length}`
		);
		existing ? report.updated++ : report.created++;
		report.days += (pkg.itinerary ?? []).length;
		continue;
	}

	if (existing) {
		await db.update(schema.tours).set(values).where(eq(schema.tours.id, existing.id));
		report.updated++;
	} else {
		const [row] = await db
			.insert(schema.tours)
			.values({ ...values, status: 'DRAFT' })
			.returning({ id: schema.tours.id });
		tourId = row.id;
		report.created++;
	}

	/* ---- destinations, styles, category: replaced whole, order preserved ---- */

	await db.delete(schema.tourDestinations).where(eq(schema.tourDestinations.tourId, tourId));
	if (destinationIds.length) {
		await db
			.insert(schema.tourDestinations)
			.values(destinationIds.map((destinationId, index) => ({ tourId, destinationId, sortOrder: index })));
	}

	await db.delete(schema.tourTravelStyles).where(eq(schema.tourTravelStyles.tourId, tourId));
	if (styleIds.length) {
		await db
			.insert(schema.tourTravelStyles)
			.values(styleIds.map((travelStyleId, index) => ({ tourId, travelStyleId, sortOrder: index })));
	}

	await db.delete(schema.tourCategoryLinks).where(eq(schema.tourCategoryLinks.tourId, tourId));
	if (category) {
		await db.insert(schema.tourCategoryLinks).values({ tourId, categoryId: category.id, sortOrder: 0 });
	}

	/* ------------------------------------------------------------ itinerary -- */

	const supplied = pkg.itinerary?.length ? pkg.itinerary : (fill[pkg.slug] ?? []);
	if (!pkg.itinerary?.length && supplied.length) report.itineraryFilled.push(slug);
	const days = [...supplied].sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
	/** The place the last day ended, so a leg knows where it started. */
	let previousSlug: string | null = null;
	await db.delete(schema.tourItineraryDays).where(eq(schema.tourItineraryDays.tourId, tourId));

	/*
	 * One row per property, nights totalled.
	 *
	 * `tour_accommodations_unique_property` allows a lodge to appear once per
	 * tour, and the service says why: the same lodge twice is not two stays, it
	 * is one stay of two nights. Itineraries here revisit a base camp after an
	 * excursion, so the nights are summed across the whole trip rather than only
	 * where they happen to be consecutive.
	 */
	const stayOrder: { key: string; accommodationId: string | null; customName: string | null; nights: number }[] = [];

	for (const [index, day] of days.entries()) {
		const stayText = day.accommodation?.trim() || null;
		const isStay = Boolean(stayText) && !NOT_A_STAY.test(stayText!);
		const accommodationId = isStay ? (accommodationByName.get(norm(stayText)) ?? null) : null;
		if (isStay && !accommodationId) report.unmatchedStays.add(stayText!);

		if (isStay) {
			const key = accommodationId ?? `custom:${norm(stayText)}`;
			const seen = stayOrder.find((s) => s.key === key);
			if (seen) seen.nights += 1;
			else stayOrder.push({ key, accommodationId, customName: accommodationId ? null : stayText, nights: 1 });
		}

		const dayMediaId = day.image?.url ? await mediaFor(day.image.url, day.title ?? pkg.title) : null;
		const daySlug = placeFor(day, PLACE_PHRASES);
		const dayDestinationId = destinationBySlug.get(daySlug ?? '') ?? null;
		if (dayDestinationId) report.dayPlaces++;
		// Day one is arrived at, not travelled to from anywhere on this itinerary.
		const stated = index === 0 ? null : travelModeFor(day);
		const inferred = stated || index === 0 ? null : modeFromGeography(previousSlug, daySlug);
		const travelMode = stated ?? inferred;
		if (stated) report.travelModes[stated]++;
		if (inferred) report.inferredModes[inferred]++;
		previousSlug = daySlug;

		await db.insert(schema.tourItineraryDays).values({
			tourId,
			dayNumber: index + 1,
			title: clamp(htmlToText(day.title)?.replace(/\n+/g, ' '), 200) ?? `Day ${index + 1}`,
			description: htmlToText(day.description),
			destinationId: dayDestinationId,
			accommodation: stayText,
			accommodationId,
			accommodationImages: [],
			travelMode,
			meals: parseMeals(day.meals),
			mealsNote: clamp(day.meals, 200),
			activities: splitLines(day.activities).slice(0, 20),
			mediaId: dayMediaId
		});
		report.days++;
	}

	/* -------------------------------------------------------------- gallery -- */

	const galleryIds: string[] = [];
	for (const image of pkg.images ?? []) {
		const id = await mediaFor(image.url, image.role === 'main' ? pkg.title : (pkg.title ?? null));
		if (id && !galleryIds.includes(id)) galleryIds.push(id);
	}
	// The main photograph leads, as it does in the composer.
	if (heroMediaId) {
		const at = galleryIds.indexOf(heroMediaId);
		if (at > 0) galleryIds.splice(at, 1);
		if (at !== 0) galleryIds.unshift(heroMediaId);
	}
	await db.delete(schema.tourMedia).where(eq(schema.tourMedia.tourId, tourId));
	if (galleryIds.length) {
		await db
			.insert(schema.tourMedia)
			.values(galleryIds.slice(0, 40).map((mediaId, index) => ({ tourId, mediaId, sortOrder: index })));
	}

	/* ---------------------------------------------------------------- stays -- */

	await db.delete(schema.tourAccommodations).where(eq(schema.tourAccommodations.tourId, tourId));
	const stayRows = stayOrder
		.filter((s) => s.accommodationId || s.customName)
		.slice(0, 20)
		.map((s, index) => ({
			tourId,
			accommodationId: s.accommodationId,
			customName: s.accommodationId ? null : s.customName,
			customImages: [] as string[],
			sortOrder: index,
			nights: s.nights
		}));
	if (stayRows.length) await db.insert(schema.tourAccommodations).values(stayRows);
	report.stays += stayRows.filter((s) => s.accommodationId).length;
	report.customStays += stayRows.filter((s) => !s.accommodationId).length;

	console.log(
		`${existing ? 'UPDATE' : 'CREATE'}  ${slug}  ` +
			`days=${days.length} images=${galleryIds.length} stays=${stayRows.length}`
	);
}

/* ------------------------------------------------------------- submission -- */

/*
 * The same readiness rules the composer shows and the service enforces. Written
 * out here rather than imported because a script cannot load the service module
 * — so it is checked against the database and reported, never assumed.
 */
if (APPLY && SUBMIT) {
	const rows = await db
		.select({
			id: schema.tours.id,
			slug: schema.tours.slug,
			status: schema.tours.status,
			title: schema.tours.title,
			shortDescription: schema.tours.shortDescription,
			primaryCountryId: schema.tours.primaryCountryId,
			primaryCategoryId: schema.tours.primaryCategoryId,
			durationDays: schema.tours.durationDays,
			priceFrom: schema.tours.priceFrom,
			currency: schema.tours.currency,
			heroMediaId: schema.tours.heroMediaId
		})
		.from(schema.tours)
		.where(and(eq(schema.tours.tenantId, tenant.id), eq(schema.tours.status, 'DRAFT'), isNull(schema.tours.deletedAt)));

	const ids = rows.map((r) => r.id);
	const dayRows = ids.length
		? await db
				.select({ tourId: schema.tourItineraryDays.tourId })
				.from(schema.tourItineraryDays)
				.where(inArray(schema.tourItineraryDays.tourId, ids))
		: [];
	const destRows = ids.length
		? await db
				.select({ tourId: schema.tourDestinations.tourId })
				.from(schema.tourDestinations)
				.where(inArray(schema.tourDestinations.tourId, ids))
		: [];
	const hasDay = new Set(dayRows.map((d) => d.tourId));
	const hasDest = new Set(destRows.map((d) => d.tourId));

	for (const t of rows) {
		const missing: string[] = [];
		if (!t.title?.trim()) missing.push('a title');
		if (!t.shortDescription?.trim()) missing.push('a short description');
		if (!t.primaryCountryId) missing.push('a country');
		if (!t.primaryCategoryId) missing.push('a category');
		if (!t.durationDays || t.durationDays < 1) missing.push('a duration of at least one day');
		if (!t.priceFrom || Number(t.priceFrom) <= 0) missing.push('a starting price');
		if (!t.currency) missing.push('a currency');
		if (!t.heroMediaId) missing.push('a main photo');
		if (!hasDay.has(t.id)) missing.push('at least one itinerary day');
		if (!hasDest.has(t.id)) missing.push('at least one destination');

		if (missing.length) {
			report.notSubmittable.push({ slug: t.slug, missing });
			continue;
		}
		await db
			.update(schema.tours)
			.set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.tours.id, t.id));
		report.submitted++;
	}
}

/* ---------------------------------------------------------------- summary -- */

console.log('');
console.log(`created            ${report.created}`);
console.log(`updated            ${report.updated}`);
console.log(`itinerary days     ${report.days}`);
console.log(`  placed on the map ${report.dayPlaces}`);
console.log(`  reached by flight  ${report.travelModes.FLY}`);
console.log(`  reached by road    ${report.travelModes.DRIVE}`);
console.log(`  inferred: flown    ${report.inferredModes.FLY}   (a leg with one end across the water)`);
console.log(`  inferred: driven   ${report.inferredModes.DRIVE}   (two mainland stops)`);
console.log(`media linked       ${report.images}`);
console.log(`stays from list    ${report.stays}`);
console.log(`stays typed in     ${report.customStays}`);
console.log(`default 1-100 group size dropped   ${report.groupSizeDropped}`);
if (APPLY && SUBMIT) {
	console.log(`submitted          ${report.submitted}`);
	console.log(`held as draft      ${report.notSubmittable.length}`);
	for (const t of report.notSubmittable) console.log(`  ${t.slug} — needs ${t.missing.join(', ')}`);
}
if (report.pricesDerived.length) {
	console.log(`\nPrices estimated from this operator's own catalogue (metadata.priceDerived):`);
	for (const t of report.pricesDerived) console.log(`  ${t.slug} — $${t.amount}, ${t.basis}`);
}
if (report.itineraryFilled.length) {
	console.log(`\nItineraries laid out from the tour's own description (the export had none):`);
	for (const t of report.itineraryFilled) console.log(`  ${t}`);
}
if (report.destinationsRead.length) {
	console.log(`\nDestinations read from the tour's own description (it listed none):`);
	for (const t of report.destinationsRead) console.log(`  ${t.slug} — ${t.count} places`);
}
if (report.nightsCorrected.length) {
	console.log(`\nNights brought back in line with days:`);
	for (const t of report.nightsCorrected) console.log(`  ${t.slug} — ${t.was} nights became ${t.now}`);
}
if (report.unmatchedDestinations.size) {
	console.log(`\nDestinations not in the directory (left unlinked):`);
	for (const s of report.unmatchedDestinations) console.log(`  ${s}`);
}
if (report.unmatchedStays.size) {
	console.log(`\nStays not in the accommodation directory (kept as typed-in names):`);
	for (const s of report.unmatchedStays) console.log(`  ${s}`);
}
if (!APPLY) console.log('\nDry run. Nothing was written. Re-run with --apply.');

await sql.end();
