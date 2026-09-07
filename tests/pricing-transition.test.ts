// price_from becomes derived, and legacy tours are not dragged along.
//
// 54 published tours carry a hand-typed price_from and no adult_price. They must
// keep publishing, displaying and quoting exactly as they do until an operator
// deliberately saves structured pricing — and from that save onward there is one
// authority, not two.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateTourPrice, lowestAdultPrice, validatePricing, type TourPricing } from '../src/lib/pricing';

const SAVE = readFileSync('src/lib/server/tour-pricing.ts', 'utf8');
const ACTION = readFileSync('src/routes/app/tours/[id]/+page.server.ts', 'utf8');
const COMPOSER = readFileSync('src/routes/app/tours/[id]/+page.svelte', 'utf8');

const structured = (over: Partial<TourPricing> = {}): TourPricing => ({
	currency: 'USD',
	perGroup: false,
	base: { adult: '1099.00', child: '750.00' },
	tiers: [],
	seasons: [],
	...over
});

describe('1 & 7: a legacy tour stays legacy until someone decides otherwise', () => {
	it('keeps quoting its hand-typed price when adult_price is null', () => {
		// tourPricingFor falls back to price_from, so the engine answers for every
		// tour in the catalogue with nothing migrated.
		expect(SAVE).toMatch(/const adult = tour\.adultPrice \?\? tour\.priceFrom;/);
	});

	it('is identified by adult_price, not by guesswork', () => {
		expect(SAVE).toMatch(/isStructured[\s\S]{0,120}adultPrice !== null/);
	});

	it('is not migrated by opening or editing the tour', () => {
		// The structured form only appears once the operator asks for it, and the
		// legacy save action still writes priceFrom by hand.
		expect(COMPOSER).toMatch(/structuredOpen = true/);
		expect(COMPOSER).toMatch(/This tour is using simple pricing/);
		expect(ACTION).toMatch(/priceFrom: text\(f, 'priceFrom'\)/);
	});

	it('does not invent a child price from a legacy adult price', () => {
		// A legacy price_from says nothing about children.
		const legacy = structured({ base: { adult: '1099.00', child: null } });
		const r = calculateTourPrice(legacy, { travelDate: null, adults: 1, children: 1 })!;
		expect(r.childRateMissing).toBe(true);
	});
});

describe('2-5: the derived marketplace price follows the configuration', () => {
	it('2: falls to the lowest tier once tiers exist', () => {
		const p = structured({
			tiers: [
				{ minTravellers: 5, maxTravellers: 6, adult: '975.00', child: null },
				{ minTravellers: 7, maxTravellers: null, adult: '950.00', child: null }
			]
		});
		expect(lowestAdultPrice(p)).toBe('950.00');
	});

	it('3: follows a tier downwards', () => {
		const p = structured({ tiers: [{ minTravellers: 7, maxTravellers: null, adult: '875.00', child: null }] });
		expect(lowestAdultPrice(p)).toBe('875.00');
	});

	it('4: rises again when the lowest tier is removed', () => {
		const p = structured({ tiers: [{ minTravellers: 5, maxTravellers: 6, adult: '950.00', child: null }] });
		expect(lowestAdultPrice(p)).toBe('950.00');
	});

	it('5: a season below base is reflected, because a traveller can reach it', () => {
		const p = structured({
			seasons: [{ name: 'Green Season', startsOn: '2026-04-01', endsOn: '2026-05-31', adult: '820.00', child: null }]
		});
		expect(lowestAdultPrice(p)).toBe('820.00');
		// And it is genuinely reachable — the engine quotes it on a date in range.
		expect(calculateTourPrice(p, { travelDate: '2026-04-15', adults: 1, children: 0 })!.adultPrice).toBe('820.00');
	});

	it('never advertises a price no valid configuration can produce', () => {
		expect(lowestAdultPrice(structured({ base: null }))).toBeNull();
	});
});

