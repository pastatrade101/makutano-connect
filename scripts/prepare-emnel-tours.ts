// Turn the Emnel export into something the importer can honestly consume.
//
//   node --experimental-strip-types scripts/prepare-emnel-tours.ts \
//     ~/Desktop/emnel-tours.json scripts/emnel-tours.prepared.json
//
// WHAT IS WRONG WITH THE EXPORT
//
// It is a marketing site's database, not a marketplace's. Four things in it
// cannot be imported as they stand:
//
// 1. DESTINATIONS ARE COMPOSITES. Half the tours name one "destination" called
//    "Lake Manyara, Tarangire, Ngorongoro & Serengeti", slug and all. That is
//    four national parks wearing one label — a place that does not exist, and
//    that nobody filtering by Serengeti would ever match. Two more say "Tanzania
//    Safari", which is not a place at all. Meanwhile the ones that ARE single
//    places are incomplete: "2-Day Safari from Zanzibar" is filed under
//    Tarangire alone, and never mentions Zanzibar.
//
// 2. CATEGORIES ARE CAMPAIGN NAMES. "Classic Northern Circuit", "Big Five
//    Safaris", "Fly-In Safaris" — useful headings on their own site, but this
//    marketplace has five categories and a tour has to sit in one of them.
//
// 3. PERSONA TAGS ARE BLANKET. 'couple' is on 13 of 16 tours, 'family' on 12 —
//    including a prestige honeymoon fly-in. Carried across as travel styles they
//    would produce a "Family" filter matching almost the whole catalogue, which
//    is not a filter. They are dropped in favour of what the product structurally
//    IS: see stylesFor().
//
// 4. TWO TOURS PUT EVERY HIGHLIGHT IN ONE PIPE-DELIMITED STRING, so they would
//    have imported as a single 200-character bullet.
//
// WHAT THIS SCRIPT WILL NOT DO
//
// It does not invent content. Where the export is simply missing something — the
// tour with an empty itinerary — it is reported and left empty, because writing
// seven days of somebody else's safari would be fabricating a product. Prices,
// descriptions and itinerary text are copied verbatim, never generated.
//
// Every mapping below was checked against the live taxonomy before it was
// written: five categories, twelve travel styles, and the destination slugs the
// directory actually publishes.
import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
	console.error('usage: prepare-emnel-tours.ts <source.json> <out.json>');
	process.exit(1);
}

type Src = Record<string, any>;
const source = JSON.parse(readFileSync(inPath, 'utf8')) as Src[];

/* ----------------------------------------------------- destinations ----- */

const NAME: Record<string, string> = {
	'serengeti-national-park': 'Serengeti National Park',
	'tarangire-national-park': 'Tarangire National Park',
	'ngorongoro-conservation-area': 'Ngorongoro Conservation Area',
	'lake-manyara-national-park': 'Lake Manyara National Park',
	'nyerere-national-park': 'Nyerere National Park',
	'mikumi-national-park': 'Mikumi National Park',
	'stone-town-zanzibar': 'Stone Town',
	zanzibar: 'Zanzibar',
	arusha: 'Arusha',
	'mount-kilimanjaro': 'Mount Kilimanjaro'
};

/** Longest phrase first, so "lake manyara" is read before "manyara". */
const PHRASES: [RegExp, string][] = [
	[/lake\s*manyara|\bmanyara\b/i, 'lake-manyara-national-park'],
	[/stone\s*town/i, 'stone-town-zanzibar'],
	[/ngorongoro/i, 'ngorongoro-conservation-area'],
	[/serengeti/i, 'serengeti-national-park'],
	[/tarangire/i, 'tarangire-national-park'],
	[/zanzibar/i, 'zanzibar'],
	[/nyerere|selous/i, 'nyerere-national-park'],
	[/mikumi/i, 'mikumi-national-park'],
	// Gateways — see GATEWAY below. Matched so the operator can still declare
	// them explicitly, never inferred from itinerary prose.
	[/kilimanjaro/i, 'mount-kilimanjaro'],
	[/\barusha\b/i, 'arusha']
];

/**
 * Places that are transit, not product.
 *
 * Every single Kilimanjaro mention in this export is an AIRPORT ("arrival at
 * Kilimanjaro International Airport") or a VIEW FROM SOMEWHERE ELSE ("views of
 * Mount Meru and Mount Kilimanjaro"). Not one tour sets foot on the mountain.
 * Arusha is the same story: the town you drive out of on day one.
 *
 * Tagging either as a destination would put these safaris in front of someone
 * shopping for a Kilimanjaro climb. They are therefore accepted ONLY when the
 * operator names them in the destination field itself — a deliberate claim —
 * and never when merely inferred from itinerary prose.
 */
const GATEWAY = new Set(['mount-kilimanjaro', 'arusha']);

