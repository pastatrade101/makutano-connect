/**
 * Bring one operator's catalogue up to the standard the marketplace now supports.
 *
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     --env-file-if-exists=.env scripts/makutano-digital-listings.ts [--apply]
 *
 * Dry run by default; --apply writes.
 *
 * TWO THINGS, for every published tour on the tenant:
 *
 *   PRICING — group-size rates and a child rate, saved through saveTourPricing so
 *   the same validation, the same derivation and the same single transaction run
 *   as when an operator presses Save in the composer. Nothing here reimplements
 *   the pricing rules; if this script and the composer ever disagreed, the
 *   catalogue would be priced by whichever one ran last.
 *
 *   COPY — the description turned from a wall of plain text into the rich text
 *   the composer and the public page have supported since the editor shipped
 *   (headings, lists, internal links), plus the four practical summaries, which
 *   were empty on 38 of 39 listings.
 *
 * WHY THE ADVERTISED PRICE DOES NOT MOVE
 *
 * price_from is derived now — the lowest adult rate a real party could reach. So
 * the existing hand-typed price is anchored as the LARGEST-party rate and every
 * smaller party scales up from it. That is both how a safari is actually costed
 * (one vehicle, one guide, one set of park fees, divided by however many seats
 * are filled) and the only arrangement in which adding a price book leaves 39
 * live listings advertising exactly what they advertised this morning.
 *
 * WHY THERE ARE NO SEASONS HERE
 *
 * The engine gives a season outright precedence over a group tier — deliberately,
 * and documented in pricing.ts. That is coherent for a flat per-person tour and
 * incoherent for one whose rate already varies with party size: a peak-season
 * rate set for a typical couple would quote a party of eight 56% MORE than the
 * same trip in June, while quoting a solo traveller 8% LESS. Tanzania's seasons
 * are real and they belong on these listings, so they are written into "Best time
 * to travel", where a traveller reads them, rather than into a price book that
 * would invert. See the note at the end of the run.
 */
import postgres from 'postgres';
import { saveTourPricing } from '../src/lib/server/tour-pricing';
import { sanitizeRichText } from '../src/lib/server/richtext';
import type { GroupTier } from '../src/lib/pricing';

const TENANT = '5ef9549a-091d-4422-847e-cd9d7488d131';
const APPLY = process.argv.includes('--apply');

/* ------------------------------------------------------------- pricing ---- */

/**
 * What each party size pays, as a multiple of the largest-party rate.
 *
 * A private safari is one vehicle and one guide whatever the party, so the cost
 * per seat falls steeply as seats fill and a single traveller carries the whole
 * vehicle plus a single room. A seat-on-a-shared-vehicle departure has almost
 * none of that: the vehicle runs regardless, and the only real difference for a
 * solo traveller is the room they do not share.
 */
const CURVES = {
	PRIVATE: [
		{ min: 1, max: 1, mult: 1.7 },
		{ min: 2, max: 2, mult: 1.32 },
		{ min: 3, max: 4, mult: 1.16 },
		{ min: 5, max: 6, mult: 1.06 },
		{ min: 7, max: null, mult: 1.0 }
	],
	SMALL_GROUP: [
		{ min: 1, max: 1, mult: 1.15 },
		{ min: 2, max: 2, mult: 1.06 },
		{ min: 3, max: 4, mult: 1.02 },
		{ min: 5, max: null, mult: 1.0 }
	]
} as const;

/** The band a party of three or four falls in — the commonest booking, so the standard. */
const STANDARD_MULT = { PRIVATE: 1.16, SMALL_GROUP: 1.02 } as const;

/**
 * A child's share of the adult rate.
 *
 * Park fees are the reason this is not a round half: a non-resident adult pays
 * about $70-80 a day for the northern parks and a child of five to fifteen pays
 * roughly a third of that, while the vehicle, the guide and the room are shared
 * and save nothing. On a fly-in itinerary the child's air ticket is nearly the
 * adult fare, which lifts the share again — so a flying trip discounts a child
 * less than a driving one, which is exactly what the numbers do here.
 */
const childShare = (flyIn: boolean) => (flyIn ? 0.75 : 0.7);

/** Tidy money. The floor is exempt: it has to stay EXACTLY the advertised price. */
const round5 = (n: number) => String(Math.round(n / 5) * 5) + '.00';