describe('6: an invalid configuration is rejected and leaves price_from alone', () => {
	it('refuses overlapping tiers before anything is written', () => {
		const problems = validatePricing(
			structured({
				tiers: [
					{ minTravellers: 3, maxTravellers: 5, adult: '1000.00', child: null },
					{ minTravellers: 5, maxTravellers: 7, adult: '900.00', child: null }
				]
			})
		);
		expect(problems.length).toBeGreaterThan(0);
	});

	it('validates BEFORE the transaction, so a bad save writes nothing at all', () => {
		// Scoped to saveTourPricing: lowestAdultPrice is also called by
		// marketplacePriceFrom earlier in the file, which is a read, not a save.
		const fn = SAVE.slice(SAVE.indexOf('export async function saveTourPricing'));
		const validateAt = fn.indexOf('validatePricing(pricing)');
		const deriveAt = fn.indexOf('lowestAdultPrice(pricing)');
		const txAt = fn.indexOf('txDb().transaction');
		expect(validateAt).toBeGreaterThan(-1);
		expect(validateAt).toBeLessThan(deriveAt);
		expect(deriveAt).toBeLessThan(txAt);
	});

	it('refuses to save when no adult price can be derived', () => {
		expect(SAVE).toMatch(/Set an adult price before saving/);
	});
});

describe('one authority: price_from is derived, never submitted', () => {
	it('the structured action does not read priceFrom from the form', () => {
		const action = ACTION.slice(ACTION.indexOf('saveStructuredPricing:'));
		const body = action.slice(0, action.indexOf('\n\t/**', 10) > 0 ? action.indexOf('\n\t/**', 10) : 4000);
		expect(body).not.toMatch(/f\.get\('priceFrom'\)/);
		expect(body).not.toMatch(/text\(f, 'priceFrom'\)/);
	});

	it('the server writes priceFrom from the derived value', () => {
		expect(SAVE).toMatch(/priceFrom: derived/);
	});

	it('the composer shows the marketplace price and never submits it', () => {
		expect(COMPOSER).toMatch(/Calculated automatically from your pricing/);
		expect(COMPOSER).not.toMatch(/name="priceFrom"[\s\S]{0,200}saveStructuredPricing/);
	});

	it('rules and the derived price commit together, through txDb', () => {
		// A save that stored a new tier and left price_from advertising the old
		// floor is a public claim the software no longer honours.
		expect(SAVE).toMatch(/txDb\(\)\.transaction/);
		expect(SAVE).not.toMatch(/\bdb\(\)\.transaction/);
	});
});

describe('8-9: children and the public contract', () => {
	it('8: a missing child price does not move the adult marketplace price', () => {
		const withChild = structured({ base: { adult: '1099.00', child: '750.00' } });
		const withoutChild = structured({ base: { adult: '1099.00', child: null } });
		expect(lowestAdultPrice(withChild)).toBe(lowestAdultPrice(withoutChild));
	});

	it('8: a quotation with children still demands an explicit child rate', () => {
		const portal = readFileSync('src/routes/app/booking-requests/[id]/+page.server.ts', 'utf8');
		expect(portal).toMatch(/children > 0 && !rawChildPrice/);
		const mobile = readFileSync('src/routes/api/mobile/v1/quotations/+server.ts', 'utf8');
		expect(mobile).toMatch(/party\.children === 0 \|\| Boolean\(party\.childPrice\)/);
	});

	it('9: the public payload keeps exactly the three fields it always had', () => {
		const marketplace = readFileSync('src/lib/server/marketplace.ts', 'utf8');
		expect(marketplace).toMatch(/priceFrom: row\.tour\.priceFrom/);
		expect(marketplace).toMatch(/currency: row\.tour\.currency/);
		// Structured pricing stays internal to Connect in this phase.
		expect(marketplace).not.toMatch(/adultPrice: row\.tour\.adultPrice/);
		expect(marketplace).not.toMatch(/tourPriceTiers|tourPriceSeasons/);
	});

	it('tiered per-person pricing is still PER_PERSON, never PER_GROUP', () => {
		expect(SAVE).toMatch(/perGroup: false/);
		expect(SAVE).toMatch(/Calling\s+\*?\s*\/\/?\s*it PER_GROUP|it PER_GROUP would tell the marketplace/);
	});
});

describe('10: settled money is untouched by any of this', () => {
	it('acceptance still reads the frozen offer, not the new pricing tables', () => {
		const quotations = readFileSync('src/lib/server/quotations.ts', 'utf8');
		const accept = quotations.slice(quotations.indexOf('export async function acceptQuotation'));
		const body = accept.slice(0, accept.indexOf('\nexport '));
		expect(body).toMatch(/frozenOfferFor/);
		expect(body).not.toMatch(/tourPricingFor|saveTourPricing|lowestAdultPrice/);
	});
});
