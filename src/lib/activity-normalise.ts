// Itinerary prose in, canonical activity out.
//
// Operators write a day's activities as free text and always will — "Serengeti
// afternoon game drive" is the right thing to put on a day, and no picker should
// replace it. This maps that text onto the canonical taxonomy so the two can be
// compared without either being rewritten.
//
// Nothing here writes to the database. It exists so the mapping is one testable
// function rather than a query somebody reproduces slightly differently the next
// time it is needed.

/** Canonical activity slugs, seeded by 0046. */
export const ACTIVITY_SLUGS = [
	'game-drive',
	'walking-safari',
	'boat-safari',
	'beach-time',
	'cultural-visit',
	'waterfall-walk'
] as const;

export type ActivitySlug = (typeof ACTIVITY_SLUGS)[number];

/**
 * Ordered, because the first match wins and some strings mention two things.
 *
 * "Walking safari" before "game drive": a day that says both is a walking day
 * with a drive attached, and the walk is the rarer, more decisive fact. Each
 * pattern is deliberately narrow — a broad one silently swallows a string that
 * meant something else, and a missed string is easier to notice than a wrong one.
 */
const PATTERNS: [ActivitySlug, RegExp][] = [
	['walking-safari', /\bwalking safari\b|\bbush walk\b|\bnature walk\b|\bguided walk\b/i],
	['boat-safari', /\bboat safari\b|\bcanoe\b|\bmokoro\b|\bboat trip\b/i],
	['waterfall-walk', /\bwaterfalls?\b/i],
	['cultural-visit', /\bvillage visit\b|\bspice tour\b|\bstone town\b|\bcoffee experience\b|\bcultural visit\b/i],
	['beach-time', /\bbeach leisure\b|\bbeach time\b|\brelax by the ocean\b|\bbeach day\b|\bsnorkell?ing\b|\bwater sports\b/i],
	['game-drive', /\bgame drive(s)?\b|\bgame viewing\b|\bwildlife viewing\b/i]
];

/**
 * The canonical activity a line of itinerary text describes, or null.
 *
 * Null is the common and correct answer. Of the 478 activity strings on
 * published itineraries, over half are operational — "picnic lunch" alone is
 * 113 of them, transfers and flights around 95 more — and none of those is a
 * reason anybody books a safari. Returning null for them is the point, not a
 * gap: an activity taxonomy that contains "airport transfer" is a taxonomy
 * nobody can filter with.
 */
export function activityFor(text: string | null | undefined): ActivitySlug | null {
	const value = String(text ?? '').trim();
	if (!value) return null;
	for (const [slug, pattern] of PATTERNS) {
		if (pattern.test(value)) return slug;
	}
	return null;
}

/**
 * Every canonical activity a set of itinerary lines implies, in taxonomy order.
 *
 * Deduplicated: nine days of game drives are one thing the traveller does, not
 * nine. Used to suggest, never to persist — a tour's activities are what its
 * operator ticked, and inferring them from prose would put words in their mouth.
 */
export function activitiesFor(lines: readonly (string | null | undefined)[]): ActivitySlug[] {
	const found = new Set<ActivitySlug>();
	for (const line of lines ?? []) {
		const slug = activityFor(line);
		if (slug) found.add(slug);
	}
	return ACTIVITY_SLUGS.filter((slug) => found.has(slug));
}
