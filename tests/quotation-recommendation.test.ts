// The quotation UI has to USE the pricing, on both surfaces.
//
// The engine resolving a child rate is worth nothing if the composer still opens
// both boxes at the adult price — which is exactly what both surfaces did, and
// what these assertions stop returning.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PORTAL = readFileSync('src/routes/app/booking-requests/[id]/+page.svelte', 'utf8');
const SHEET = readFileSync(
	'../makutano-connect-mobile/lib/screens/quotation_sheet.dart',
	'utf8'
);
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
		expect(SHEET).toMatch(/_childPrice\.text = \(!childMissing/);
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