/** Real days spent in places this marketplace has no country for. */
const FOREIGN: [RegExp, string][] = [
	[/nairobi/i, 'Nairobi (Kenya)'],
	[/amboseli/i, 'Amboseli National Park (Kenya)'],
	[/mas+ai\s*mara/i, 'Maasai Mara (Kenya)']
];

/**
 * Order used to choose the headline destination when the operator's own
 * destination field is unusable ("Tanzania Safari"). Parks before beaches:
 * every one of these is sold as a safari, and the beach is the end of it.
 */
const PROMINENCE = [
	'serengeti-national-park',
	'ngorongoro-conservation-area',
	'tarangire-national-park',
	'lake-manyara-national-park',
	'nyerere-national-park',
	'mikumi-national-park',
	'zanzibar',
	'stone-town-zanzibar',
	'arusha',
	'mount-kilimanjaro'
];

type Dest = { name: string; slug: string; country: string; primary?: boolean };

/**
 * Read the places a tour actually visits.
 *
 * Both the declared field and the itinerary are read, always — the declared
 * field is incomplete rather than authoritative, so treating it as the whole
 * answer is what loses Zanzibar on the Zanzibar tours. Prose only ever ADDS
 * non-gateway places; it can never introduce a gateway.
 */
function destinationsFor(t: Src): { destinations: Dest[]; declaredWasUsable: boolean } {
	const declared: string[] = [];
	const inferred: string[] = [];
	const add = (list: string[], slug: string) => {
		if (slug && !declared.includes(slug) && !inferred.includes(slug)) list.push(slug);
	};

	const declaredText = `${t.destination?.name ?? ''} ${t.destination?.slug ?? ''}`;
	for (const [re, slug] of PHRASES) if (re.test(declaredText)) add(declared, slug);

	const prose = [
		t.title ?? '',
		t.short_description ?? '',
		...(t.itinerary ?? []).map((d: Src) => `${d.title ?? ''} ${d.description ?? ''}`)
	].join(' ');
	for (const [re, slug] of PHRASES) {
		if (GATEWAY.has(slug)) continue;
		if (re.test(prose)) add(inferred, slug);
	}

	const all = [...declared, ...inferred];
	// Stone Town is in Zanzibar; a tour in one is in the other.
	if (all.includes('stone-town-zanzibar') && !all.includes('zanzibar')) all.push('zanzibar');

	// Headline: the operator's own first choice, or the most prominent park.
	const head = declared.length
		? declared[0]
		: [...all].sort((a, b) => PROMINENCE.indexOf(a) - PROMINENCE.indexOf(b))[0];
	const ordered = [head, ...all.filter((s) => s !== head)].filter(Boolean);

	return {
		destinations: ordered.map((slug, i) => ({
			name: NAME[slug] ?? slug,
			slug,
			country: 'Tanzania',
			...(i === 0 ? { primary: true } : {})
		})),
		declaredWasUsable: declared.length > 0
	};
}

/* -------------------------------------------------------- categories ----- */

/**
 * Campaign names onto the five categories this marketplace has.
 *
 * Order matters: a "Safari & Zanzibar" trip is both, and it is filed as a safari
 * because that is what the itinerary spends its days doing — the beach is the
 * end of it, not the product.
 */
function categorySlugFor(t: Src): string {
	const c = String(t.category ?? '').toLowerCase();
	if (/safari|big five|circuit/.test(c)) return 'safari';
	if (/beach|zanzibar|island/.test(c)) return 'beach-island';
	if (/trek|kilimanjaro|climb|mountain/.test(c)) return 'mountain-trekking';
	if (/culture|heritage|stone town/.test(c)) return 'culture-heritage';
	return 'nature-adventure';
}

/**
 * The operator's own category name is kept as `name`, because the importer
 * records it as `sourceCategory` and losing it would erase the only trace of
 * what this tour was called before we filed it.
 */
const categoryFor = (t: Src) => ({
	name: String(t.category ?? '').trim() || 'Safari',
	slug: categorySlugFor(t)
});

/* ------------------------------------------------------ travel styles ----- */

/**
 * Travel styles from what the product IS, not who it was marketed to.
 *
 * The persona_tags are deliberately ignored — see note 3 at the top. What is
 * read instead is the operator's own product naming: a tour they called a
 * "Family Safari" is a family safari, a "prestige" tier is luxury, and
 * "fly-in-safari" is a way of travelling. Those discriminate; 'couple' on
 * thirteen of sixteen tours does not.
 */
const STYLE: [RegExp, string][] = [
	[/luxur|prestige/i, 'luxury'],
	[/honeymoon|romance/i, 'honeymoon-romance'],
	[/family|multi-generational/i, 'family'],
	[/budget/i, 'budget'],
	[/fly-?in/i, 'fly-in-safari'],
	[/photograph/i, 'photography'],
	[/bird/i, 'birding'],
	[/cultur/i, 'cultural-immersion'],
	[/walk|hike|trek/i, 'walking-active'],
	[/diving|snorkel|marine/i, 'marine-diving'],
	[/adventure/i, 'adventure']
];