function priceBook(base: number, groupType: string, flyIn: boolean) {
	const kind = groupType === 'SMALL_GROUP' ? 'SMALL_GROUP' : 'PRIVATE';
	const share = childShare(flyIn);
	const tiers: GroupTier[] = CURVES[kind].map((band) => {
		// The largest-party rate IS the advertised price, to the cent. Rounding it
		// would move the number on ten public surfaces to buy nothing.
		const adult = band.mult === 1 ? base.toFixed(2) : round5(base * band.mult);
		return {
			minTravellers: band.min,
			maxTravellers: band.max,
			adult,
			child: round5(Number(adult) * share)
		};
	});
	const standardAdult = round5(base * STANDARD_MULT[kind]);
	return { tiers, adultPrice: standardAdult, childPrice: round5(Number(standardAdult) * share) };
}

/* ---------------------------------------------------------------- copy ---- */

type Dest = { name: string; slug: string };

/**
 * The names people actually write, mapped to the pages that hold them.
 *
 * A directory entry is called "Ngorongoro Conservation Area" and every listing in
 * this catalogue calls it "the Ngorongoro Crater" — which is not the same place,
 * strictly, but is what a traveller searches for and is what the page is about.
 * Matched only AFTER the official names, so a description that does use the full
 * name still links on that.
 *
 * The Kilimanjaro guard is load-bearing: half these itineraries start at
 * Kilimanjaro International Airport, and linking an airport to a mountain is the
 * kind of internal link that teaches a crawler the page is about the wrong thing.
 */
const ALIASES: { slug: string; body: string }[] = [
	{ slug: 'ngorongoro-conservation-area', body: 'Ngorongoro Crater' },
	{ slug: 'ngorongoro-conservation-area', body: 'Ngorongoro' },
	{ slug: 'serengeti-national-park', body: 'Serengeti' },
	{ slug: 'tarangire-national-park', body: 'Tarangire' },
	{ slug: 'lake-manyara-national-park', body: 'Lake Manyara' },
	{ slug: 'selous-game-reserve', body: 'Selous' },
	{ slug: 'nyerere-national-park', body: 'Nyerere' },
	{ slug: 'mikumi-national-park', body: 'Mikumi' },
	{ slug: 'stone-town-zanzibar', body: 'Stone Town' },
	{ slug: 'mount-kilimanjaro', body: 'Mount Kilimanjaro' },
	{ slug: 'mount-kilimanjaro', body: 'Kilimanjaro(?!\\s+(?:International|Airport|Region))' },
	{ slug: 'mount-meru', body: 'Mount Meru' },
	{ slug: 'lake-natron', body: 'Lake Natron' },
	{ slug: 'lake-eyasi', body: 'Lake Eyasi' },
	{ slug: 'materuni', body: 'Materuni' },
	{ slug: 'mto-wa-mbu', body: 'Mto wa Mbu' },
	{ slug: 'karatu', body: 'Karatu' }
];

/**
 * Plain text as the operator typed it, turned into the markup the page renders.
 *
 * Every one of these listings predates the composer's editor, so all 39 hold
 * newline-separated plain text. The public page upgrades that to paragraphs on
 * the way out — but a heading stays a stray sentence and a bulleted list stays
 * four paragraphs each beginning with a bullet character. This does the reading a
 * person would do: a short line with no closing punctuation is a heading, a line
 * opening with a bullet is a list item, everything else is a paragraph.
 *
 * It ADDS nothing. Not one word of the operator's copy is invented, reordered or
 * rewritten — the only thing that changes is which tag it sits in, plus links to
 * places this marketplace has a page for.
 */
