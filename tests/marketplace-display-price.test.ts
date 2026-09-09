import { describe, expect, it } from 'vitest';
import { calculateTourPrice, lowestAdultPrice, type TourPricing } from '../src/lib/pricing';
import { DISPLAY_PARTY, displayPriceFor } from '../src/lib/server/marketplace';

/**
 * The card's reference price: what TWO ADULTS would pay.
 *
 * `priceFrom` stays `lowestAdultPrice()` — the cheapest rate any party could
 * reach — and is not redefined here. This pins the SECOND figure, the one a card
 * advertises, and the rules it must obey: the reference party is two adults, no
 * date is involved, and a group price is never turned into a per-person one.
 *
 * The engine does the arithmetic. What is asserted here is which question the
 * marketplace asks it, because that is the part a card can get wrong.
 */
const REFERENCE = { travelDate: null, adults: 2, children: 0 } as const;

const tiered: TourPricing = {
	currency: 'USD',
	perGroup: false,
	base: { adult: '1940.00', child: '1455.00' },
	tiers: [
		{ minTravellers: 1, maxTravellers: 1, adult: '2840.00', child: '2130.00' },
		{ minTravellers: 2, maxTravellers: 2, adult: '2205.00', child: '1655.00' },
		{ minTravellers: 3, maxTravellers: 4, adult: '1940.00', child: '1455.00' },
		{ minTravellers: 5, maxTravellers: 6, adult: '1770.00', child: '1330.00' },
		{ minTravellers: 7, maxTravellers: null, adult: '1671.00', child: '1255.00' }
	],
	seasons: []
};

describe('the two-adult reference price', () => {
	it('takes the tier for exactly two travellers, not the cheapest one', () => {
		const result = calculateTourPrice(tiered, REFERENCE)!;
		expect(result.adultPrice).toBe('2205.00');
		expect(result.total).toBe('4410.00');
		expect(result.appliedRules.tier?.minTravellers).toBe(2);
	});

	it('is a DIFFERENT number from priceFrom, which is the point of adding it', () => {
		// priceFrom is the floor — the 7+ rate — and a couple pays a third more.
		expect(lowestAdultPrice(tiered)).toBe('1671.00');
		expect(calculateTourPrice(tiered, REFERENCE)!.adultPrice).toBe('2205.00');
	});

	it('keeps the operator’s currency', () => {
		const euros: TourPricing = { ...tiered, currency: 'EUR' };
		expect(calculateTourPrice(euros, REFERENCE)!.currency).toBe('EUR');
	});

	it('falls back to the base rate when the tour publishes no tiers', () => {
		const flat: TourPricing = { ...tiered, tiers: [] };
		const result = calculateTourPrice(flat, REFERENCE)!;
		expect(result.adultPrice).toBe('1940.00');
		expect(result.appliedRules.base).toBe(true);
	});
});

describe('a card has no travel date, so no season may apply', () => {
	const seasonal: TourPricing = {
		...tiered,
		seasons: [
			{ name: 'High Season', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '2500.00', child: '1875.00' },
			{ name: 'Festive', startsOn: '2026-12-20', endsOn: '2027-01-05', adult: '3100.00', child: '2325.00' }
		]
	};

	it('ignores every season and quotes the two-traveller tier', () => {
		const result = calculateTourPrice(seasonal, REFERENCE)!;
		expect(result.adultPrice).toBe('2205.00');
		expect(result.appliedRules.season).toBeNull();
	});

	it('is not distorted by a season that is cheaper OR dearer than the tier', () => {
		const cheapSeason: TourPricing = {
			...tiered,
			seasons: [{ name: 'Green', startsOn: '2026-04-01', endsOn: '2026-05-31', adult: '900.00', child: '675.00' }]
		};
		// A card must not advertise a low seasonal rate stripped of the dates that
		// earn it, and must not inherit a peak one either.
		expect(calculateTourPrice(cheapSeason, REFERENCE)!.adultPrice).toBe('2205.00');
		expect(calculateTourPrice(seasonal, REFERENCE)!.adultPrice).toBe('2205.00');
	});

	it('still lets Plan My Trip reach the season once a date is given', () => {
		const dated = calculateTourPrice(seasonal, { travelDate: '2026-07-20', adults: 2, children: 0 })!;
		expect(dated.adultPrice).toBe('2500.00');
		expect(dated.appliedRules.season?.name).toBe('High Season');
	});
});

