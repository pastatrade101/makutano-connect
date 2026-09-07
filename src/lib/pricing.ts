/**
 * What a tour costs a particular party on a particular date.
 *
 * ONE calculation, and every surface calls it: the composer's live preview, the
 * quotation recommendation on the portal, the same on the phone, and the
 * marketplace's "from" price. The alternative — each screen deciding for itself
 * which rate wins — is how the same enquiry comes to be quoted two different
 * amounts depending on where the operator happened to be standing.
 *
 * PURE, and deliberately in src/lib rather than src/lib/server: the composer has
 * to show a preview as the operator types, and a preview computed by different
 * code from the real thing is a preview that lies. Nothing here touches the
 * database, the clock or the network — a caller passes the configuration in.
 *
 * WHAT IT DOES NOT DO. It resolves RATES; it does not build quotation lines.
 * Turning an adult rate and a child rate into lines is quotation-lines.ts, which
 * already exists, is already tested and is already shared with the phone. This
 * feeds that rather than duplicating it.
 */
import { toAmount, toMinor, type Minor } from './money';

/** A price that applies to a party: adults always, children only when set. */
export type Rates = {
	adult: string;
	/**
	 * Null means NOT CONFIGURED, and that is different from "same as an adult".
	 * The catalogue publishes no child rate today, and inventing one silently
	 * charges a child the adult price — so the absence is carried all the way to
	 * the operator, who decides.
	 */
	child: string | null;
};

/** Prices for a party size band. maxTravellers null is "and above". */
export type GroupTier = Rates & {
	minTravellers: number;
	maxTravellers: number | null;
};

/** Prices between two dates, inclusive of both. */
export type Season = Rates & {
	name: string;
	/** YYYY-MM-DD, compared as plain calendar dates — see resolve() on why. */
	startsOn: string;
	endsOn: string;
};

export type TourPricing = {
	currency: string;
	/** PER_PERSON prices the party; PER_GROUP prices the trip once. */
	perGroup: boolean;
	/** The rate when no season and no tier applies. Null when unpriced. */
	base: Rates | null;
	tiers: GroupTier[];
	seasons: Season[];
};

export type PriceRequest = {
	/** YYYY-MM-DD. Null when the enquiry has no date yet — base/tier still apply. */
	travelDate: string | null;
	adults: number;
	children: number;
};

export type PriceResult = {
	currency: string;
	adultPrice: string;
	/** Null when the party has no children, or no child rate is configured. */
	childPrice: string | null;
	/** True when a child rate was needed and none exists — the operator must set one. */
	childRateMissing: boolean;
	total: string;
	/** Plain words for the operator: "High Season · 3-4 travellers". */
	applied: string;
	/** The same, structured, for anything that needs to reason rather than print. */
	appliedRules: { base: boolean; tier: GroupTier | null; season: Season | null };
};

/** A calendar date, no time and no zone. "2026-09-17" > "2026-09-05" as strings. */
const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Does a season contain a date?
 *
 * Compared as STRINGS, on purpose. A season boundary is a calendar fact — the
 * 1st of July is the 1st of July in Arusha and in Berlin — and putting these
 * through Date turns them into instants, which shifts the boundary by a day for
 * anyone east or west of the server. ISO dates sort lexicographically, so string
 * comparison is both correct and free.
 *
 * A season whose end is before its start WRAPS THE YEAR: 20 December to 5
 * January is one season, not an error. That is the festive season every operator
 * in this catalogue sells, so it has to work rather than be rejected.
 */
export function seasonCovers(season: Season, date: string): boolean {
	const start = season.startsOn.slice(5); // MM-DD
	const end = season.endsOn.slice(5);
	const day = date.slice(5);
	return start <= end ? day >= start && day <= end : day >= start || day <= end;
}

const tierCovers = (tier: GroupTier, travellers: number): boolean =>
	travellers >= tier.minTravellers && (tier.maxTravellers === null || travellers <= tier.maxTravellers);

