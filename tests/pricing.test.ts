// The pricing engine, which decides what a party is charged.
//
// The owner asked for this to be among the best-tested logic in Connect, and it
// deserves to be: every branch here is a number somebody is invoiced.
import { describe, expect, it } from 'vitest';
import {
	calculateTourPrice,
	lowestAdultPrice,
	resolveRates,
	seasonCovers,
	validatePricing,
	type TourPricing
} from '../src/lib/pricing';

const base = (over: Partial<TourPricing> = {}): TourPricing => ({
	currency: 'USD',
	perGroup: false,
	base: { adult: '1099.00', child: '750.00' },
	tiers: [],
	seasons: [],
	...over
});

describe('base pricing', () => {
	it('prices adults', () => {
		const r = calculateTourPrice(base(), { travelDate: null, adults: 2, children: 0 })!;
		expect(r.adultPrice).toBe('1099.00');
		expect(r.total).toBe('2198.00');
		expect(r.applied).toBe('Standard pricing');
	});

	it('prices adults and children separately', () => {
		const r = calculateTourPrice(base(), { travelDate: '2026-09-17', adults: 2, children: 2 })!;
		expect(r.total).toBe('3698.00'); // 2×1099 + 2×750
		expect(r.childPrice).toBe('750.00');
		expect(r.childRateMissing).toBe(false);
	});

	it('prices a single traveller', () => {
		expect(calculateTourPrice(base(), { travelDate: null, adults: 1, children: 0 })!.total).toBe('1099.00');
	});

	it('says so when a child rate is missing rather than hiding the equality', () => {
		// The catalogue publishes no child rate. Charging the adult price silently
		// is the bug this flag exists to surface to the operator.
		const r = calculateTourPrice(base({ base: { adult: '1099.00', child: null } }), {
			travelDate: null,
			adults: 1,
			children: 1
		})!;
		expect(r.childRateMissing).toBe(true);
		expect(r.childPrice).toBe('1099.00');
		expect(r.total).toBe('2198.00');
	});

	it('does not raise the flag when the party has no children', () => {
		const r = calculateTourPrice(base({ base: { adult: '1099.00', child: null } }), {
			travelDate: null,
			adults: 2,
			children: 0
		})!;
		expect(r.childRateMissing).toBe(false);
		expect(r.childPrice).toBeNull();
	});

	it('returns null for an unpriced tour rather than a confident zero', () => {
		expect(calculateTourPrice(base({ base: null }), { travelDate: null, adults: 2, children: 0 })).toBeNull();
	});

	it('counts a group tour once, however large the party', () => {
		const r = calculateTourPrice(base({ perGroup: true, base: { adult: '4200.00', child: null } }), {
			travelDate: null,
			adults: 4,
			children: 2
		})!;
		expect(r.total).toBe('4200.00');
		expect(r.childPrice).toBeNull();
	});
});

describe('group-size tiers', () => {
	const tiered = base({
		tiers: [
			{ minTravellers: 1, maxTravellers: 1, adult: '1650.00', child: '1100.00' },
			{ minTravellers: 2, maxTravellers: 2, adult: '1250.00', child: '850.00' },
			{ minTravellers: 3, maxTravellers: 4, adult: '1099.00', child: '750.00' },
			{ minTravellers: 7, maxTravellers: null, adult: '875.00', child: '600.00' }
		]
	});

	it('selects by TOTAL travellers, adults and children together', () => {
		// 2 adults + 2 children is a party of four, not of two.
		const r = calculateTourPrice(tiered, { travelDate: null, adults: 2, children: 2 })!;
		expect(r.adultPrice).toBe('1099.00');
		expect(r.applied).toBe('3-4 travellers');
	});

	it('holds both boundaries of a band', () => {
		expect(calculateTourPrice(tiered, { travelDate: null, adults: 3, children: 0 })!.adultPrice).toBe('1099.00');
		expect(calculateTourPrice(tiered, { travelDate: null, adults: 4, children: 0 })!.adultPrice).toBe('1099.00');
		expect(calculateTourPrice(tiered, { travelDate: null, adults: 2, children: 0 })!.adultPrice).toBe('1250.00');
	});

	it('handles an open-ended top band', () => {
		const r = calculateTourPrice(tiered, { travelDate: null, adults: 9, children: 0 })!;
		expect(r.adultPrice).toBe('875.00');
		expect(r.applied).toBe('7+ travellers');
	});

	it('falls back to base in a gap between bands', () => {
		// 5-6 is deliberately not covered above.
		const r = calculateTourPrice(tiered, { travelDate: null, adults: 5, children: 0 })!;
		expect(r.adultPrice).toBe('1099.00');
		expect(r.applied).toBe('Standard pricing');
	});

	it('names a single-traveller band in the singular', () => {
		expect(calculateTourPrice(tiered, { travelDate: null, adults: 1, children: 0 })!.applied).toBe('1 traveller');
	});
});

