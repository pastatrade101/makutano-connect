// The quotation UI has to USE the pricing, on both surfaces.
//
// The engine resolving a child rate is worth nothing if the composer still opens
// both boxes at the adult price — which is exactly what both surfaces did, and
// what these assertions stop returning.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveRates } from '../src/lib/pricing';

const PORTAL = readFileSync('src/routes/app/booking-requests/[id]/+page.svelte', 'utf8');
const SHEET = readFileSync('../makutano-connect-mobile/lib/screens/quotation_sheet.dart', 'utf8');
const DRAFT = readFileSync('src/lib/server/quotations.ts', 'utf8');

describe('the server hands both surfaces the same recommendation', () => {
	it('draftQuotationFor asks the engine and reports which rule applied', () => {
		expect(DRAFT).toMatch(/recommendPrice\(tenantId, row\.request\.tourId/);
		for (const field of ['adultPrice', 'childPrice', 'childRateMissing', 'applied']) {
			expect(DRAFT).toContain(field);
		}
	});

	it('the phone reads the same draft endpoint, so the two cannot disagree', () => {
		const route = readFileSync('src/routes/api/mobile/v1/enquiries/[id]/quotation-draft/+server.ts', 'utf8');
		expect(route).toMatch(/draftQuotationFor\(viewer\.tenantId/);
	});
});

describe('neither surface opens a child box at the adult rate', () => {
	it('the portal seeds each box from its own recommended rate', () => {
		expect(PORTAL).toMatch(/adultPrice = rec\?\.adultPrice/);
		// Blank when the tour publishes no child rate — asked, not assumed.
		expect(PORTAL).toMatch(/childPrice = rec\?\.childRateMissing \? '' :/);
	});

	it('the portal stops mirroring adult into child once a real child rate exists', () => {
		expect(PORTAL).toMatch(/!childPriceEdited && !recommended\?\.childPrice/);
	});

	it('the phone seeds each box from its own recommended rate', () => {
		expect(SHEET).toMatch(/_adultPrice\.text = recAdult != null/);
		// Blank unless the tour's own price book supplied a figure.
		expect(SHEET).toMatch(/_childFromPricing = !childMissing/);
		expect(SHEET).toMatch(/_childPrice\.text = _childFromPricing \?/);
	});

	it('the phone stops mirroring adult into child once a real child rate exists', () => {
		/*
		 * The portal got this guard when the pre-fill was written and the phone did
		 * not, so on the phone an operator adjusting the adult figure dragged the
		 * published child rate up with it — undoing the whole feature, on the
		 * surface most likely to be used in the field. Both surfaces now refuse.
		 */
		// Written loosely across newlines: dart format wraps this call.
		expect(SHEET).toMatch(
			/childFollowsAdult\(\s*childPriceEdited: _childPriceEdited,\s*childFromPricing: _childFromPricing,?\s*\)/
		);
	});

	it('the phone never substitutes a zero for a child rate nobody named', () => {
		// "0.00" also satisfies the server's own guard, so a free child would have
		// reached the traveller with nothing anywhere to catch it.
		expect(SHEET).not.toMatch(/_childRate\.isEmpty \? '0\.00'/);
		expect(SHEET).toMatch(/_childPriceToSend/);
	});

	it('neither surface seeds both boxes from one published figure any more', () => {
		expect(PORTAL).not.toMatch(/adultPrice = opening;\s*\n\s*childPrice = opening;/);
		expect(SHEET).not.toMatch(/_adultPrice\.text = opening;\s*\n\s*_childPrice\.text = opening;/);
	});
});

describe('both surfaces say what was applied, and when a child rate is missing', () => {
	it('the portal shows the rule and the warning', () => {
		expect(PORTAL).toContain('Tour pricing');
		expect(PORTAL).toMatch(/recommended\.applied/);
		expect(PORTAL).toMatch(/Child price required/);
	});

	it('the phone shows the rule and the warning', () => {
		expect(SHEET).toContain('Tour pricing');
		expect(SHEET).toMatch(/_recommended!\['applied'\]/);
		expect(SHEET).toMatch(/Child price required/);
	});

	it('the recommendation is presented apart from the editable boxes', () => {
		// Tour price is the default; quotation price is the offer. An operator
		// overriding one must not think they are editing the tour.
		expect(PORTAL).toMatch(/recommendation, those are the offer/);
		expect(SHEET).toMatch(/this is the recommendation, those are the offer/);
	});
});

/*
 * A season is matched on a CALENDAR DAY.
 *
 * booking_requests.start_date is a timestamptz, so drizzle returns a Date and
 * String() on it gives "Thu Dec 24 2026 00:00:00 GMT+0300". The engine tests the
 * value with a YYYY-MM-DD regex and, finding none, treats the request as having
 * no date at all — so it skips every season silently and quotes the group tier
 * instead. Nothing throws, nothing logs, and the phone prints the tier band as
 * though it were the whole answer.
 *
 * It has cost nothing so far only because no tour has a season row configured
 * (see the header of scripts/makutano-digital-listings.ts for why). The first
 * operator to add one would have had it ignored.
 */
describe('the recommendation is asked for a calendar day, not an instant', () => {
	it('draftQuotationFor converts the timestamp before it reaches the engine', () => {
		expect(DRAFT).toMatch(/travelDate: asDay\(row\.request\.startDate\)/);
		expect(DRAFT).not.toMatch(/travelDate: row\.request\.startDate \? String\(/);
	});

	it('asDay takes the UTC day off either shape it can be handed', () => {
		expect(DRAFT).toMatch(/value instanceof Date \? value\.toISOString\(\) : value\)\.slice\(0, 10\)/);
	});

	it('the engine really does refuse a stringified Date', () => {
		// The guard this exists to satisfy, exercised rather than asserted about.
		const season = {
			name: 'Festive',
			startsOn: '2026-12-20',
			endsOn: '2027-01-05',
			adult: '5000.00',
			child: '3500.00'
		};
		const pricing = {
			currency: 'USD',
			perGroup: false,
			base: { adult: '1000.00', child: '700.00' },
			tiers: [],
			seasons: [season]
		};
		const request = { adults: 2, children: 0 };
		const asString = String(new Date('2026-12-24T00:00:00.000Z'));
		expect(resolveRates(pricing, { ...request, travelDate: asString }).season).toBeNull();
		expect(resolveRates(pricing, { ...request, travelDate: '2026-12-24' }).season).toEqual(season);
	});
});