/**
 * Precedence: season, then group size, then base.
 *
 * A season is the more specific statement — an operator who says "December costs
 * more" means it costs more whatever the party size — so it wins outright rather
 * than combining with a tier. Combining the two would need a rate for every
 * season x band, which is the spreadsheet this deliberately does not ask anyone
 * to fill in.
 *
 * Ties cannot arise: overlapping seasons and overlapping tiers are both refused
 * at save time (see validatePricing), so at most one of each can match.
 */
export function resolveRates(
	pricing: TourPricing,
	request: PriceRequest
): { rates: Rates | null; season: Season | null; tier: GroupTier | null } {
	const travellers = Math.max(0, Math.trunc(request.adults)) + Math.max(0, Math.trunc(request.children));

	const season =
		request.travelDate && isDate(request.travelDate)
			? (pricing.seasons.find((s) => seasonCovers(s, request.travelDate as string)) ?? null)
			: null;
	if (season) return { rates: season, season, tier: null };

	const tier = pricing.tiers.find((t) => tierCovers(t, travellers)) ?? null;
	if (tier) return { rates: tier, season: null, tier };

	return { rates: pricing.base, season: null, tier: null };
}

/** How the chosen rate reads to an operator asking why. */
function describe(season: Season | null, tier: GroupTier | null, travellers: number): string {
	if (season) return season.name;
	if (tier) {
		const band =
			tier.maxTravellers === null
				? `${tier.minTravellers}+ travellers`
				: tier.minTravellers === tier.maxTravellers
					? `${tier.minTravellers} traveller${tier.minTravellers === 1 ? '' : 's'}`
					: `${tier.minTravellers}-${tier.maxTravellers} travellers`;
		return band;
	}
	return travellers > 0 ? 'Standard pricing' : 'Standard pricing';
}

/**
 * The price for this party on this date, or null when the tour is not priced.
 *
 * Null is a real answer: a tour may be a draft with no price yet, and a
 * confident 0.00 in a quotation is worse than an empty field the operator is
 * asked to fill.
 */
export function calculateTourPrice(pricing: TourPricing, request: PriceRequest): PriceResult | null {
	const { rates, season, tier } = resolveRates(pricing, request);
	if (!rates) return null;

	const adultMinor = toMinor(rates.adult);
	if (adultMinor === null) return null;

	const adults = Math.max(0, Math.trunc(request.adults));
	const children = Math.max(0, Math.trunc(request.children));
	const travellers = adults + children;

	// A group price is the whole trip, counted once. Multiplying it by the party
	// quotes a family of four at four times the real price.
	if (pricing.perGroup) {
		return {
			currency: pricing.currency,
			adultPrice: toAmount(adultMinor),
			childPrice: null,
			childRateMissing: false,
			total: toAmount(adultMinor),
			applied: describe(season, tier, travellers),
			appliedRules: { base: !season && !tier, tier, season }
		};
	}

	const childMinor: Minor | null = children > 0 ? toMinor(rates.child ?? '') : null;
	const childRateMissing = children > 0 && childMinor === null;

	// When no child rate is configured the child is priced as an adult AND the
	// caller is told so, rather than the equality being buried in the total.
	const childEffective = childMinor ?? adultMinor;
	const total = adultMinor * adults + (children > 0 ? childEffective * children : 0);

	return {
		currency: pricing.currency,
		adultPrice: toAmount(adultMinor),
		childPrice: children > 0 ? toAmount(childEffective) : null,
		childRateMissing,
		total: toAmount(total),
		applied: describe(season, tier, travellers),
		appliedRules: { base: !season && !tier, tier, season }
	};
}

/**
 * The lowest adult price a traveller could actually be charged.
 *
 * This is what the marketplace's "From $1,099" must mean. The product rule is
 * that no claim may be made which the software cannot honour, so this is the
 * minimum over every rate a real party could reach — not a number typed
 * separately and left to drift from the rates underneath it.
 */