function toRichText(plain: string, dests: Dest[]): string {
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const blocks = plain
		.split(/\n{2,}/)
		.map((b) => b.trim())
		.filter(Boolean);

	/** Links added so far, so a description does not link the Serengeti six times. */
	const used = new Set<string>();
	const LINK_BUDGET = 5;
	// Longest first: "Arusha National Park" must win over "Arusha", or the longer
	// name is left half-linked with a stray " National Park" outside the anchor.
	const ordered = [...dests]
		.sort((a, b) => b.name.length - a.name.length)
		.map((d) => ({ slug: d.slug, body: esc(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }))
		.concat(ALIASES);

	const linkify = (html: string): string => {
		for (const d of ordered) {
			if (used.size >= LINK_BUDGET) break;
			if (used.has(d.slug)) continue;
			// Word boundaries, and never inside an anchor already placed in this
			// block — the negative lookahead walks forward to the next tag and
			// refuses if it is a closing </a>.
			const re = new RegExp(`\\b(${d.body})\\b(?![^<]*</a>)`);
			if (!re.test(html)) continue;
			html = html.replace(re, `<a href="/destinations/${d.slug}">$1</a>`);
			used.add(d.slug);
		}
		return html;
	};

	const out: string[] = [];
	for (const block of blocks) {
		const lines = block
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		const bullets = lines.filter((l) => /^[-•*✔✓]/.test(l));

		if (bullets.length && bullets.length === lines.length) {
			const items = lines.map((l) => `<li>${linkify(esc(l.replace(/^[-•*✔✓]\s*/, '')))}</li>`);
			out.push(`<ul>${items.join('')}</ul>`);
			continue;
		}

		for (const line of lines) {
			if (/^[-•*✔✓]/.test(line)) {
				out.push(`<ul><li>${linkify(esc(line.replace(/^[-•*✔✓]\s*/, '')))}</li></ul>`);
				continue;
			}
			// A heading is short, and stops without a full stop. Headings are NOT
			// linked: an anchor wrapping half a heading reads as a mistake, and a
			// crawler weighs a link in body copy more than one in a title anyway.
			const isHeading = line.length <= 72 && !/[.!?,;]$/.test(line);
			if (isHeading) out.push(`<h3>${esc(line.replace(/:$/, ''))}</h3>`);
			else out.push(`<p>${linkify(esc(line))}</p>`);
		}
	}
	// Consecutive single-item lists are one list. The loop above cannot know that
	// a bullet is the first of four when the block mixes prose and bullets.
	return out.join('').replace(/<\/ul><ul>/g, '');
}

export { toRichText, priceBook };

/* ----------------------------------------------------- the four summaries -- */

type Facts = {
	title: string;
	duration: number;
	groupType: string;
	flyIn: boolean;
	/** The safari BEGINS on the island — the flight runs island → mainland → island. */
	startsZanzibar: boolean;
	/** The island is on the itinerary somewhere, which is not the same thing. */
	visitsZanzibar: boolean;
	beach: boolean;
	level: 'luxury' | 'midrange' | 'classic' | 'standard';
	parks: Set<string>;
	migrationNorth: boolean;
	/** Which of Tanzania's two circuits this itinerary is actually on. */
	circuit: 'north' | 'south' | 'both';
};

const A = (slug: string, label: string) => `<a href="/destinations/${slug}">${label}</a>`;

/** The park on this itinerary furthest from a road, kitchen or shop. */
function deepestPark(f: Facts): { slug: string; label: string } | null {
	const order: [string, string, string][] = [
		['serengeti', 'serengeti-national-park', 'the Serengeti'],
		['nyerere', 'nyerere-national-park', 'Nyerere'],
		['tarangire', 'tarangire-national-park', 'Tarangire'],
		['ngorongoro', 'ngorongoro-conservation-area', 'the Ngorongoro highlands'],
		['mikumi', 'mikumi-national-park', 'Mikumi'],
		['manyara', 'lake-manyara-national-park', 'Lake Manyara']
	];
	const hit = order.find(([key]) => f.parks.has(key));
	return hit ? { slug: hit[1], label: hit[2] } : null;
}

/**
 * Where the nights are spent.
 *
 * The level comes from the operator's own title — a listing that calls itself
 * Luxury describes luxury, and this must not upgrade or downgrade what they sell.
 */
function accommodation(f: Facts): string {
	const lines: string[] = [];
	if (f.level === 'luxury') {
		lines.push(
			`Luxury lodges and permanent tented camps, chosen for where they stand rather than for a star rating — most sit inside the park boundary or on its rim, so the first game drive of the day starts at the door instead of an hour away at the gate.`
		);
		lines.push(
			`Every room is en-suite with hot water, and the tented camps are permanent structures with proper beds and flushing lavatories, not mobile fly-camps.`
		);
	} else if (f.level === 'midrange') {
		lines.push(
			`Comfortable mid-range lodges and permanent tented camps, all en-suite, all with hot water and reliable power in the evening.`
		);
		lines.push(
			`Camps are chosen for their position on the game-viewing routes rather than for their frontage, which is what buys you the early morning inside the park.`
		);
	} else {
		lines.push(
			`Well-run lodges and permanent tented camps inside the parks or on their immediate boundary, all en-suite and all with hot water.`
		);
		// Karatu and Arusha are northern-circuit towns. Naming them on a Nyerere or
		// Mikumi listing puts the traveller on the wrong side of the country.
		lines.push(
			f.circuit === 'south'
				? `Where a night falls outside a park, it is spent close to the gate rather than at the end of a long transfer.`
				: `Where a night falls outside a park, it is spent in ${A('karatu', 'Karatu')} or ${A('arusha', 'Arusha')} rather than on a long transfer.`
		);
	}
	if (f.beach) {
		lines.push(
			`The Zanzibar nights are spent at a beach hotel on the north or east coast, a short transfer from ${A('stone-town-zanzibar', 'Stone Town')}.`
		);
	}
	lines.push(
		`A traveller on their own is quoted a room of their own — we do not put strangers together. The exact properties are named on your quotation before you pay anything; see <a href="/stays">the places we use</a>.`
	);
	return lines.map((l) => `<p>${l}</p>`).join('');
}

/** How the party actually moves, including the part people are caught out by. */
function transport(f: Facts): string {
	const lines: string[] = [];
	if (f.startsZanzibar) {
		lines.push(
			`A scheduled flight carries you from ${A('zanzibar', 'Zanzibar')} to the mainland and back again — there is no long road day at either end of the safari, which is the whole point of running this trip from the island.`
		);
	} else if (f.visitsZanzibar) {
		lines.push(
			`We collect you from Kilimanjaro International Airport or from your hotel in ${A('arusha', 'Arusha')}. The safari runs by road, and you fly to ${A('zanzibar', 'Zanzibar')} for the coast at the end of it rather than driving back the way you came.`
		);
	} else {
		lines.push(
			`We collect you from Kilimanjaro International Airport or from your hotel in ${A('arusha', 'Arusha')}, and return you there at the end.`
		);
	}
	if (f.flyIn) {
		lines.push(
			`Light aircraft on these routes take <strong>15 kg per person in a soft bag</strong>, hand luggage included. Hard suitcases are refused at the airstrip rather than at check-in, so bring a duffel; anything you are leaving behind can stay at your hotel.`
		);
	}
	lines.push(
		`On safari you travel in a Toyota Land Cruiser with a pop-up roof and a <strong>guaranteed window seat for every traveller</strong>${
			f.groupType === 'SMALL_GROUP' ? ', shared with a small group of other travellers' : ', used by your party alone'
		}. Your driver is your guide — one person, speaking English, who knows the parks rather than only the roads.`
	);
	lines.push(
		`Drinking water, a cool box and charging points are in the vehicle. Roads inside the parks are unsurfaced and corrugated in places; that is the terrain, not a fault of the vehicle.`
	);
	return lines.map((l) => `<p>${l}</p>`).join('');
}

/** What is on the table, and what is not. */
function meals(f: Facts): string {
	const lines: string[] = [];
	lines.push(
		`Full board throughout the safari — breakfast, lunch and dinner, from your first game drive to your last.${
			f.duration >= 3
				? ' Lunch on a long driving day is a packed picnic box eaten in the park, which buys you the middle of the day out there rather than back at the lodge.'
				: ''
		}`
	);
	if (f.beach) {
		lines.push(
			`The Zanzibar beach nights are <strong>bed and breakfast</strong>; lunch and dinner on the island are yours to choose and to pay for, which most people prefer on a beach.`
		);
	}
	lines.push(
		`Bottled drinking water is in the vehicle every day and is included. Alcohol, soft drinks and anything from a lodge minibar are not.`
	);
	// The park named here has to be one this itinerary actually visits. Reaching
	// for the Serengeti on a trip that never goes there is the sort of detail a
	// reader notices and an operator gets asked about.
	const remote = deepestPark(f);
	lines.push(
		remote
			? `Vegetarian, vegan, halal, gluten-free and allergy requirements are all catered for — tell us when you book, not on arrival, because a camp deep inside ${A(remote.slug, remote.label)} cannot send out for anything.`
			: `Vegetarian, vegan, halal, gluten-free and allergy requirements are all catered for. Tell us when you book rather than on arrival: a camp out in the bush cannot send out for anything.`
	);
	return lines.map((l) => `<p>${l}</p>`).join('');
}

/**
 * When to come — the part of a listing a first-time visitor most needs and most
 * often has to leave the page to find.
 *
 * Assembled from the parks this particular itinerary visits, because "the best
 * time for Tanzania" is not one answer: the northern Serengeti and the southern
 * Serengeti are at their best five months apart, and a trip built around one of
 * them is badly served by advice written for the other.
 */
function bestTime(f: Facts): string {
	const p = f.parks;
	const lines: string[] = [];
	const bullets: string[] = [];

	const circuitWords =
		f.circuit === 'south'
			? 'the southern parks are worth visiting in all of them'
			: f.circuit === 'both'
				? 'the parks on this route are worth visiting in all of them'
				: 'the northern parks are worth visiting in all of them';
	lines.push(
		`Tanzania has two dry seasons and two wet ones, and ${circuitWords} — but not for the same reasons, and this itinerary has a season that suits it better than the others.`
	);

	if (p.has('serengeti')) {
		if (f.migrationNorth) {
			bullets.push(
				`<strong>July to early October</strong> — the herds are in the northern ${A('serengeti-national-park', 'Serengeti')} and the Mara River crossings happen in this window. It is the reason this trip runs north, and it is the busiest and most expensive time of year.`
			);
			bullets.push(
				`<strong>Late January to March</strong> — calving on the southern short-grass plains around Ndutu. Half a million wildebeest are born inside about three weeks, and the predator activity that follows is the best of the year.`
			);
		} else {
			bullets.push(
				`<strong>June to October</strong> — the dry season. Grass is short, water is scarce, and animals concentrate where it is not; this is the easiest game viewing of the year in the ${A('serengeti-national-park', 'Serengeti')}.`
			);
			bullets.push(
				`<strong>Late January to March</strong> — calving season on the southern plains, and the strongest predator activity of the year.`
			);
		}
	}
	if (p.has('tarangire')) {
		bullets.push(
			`<strong>July to October</strong> for ${A('tarangire-national-park', 'Tarangire')} — as the bush dries out, the elephant herds fall back on the Tarangire River and gather in numbers you will not see there in April.`
		);
	}
	if (p.has('ngorongoro')) {
		bullets.push(
			`<strong>Any month</strong> for the ${A('ngorongoro-conservation-area', 'Ngorongoro Crater')}. The crater floor holds its wildlife all year because they do not leave it; the only thing the season changes is the mud and the light.`
		);
	}
	if (p.has('manyara')) {
		bullets.push(
			`<strong>November to June</strong> for ${A('lake-manyara-national-park', 'Lake Manyara')} — the lake is full, the flamingos are on it and the birding is at its best.`
		);
	}
	if (p.has('nyerere')) {
		bullets.push(
			`<strong>June to October</strong> for ${A('nyerere-national-park', 'Nyerere')} — the southern circuit dries hard, game concentrates on the Rufiji, and boat safaris run at their best.`
		);
	}
	if (p.has('mikumi')) {
		bullets.push(
			`<strong>June to October</strong> for ${A('mikumi-national-park', 'Mikumi')}, though the Mkata floodplain gives up its wildlife readily enough in any month, which is what makes it work as a short trip.`
		);
	}
	if (p.has('kilimanjaro')) {
		bullets.push(
			`<strong>December to February and June to October</strong> for a clear sight of ${A('mount-kilimanjaro', 'Kilimanjaro')}. The mountain makes its own cloud by late morning in every season — look early.`
		);
	}
	if (f.beach || f.visitsZanzibar) {
		bullets.push(
			`<strong>June to October and December to February</strong> on the coast: the driest and least humid months in ${A('zanzibar', 'Zanzibar')}.`
		);
	}

	lines.push(
		p.has('serengeti')
			? `April and May are the long rains. The country is green, the parks are close to empty, and some seasonal camps shut for the period; roads in the western and northern ${A('serengeti-national-park', 'Serengeti')} can be genuinely hard going. November brings a shorter, lighter rain that rarely costs you a game drive.`
			: `April and May are the long rains. The country is green, the parks are close to empty, and some seasonal camps shut for the period; the black-cotton tracks turn heavy and a few of them close. November brings a shorter, lighter rain that rarely costs you a game drive.`
	);
	lines.push(
		`If your dates are fixed, tell us what they are and we will say plainly what you will and will not see then — we would rather move you to the right park than sell you the wrong month.`
	);

	const list = bullets.length ? `<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : '';
	return `<p>${lines[0]}</p>${list}<p>${lines[1]}</p><p>${lines[2]}</p>`;
}

/* -------------------------------------------------------------- the run --- */

/** The parks this listing actually visits, read from its own title and copy. */
function factsFor(row: {
	title: string;
	description: string | null;
	shortDescription: string | null;
	durationDays: number;
	groupType: string | null;
}): Facts {
	const hay = `${row.title} ${row.description ?? ''} ${row.shortDescription ?? ''}`;
	const has = (re: RegExp) => re.test(hay);
	const parks = new Set<string>();
	if (has(/serengeti/i)) parks.add('serengeti');
	if (has(/tarangire/i)) parks.add('tarangire');
	if (has(/ngorongoro/i)) parks.add('ngorongoro');
	if (has(/manyara/i)) parks.add('manyara');
	if (has(/nyerere|selous/i)) parks.add('nyerere');
	if (has(/mikumi/i)) parks.add('mikumi');
	if (has(/kilimanjaro/i)) parks.add('kilimanjaro');
	// Nyerere, Mikumi and Ruaha are the southern circuit; the rest of this
	// catalogue is northern. Copy written for one is wrong on the other, and
	// "the northern parks" on a Selous listing is the kind of error a Tanzanian
	// reader spots in a second.
	const south = ['nyerere', 'mikumi'].some((k) => parks.has(k));
	const north = ['serengeti', 'tarangire', 'ngorongoro', 'manyara'].some((k) => parks.has(k));
	return {
		title: row.title,
		duration: row.durationDays,
		groupType: row.groupType ?? 'PRIVATE',
		/*
		 * Zanzibar is an island, so an itinerary that has both the island and a
		 * mainland park on it involves an aircraft whether or not the operator's
		 * copy says the word. Reading only for "flight" left the 6-day migration
		 * safari being described as a road trip from Zanzibar, which is not a
		 * journey that exists.
		 */
		flyIn: has(/\bfly[- ]?in\b|\bflight\b|\bflies\b|\bfly\b/i) || (has(/zanzibar/i) && parks.size > 0),
		/*
		 * Read from the operator's own copy, not from the title.
		 *
		 * "5-Day Zanzibar Beach Holiday with Mikumi Safari Day Trip" has no "from
		 * Zanzibar" in its title and its body says "based in Zanzibar, with a short
		 * fly-in safari to Mikumi" — a title-only test had this island trip being
		 * collected from Kilimanjaro Airport. Every one of these listings states
		 * where it starts somewhere in its text; this asks it rather than guessing.
		 */
		startsZanzibar: /(?:from|starting in|based in|begins in|begin in|departs from)\s+zanzibar/i.test(hay),
		visitsZanzibar: has(/zanzibar/i),
		beach: /beach|holiday/i.test(row.title),
		level: /luxury/i.test(row.title)
			? 'luxury'
			: /mid-?range/i.test(row.title)
				? 'midrange'
				: /classic/i.test(row.title)
					? 'classic'
					: 'standard',
		parks,
		// The northern Serengeti is a different trip from the southern one, and the
		// listing says which it is. Only a listing that goes north gets river-
		// crossing advice; giving it to the others would be selling a month that
		// itinerary cannot deliver.
		migrationNorth: has(/northern serengeti|great migration|migration/i),
		circuit: north && south ? 'both' : south ? 'south' : 'north'
	};
}

async function main() {
	const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
	if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
	const sql = postgres(url, { max: 1, onnotice: () => {} });

	const tours = await sql<
		{
			id: string;
			title: string;
			slug: string;
			description: string | null;
			short_description: string | null;
			duration_days: number;
			group_type: string | null;
			price_from: string | null;
			currency: string | null;
			adult_price: string | null;
			accommodation_summary: string | null;
		}[]
	>`select id, title, slug, description, short_description, duration_days, group_type, price_from, currency,
	         adult_price, accommodation_summary
	    from tours
	   where tenant_id = ${TENANT} and deleted_at is null and status = 'PUBLISHED'
	   order by duration_days, price_from`;

	const dests = await sql<
		{ name: string; slug: string }[]
	>`select name, slug from destinations where status = 'PUBLISHED' order by length(name) desc`;

	console.log(`${APPLY ? 'APPLYING to' : 'DRY RUN over'} ${tours.length} published listings\n`);

	const copy: { id: string; patch: Record<string, string | null | undefined> }[] = [];
	const prices: { id: string; title: string; input: ReturnType<typeof priceBook>; base: number }[] = [];

	for (const t of tours) {
		const base = Number(t.price_from);
		if (!Number.isFinite(base) || base <= 0) {
			console.log(`  SKIP (no price)  ${t.title}`);
			continue;
		}
		const f = factsFor({
			title: t.title,
			description: t.description,
			shortDescription: t.short_description,
			durationDays: t.duration_days,
			groupType: t.group_type
		});
		const book = priceBook(base, f.groupType, f.flyIn);
		prices.push({ id: t.id, title: t.title, input: book, base });

		// Sanitised here, exactly as the composer's own action sanitises what an
		// operator types. A row this script writes must be indistinguishable from a
		// row the form writes, or the two paths have different safety.
		copy.push({
			id: t.id,
			patch: {
				/*
				 * Converted ONCE. The converter reads plain text — blank lines are
				 * paragraph breaks, a bullet starts a list — and handing it the HTML
				 * it produced last time would escape the whole listing into a single
				 * paragraph of visible markup. A description that already carries
				 * block tags has been through here and is left exactly as it is.
				 */
				description: /<(p|h3|h4|ul|ol|li|blockquote)\b/i.test(t.description ?? '')
					? undefined
					: sanitizeRichText(toRichText(t.description ?? '', dests)),
				accommodationSummary: sanitizeRichText(accommodation(f)),
				transportSummary: sanitizeRichText(transport(f)),
				mealsSummary: sanitizeRichText(meals(f)),
				bestTimeSummary: sanitizeRichText(bestTime(f))
			}
		});
	}

	// ---- what the price book looks like, before anything is written
	console.log(
		'  party      ' +
			prices
				.slice(0, 1)
				.map(() => '')
				.join('') +
			'adult / child'
	);
	for (const p of prices) {
		const bands = p.input.tiers
			.map(
				(t) =>
					`${t.minTravellers}${t.maxTravellers === null ? '+' : t.maxTravellers === t.minTravellers ? '' : '-' + t.maxTravellers}:${Number(t.adult).toFixed(0)}/${Number(t.child).toFixed(0)}`
			)
			.join('  ');
		const floor = p.input.tiers[p.input.tiers.length - 1].adult;
		const kept = Number(floor) === p.base ? 'from unchanged' : `FROM MOVES ${p.base} -> ${floor}`;
		console.log(`  ${p.title.slice(0, 46).padEnd(46)} ${bands}   [${kept}]`);
	}

	if (!APPLY) {
		if (process.argv.includes('--audit')) {
			// One line per listing per field: enough to see at a glance that no tour
			// is being told about a park it does not visit or a flight it does not take.
			const first = (html: string | null | undefined) =>
				String(html ?? '')
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim()
					.slice(0, 96);
			for (let i = 0; i < copy.length; i++) {
				console.log(`\n  ${tours[i].title}`);
				console.log(`    move  ${first(copy[i].patch.transportSummary)}`);
				console.log(`    sleep ${first(copy[i].patch.accommodationSummary)}`);
				console.log(`    when  ${first(copy[i].patch.bestTimeSummary)}`);
			}
			await sql.end();
			return;
		}
		console.log('\n  --- sample copy -------------------------------------------');
		const idx = Number(process.env.SAMPLE ?? 6);
		const sample = copy[idx];
		console.log('  sample: ' + tours[idx].title);
		for (const [k, v] of Object.entries(sample.patch)) {
			console.log(`\n  [${k}]\n${String(v).replace(/></g, '>\n<')}`);
		}
		console.log('\nDry run. Nothing written. Re-run with --apply.');
		await sql.end();
		return;
	}

	const { updateTour } = await import('../src/lib/server/tours');
	let priced = 0;
	let written = 0;
	for (const p of prices) {
		const { priceFrom } = await saveTourPricing(TENANT, p.id, {
			currency: 'USD',
			adultPrice: p.input.adultPrice,
			childPrice: p.input.childPrice,
			tiers: p.input.tiers,
			seasons: []
		});
		if (Number(priceFrom) !== p.base) {
			throw new Error(`${p.title}: advertised price moved ${p.base} -> ${priceFrom}. Stopping.`);
		}
		priced++;
	}
	for (const c of copy) {
		// No actor: this is the platform acting on the tenant's catalogue, not a user
		// of theirs, and inventing a user id in their audit trail would be a lie.
		await updateTour(TENANT, c.id, c.patch);
		written++;
	}
	console.log(`\n  priced ${priced} listings, rewrote copy on ${written}.`);
	await sql.end();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