describe('seasons', () => {
	const high = { name: 'High Season', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '1250.00', child: '850.00' };
	const festive = { name: 'Festive', startsOn: '2026-12-20', endsOn: '2027-01-05', adult: '1400.00', child: '950.00' };
	const seasonal = base({ seasons: [high, festive] });

	it('applies a season inside its dates', () => {
		const r = calculateTourPrice(seasonal, { travelDate: '2026-09-17', adults: 2, children: 2 })!;
		expect(r.adultPrice).toBe('1250.00');
		expect(r.total).toBe('4200.00'); // 2×1250 + 2×850
		expect(r.applied).toBe('High Season');
	});

	it('holds both boundary days inclusively', () => {
		expect(calculateTourPrice(seasonal, { travelDate: '2026-07-01', adults: 1, children: 0 })!.adultPrice).toBe(
			'1250.00'
		);
		expect(calculateTourPrice(seasonal, { travelDate: '2026-10-31', adults: 1, children: 0 })!.adultPrice).toBe(
			'1250.00'
		);
	});

	it('does not apply the day before or the day after', () => {
		expect(calculateTourPrice(seasonal, { travelDate: '2026-06-30', adults: 1, children: 0 })!.applied).toBe(
			'Standard pricing'
		);
		expect(calculateTourPrice(seasonal, { travelDate: '2026-11-01', adults: 1, children: 0 })!.applied).toBe(
			'Standard pricing'
		);
	});

	it('wraps the year — 20 Dec to 5 Jan is ONE season', () => {
		// The festive season every operator here sells. A naive start<=d<=end
		// comparison matches nothing at all for this range.
		for (const date of ['2026-12-20', '2026-12-31', '2027-01-01', '2027-01-05']) {
			expect(seasonCovers(festive, date)).toBe(true);
		}
		for (const date of ['2026-12-19', '2027-01-06']) {
			expect(seasonCovers(festive, date)).toBe(false);
		}
	});

	it('applies a wrapping season across the new year', () => {
		expect(calculateTourPrice(seasonal, { travelDate: '2027-01-02', adults: 2, children: 0 })!.total).toBe('2800.00');
	});

	it('falls back to base when no season covers the date', () => {
		expect(calculateTourPrice(seasonal, { travelDate: '2026-03-05', adults: 1, children: 0 })!.applied).toBe(
			'Standard pricing'
		);
	});

	it('ignores seasons entirely when the enquiry has no date yet', () => {
		const r = calculateTourPrice(seasonal, { travelDate: null, adults: 1, children: 0 })!;
		expect(r.applied).toBe('Standard pricing');
	});
});

describe('precedence: season beats tier beats base', () => {
	const both = base({
		tiers: [{ minTravellers: 3, maxTravellers: 4, adult: '1099.00', child: '750.00' }],
		seasons: [{ name: 'High Season', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '1250.00', child: '850.00' }]
	});

	it('takes the season when both could apply', () => {
		const r = calculateTourPrice(both, { travelDate: '2026-09-17', adults: 2, children: 2 })!;
		expect(r.adultPrice).toBe('1250.00');
		expect(r.appliedRules.season?.name).toBe('High Season');
		expect(r.appliedRules.tier).toBeNull();
	});

	it('takes the tier out of season', () => {
		const r = calculateTourPrice(both, { travelDate: '2026-03-17', adults: 3, children: 0 })!;
		expect(r.adultPrice).toBe('1099.00');
		expect(r.appliedRules.tier?.minTravellers).toBe(3);
		expect(r.appliedRules.season).toBeNull();
	});

	it('takes base when neither applies', () => {
		const r = calculateTourPrice(both, { travelDate: '2026-03-17', adults: 8, children: 0 })!;
		expect(r.appliedRules.base).toBe(true);
	});

	it('resolveRates agrees with calculateTourPrice about which rule won', () => {
		const { season, tier } = resolveRates(both, { travelDate: '2026-09-17', adults: 3, children: 0 });
		expect(season?.name).toBe('High Season');
		expect(tier).toBeNull();
	});
});