function stylesFor(t: Src): string[] {
	const evidence = [t.category ?? '', t.experience_type ?? '', t.budget_tier ?? ''].join(' ');
	const out: string[] = [];
	for (const [re, slug] of STYLE) if (re.test(evidence) && !out.includes(slug)) out.push(slug);
	// Every one of these is a game-viewing safari; that much is not a guess.
	out.push('wildlife');
	return out.slice(0, 5);
}

/* ------------------------------------------------------------ fields ----- */

/** Two tours write every highlight into a single pipe-delimited string. */
const highlightsFor = (t: Src): string[] =>
	(t.highlights ?? [])
		.flatMap((h: string) => String(h).split('|'))
		.map((h: string) => h.trim())
		.filter(Boolean);

const imagesFor = (t: Src) => {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const u of [t.main_image, t.banner_image, ...(t.images ?? [])]) {
		const url = String(u ?? '').trim();
		if (url && !seen.has(url)) {
			seen.add(url);
			urls.push(url);
		}
	}
	return urls.map((url, i) => ({ url, position: i, isPrimary: i === 0 }));
};

/* -------------------------------------------------------------- run ----- */

const blocking: string[] = [];
const notes: string[] = [];

const packages = source.map((t) => {
	const { destinations, declaredWasUsable } = destinationsFor(t);
	const itinerary = (t.itinerary ?? []).map((d: Src) => ({
		day: d.day,
		title: d.title ?? null,
		description: d.description ?? null
	}));

	const prose = itinerary.map((d) => `${d.title ?? ''} ${d.description ?? ''}`).join(' ');
	const foreign = FOREIGN.filter(([re]) => re.test(prose)).map(([, label]) => label);

	if (!destinations.length) blocking.push(`${t.slug}: no destination could be resolved`);
	if (!itinerary.length) blocking.push(`${t.slug}: itinerary is EMPTY in the export — left empty, not invented`);
	if (foreign.length)
		blocking.push(
			`${t.slug}: spends days in ${foreign.join(', ')} — the marketplace publishes Tanzania only, ` +
				`so those legs cannot be tagged and the tour will read as Tanzania-only`
		);
	if (!declaredWasUsable)
		notes.push(`${t.slug}: destination field was unusable ("${t.destination?.name}") — read from the itinerary`);
	if (!t.price_from) blocking.push(`${t.slug}: no price`);

	return {
		title: t.title,
		slug: t.slug,
		// The export's own status, recorded as provenance. What the tour becomes on
		// the marketplace is the importer's decision (DRAFT, then SUBMITTED only if
		// it passes the readiness rules) — never ours to assert here.
		status: t.status ?? null,
		category: categoryFor(t),
		destinations,
		durationDays: t.duration_days ?? null,
		durationNights: t.duration_nights ?? null,
		priceFrom: t.price_from ?? null,
		currency: t.currency ?? 'USD',
		minimumAge: t.minimum_age ?? null,
		experienceType: t.experience_type ?? null,
		budgetTier: t.budget_tier ?? null,
		difficultyLevel: t.difficulty_level ?? null,
		startLocation: t.start_location ?? null,
		endLocation: t.end_location ?? null,
		shortDescription: t.short_description ?? null,
		fullDescription: t.full_description ?? null,
		highlights: highlightsFor(t),
		personaTags: stylesFor(t),
		itinerary,
		images: imagesFor(t),
		...(foreign.length ? { reviewFlag: `Cross-border: ${foreign.join(', ')}` } : {})
	};
});

writeFileSync(outPath, JSON.stringify({ source: 'emnel', packages }, null, 2));

console.log(`prepared ${packages.length} tours -> ${outPath}\n`);
console.log('destinations resolved:');
for (const p of packages) {
	console.log(
		`  ${p.slug.slice(0, 42).padEnd(44)} ${p.destinations.map((d) => d.slug.replace('-national-park', '').replace('-conservation-area', '')).join(', ')}`
	);
}
const tally = (get: (p: any) => string[]) => {
	const m = new Map<string, number>();
	for (const p of packages) for (const v of get(p)) m.set(v, (m.get(v) ?? 0) + 1);
	return [...m].sort((a, b) => b[1] - a[1]);
};
console.log('\ncategories:');
for (const [k, v] of tally((p) => [p.category.slug])) console.log(`  ${String(v).padStart(2)}x  ${k}`);
console.log('\ntravel styles:');
for (const [k, v] of tally((p) => p.personaTags)) console.log(`  ${String(v).padStart(2)}x  ${k}`);
console.log('\nhighlights per tour:', packages.map((p) => p.highlights.length).join(' '));

if (notes.length) {
	console.log('\nrepaired:');
	for (const n of notes) console.log(`  . ${n}`);
}
if (blocking.length) {
	console.log('\nNOT FIXED — needs a human, or the operator:');
	for (const w of blocking) console.log(`  ! ${w}`);
}