export function lowestAdultPrice(pricing: TourPricing): string | null {
	const candidates = [pricing.base?.adult, ...pricing.tiers.map((t) => t.adult), ...pricing.seasons.map((s) => s.adult)]
		.map((a) => (a === undefined ? null : toMinor(a)))
		.filter((v): v is Minor => v !== null);
	return candidates.length ? toAmount(Math.min(...candidates)) : null;
}

/* ----------------------------------------------------------- validation ---- */

export type PricingProblem = { field: string; message: string };

/**
 * Said the way an operator would say it.
 *
 * "Your 3-5 traveller price overlaps with the 5-7 traveller price" is actionable;
 * a constraint name is not. The database enforces the same invariants — this is
 * the version a person reads.
 */
export function validatePricing(pricing: TourPricing): PricingProblem[] {
	const problems: PricingProblem[] = [];
	const amount = (label: string, field: string, value: string | null, required: boolean) => {
		if (value === null || value === '') {
			if (required) problems.push({ field, message: `${label} needs a price.` });
			return;
		}
		const minor = toMinor(value);
		if (minor === null) problems.push({ field, message: `${label} is not an amount we can read.` });
		else if (minor < 0) problems.push({ field, message: `${label} cannot be negative.` });
	};

	if (!pricing.currency) problems.push({ field: 'currency', message: 'Choose the currency you charge in.' });
	if (pricing.base) {
		amount('The adult price', 'base.adult', pricing.base.adult, true);
		amount('The child price', 'base.child', pricing.base.child, false);
	}

	const tiers = [...pricing.tiers].sort((a, b) => a.minTravellers - b.minTravellers);
	tiers.forEach((tier, index) => {
		const label = tier.maxTravellers === null ? `${tier.minTravellers}+` : `${tier.minTravellers}-${tier.maxTravellers}`;
		amount(`The ${label} traveller adult price`, `tier.${index}.adult`, tier.adult, true);
		amount(`The ${label} traveller child price`, `tier.${index}.child`, tier.child, false);
		if (tier.minTravellers < 1) {
			problems.push({ field: `tier.${index}`, message: 'A price tier has to start at one traveller or more.' });
		}
		if (tier.maxTravellers !== null && tier.maxTravellers < tier.minTravellers) {
			problems.push({
				field: `tier.${index}`,
				message: `Your ${label} tier ends before it starts. Check the traveller numbers.`
			});
		}
		const next = tiers[index + 1];
		if (next && (tier.maxTravellers === null || next.minTravellers <= tier.maxTravellers)) {
			const nextLabel =
				next.maxTravellers === null ? `${next.minTravellers}+` : `${next.minTravellers}-${next.maxTravellers}`;
			problems.push({
				field: `tier.${index}`,
				message: `Your ${label} traveller price overlaps with the ${nextLabel} traveller price. A party of ${next.minTravellers} would match both.`
			});
		}
	});

	pricing.seasons.forEach((season, index) => {
		const label = season.name?.trim() || 'A season';
		amount(`${label}'s adult price`, `season.${index}.adult`, season.adult, true);
		amount(`${label}'s child price`, `season.${index}.child`, season.child, false);
		if (!season.name?.trim()) {
			problems.push({ field: `season.${index}.name`, message: 'Give the season a name travellers would recognise.' });
		}
		if (!isDate(season.startsOn) || !isDate(season.endsOn)) {
			problems.push({ field: `season.${index}`, message: `${label} needs a start and end date.` });
			return;
		}
		for (const other of pricing.seasons.slice(index + 1)) {
			if (!isDate(other.startsOn) || !isDate(other.endsOn)) continue;
			// Two seasons clash when either one's start falls inside the other, which
			// catches wrap-around pairs that a plain start<=end<=end test would miss.
			if (seasonCovers(other, season.startsOn) || seasonCovers(season, other.startsOn)) {
				problems.push({
					field: `season.${index}`,
					message: `${label} overlaps with ${other.name?.trim() || 'another season'}. A trip on those dates would have two prices.`
				});
			}
		}
	});

	return problems;
}