describe('the marketplace "from" price must be reachable', () => {
	it('is the lowest adult rate anywhere in the configuration', () => {
		const p = base({
			tiers: [{ minTravellers: 7, maxTravellers: null, adult: '875.00', child: '600.00' }],
			seasons: [{ name: 'High', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '1250.00', child: '850.00' }]
		});
		// Not the base 1099 and not the season 1250 — a real party of 7 pays 875.
		expect(lowestAdultPrice(p)).toBe('875.00');
	});

	it('is null when nothing is priced, so no claim is made', () => {
		expect(lowestAdultPrice(base({ base: null }))).toBeNull();
	});
});

describe('validation, in words an operator can act on', () => {
	it('catches overlapping tiers and names both', () => {
		const problems = validatePricing(
			base({
				tiers: [
					{ minTravellers: 3, maxTravellers: 5, adult: '1000.00', child: null },
					{ minTravellers: 5, maxTravellers: 7, adult: '900.00', child: null }
				]
			})
		);
		expect(problems.some((p) => p.message.includes('3-5') && p.message.includes('5-7'))).toBe(true);
	});

	it('catches a band that ends before it starts', () => {
		const problems = validatePricing(
			base({ tiers: [{ minTravellers: 6, maxTravellers: 4, adult: '1.00', child: null }] })
		);
		expect(problems.some((p) => p.message.includes('ends before it starts'))).toBe(true);
	});

	it('catches an open band swallowing the one above it', () => {
		const problems = validatePricing(
			base({
				tiers: [
					{ minTravellers: 3, maxTravellers: null, adult: '1000.00', child: null },
					{ minTravellers: 7, maxTravellers: null, adult: '900.00', child: null }
				]
			})
		);
		expect(problems.some((p) => p.message.includes('overlaps'))).toBe(true);
	});

	it('catches overlapping seasons, including a wrapping pair', () => {
		const problems = validatePricing(
			base({
				seasons: [
					{ name: 'Festive', startsOn: '2026-12-20', endsOn: '2027-01-05', adult: '1400.00', child: null },
					{ name: 'New Year', startsOn: '2027-01-01', endsOn: '2027-01-10', adult: '1300.00', child: null }
				]
			})
		);
		expect(problems.some((p) => p.message.includes('overlaps'))).toBe(true);
	});

	it('accepts two seasons that do not touch', () => {
		const problems = validatePricing(
			base({
				seasons: [
					{ name: 'High', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '1250.00', child: null },
					{ name: 'Festive', startsOn: '2026-12-20', endsOn: '2027-01-05', adult: '1400.00', child: null }
				]
			})
		);
		expect(problems).toEqual([]);
	});

	it('rejects negative and unreadable prices, and an unnamed season', () => {
		const problems = validatePricing(
			base({
				base: { adult: '-5.00', child: 'abc' },
				seasons: [{ name: '  ', startsOn: '2026-07-01', endsOn: '2026-10-31', adult: '1.00', child: null }]
			})
		);
		expect(problems.some((p) => p.message.includes('cannot be negative'))).toBe(true);
		expect(problems.some((p) => p.message.includes('not an amount'))).toBe(true);
		expect(problems.some((p) => p.message.includes('name'))).toBe(true);
	});

	it('passes a well-formed configuration', () => {
		expect(validatePricing(base())).toEqual([]);
	});
});

describe('money integrity', () => {
	it('carries the currency through untouched and never converts', () => {
		const r = calculateTourPrice(base({ currency: 'TZS' }), { travelDate: null, adults: 1, children: 0 })!;
		expect(r.currency).toBe('TZS');
	});

	it('totals a large party to the cent', () => {
		const r = calculateTourPrice(base({ base: { adult: '1099.99', child: '750.01' } }), {
			travelDate: null,
			adults: 7,
			children: 3
		})!;
		expect(r.total).toBe('9949.96'); // 7×1099.99 + 3×750.01
	});
});