describe('a group price is never made per-person', () => {
	const group: TourPricing = {
		currency: 'USD',
		perGroup: true,
		base: { adult: '5000.00', child: null },
		tiers: [],
		seasons: []
	};

	it('prices the trip once, whatever the party', () => {
		const two = calculateTourPrice(group, REFERENCE)!;
		const eight = calculateTourPrice(group, { travelDate: null, adults: 8, children: 2 })!;
		expect(two.total).toBe('5000.00');
		expect(eight.total).toBe('5000.00');
	});

	it('is displayed from the TOTAL, so it is never divided by two either', () => {
		const result = calculateTourPrice(group, REFERENCE)!;
		expect(result.total).toBe('5000.00');
		expect(result.total).not.toBe('2500.00');
	});
});

describe('legacy tours', () => {
	it('are recognised by having no structured adult rate', () => {
		// tourPricing() feeds priceFrom in as a base so a quotation can still be
		// built, which means the ENGINE answers for a legacy tour. The card must
		// therefore decide on `adultPrice` being absent, not on the engine
		// returning null — otherwise it would claim "for 2 travellers" over a
		// number nobody entered against a party size.
		const legacy: TourPricing = {
			currency: 'USD',
			perGroup: false,
			base: { adult: '1099.00', child: null },
			tiers: [],
			seasons: []
		};
		expect(calculateTourPrice(legacy, REFERENCE)).not.toBeNull();
	});

	it('an unpriced tour has no reference price at all', () => {
		const unpriced: TourPricing = { currency: 'USD', perGroup: false, base: null, tiers: [], seasons: [] };
		expect(calculateTourPrice(unpriced, REFERENCE)).toBeNull();
	});
});

/**
 * The function the card actually calls.
 *
 * The suite above pins the ENGINE's answers, which it would keep doing happily
 * while `displayPriceFor` asked it the wrong question — a party of twenty, or a
 * date. Verified by mutation: changing the party there left every test above
 * green. These call the real thing.
 */
describe('displayPriceFor — the wiring, not just the arithmetic', () => {
	const tiers = tiered.tiers;
	const perPersonTour = {
		adultPrice: '1940.00',
		childPrice: '1455.00',
		currency: 'USD',
		pricingType: 'PER_PERSON'
	};

	it('asks for exactly two adults', () => {
		expect(DISPLAY_PARTY).toEqual({ adults: 2, children: 0 });
		const price = displayPriceFor(perPersonTour, tiers)!;
		expect(price.adults).toBe(2);
		expect(price.children).toBe(0);
		expect(price.amount).toBe('2205.00');
	});

	it('reports a per-person amount for a per-person tour', () => {
		const price = displayPriceFor(perPersonTour, tiers)!;
		expect(price.perPerson).toBe(true);
		expect(price.pricingType).toBe('PER_PERSON');
		expect(price.currency).toBe('USD');
	});

	it('reports the WHOLE-GROUP amount for a group tour, never a half of it', () => {
		const price = displayPriceFor(
			{ adultPrice: '5000.00', childPrice: null, currency: 'USD', pricingType: 'PER_GROUP' },
			[]
		)!;
		expect(price.perPerson).toBe(false);
		expect(price.amount).toBe('5000.00');
		expect(price.amount).not.toBe('2500.00');
	});

	it('returns NOTHING for a legacy tour, so no card claims a party size', () => {
		// A hand-typed priceFrom with no structured adult rate. The engine would
		// answer if asked — tourPricing() feeds priceFrom in as a base — so the
		// guard has to be here, on the absence of adultPrice.
		expect(
			displayPriceFor({ adultPrice: null, childPrice: null, currency: 'USD', pricingType: 'PER_PERSON' }, [])
		).toBeNull();
	});

	it('falls back to the base rate when a priced tour publishes no tiers', () => {
		expect(displayPriceFor(perPersonTour, [])!.amount).toBe('1940.00');
	});

	it('defaults a missing currency rather than emitting an empty one', () => {
		expect(displayPriceFor({ ...perPersonTour, currency: null }, tiers)!.currency).toBe('USD');
	});
});
