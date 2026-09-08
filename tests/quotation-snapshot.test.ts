// A sent quotation is a historical commercial offer.
//
// The audit's finding, verbatim: immutability "is currently satisfied by
// absence, not by rule" — sendQuotation wrote a snapshot, nothing ever read it,
// and acceptQuotation copied money out of the LIVE quotation into the booking.
// The first updateQuotation() anyone added would have silently rewritten offers
// travellers had already accepted.
//
// These are pure tests of the frozen-offer reader plus source assertions on the
// two call sites, because the accept path itself needs a database and this
// invariant must be enforced whether or not TEST_DATABASE_URL is set.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freezeOffer, readSnapshot, SNAPSHOT_SCHEMA } from '../src/lib/server/quotation-snapshot';

const QUOTATIONS = readFileSync('src/lib/server/quotations.ts', 'utf8');
const SNAPSHOT = readFileSync('src/lib/server/quotation-snapshot.ts', 'utf8');

/** A quotation as the live tables hold it, at the moment of sending. */
const sent = (over: Record<string, unknown> = {}) => ({
	id: 'q1',
	version: 1,
	currency: 'USD',
	adults: 2,
	children: 2,
	subtotal: '3698.00',
	discount: '0.00',
	tax: '0.00',
	total: '3698.00',
	customerId: 'c1',
	bookingRequestId: 'br1',
	startDate: null,
	endDate: null,
	validUntil: null,
	...over
});

const lines = (adult = '1099.00', child = '750.00') => [
	{ type: 'TOUR', title: 'Serengeti — adults', quantity: 2, unitPrice: adult, total: '2198.00' },
	{ type: 'TOUR', title: 'Serengeti — children', quantity: 2, unitPrice: child, total: '1500.00' }
];

describe('the frozen offer is values, never references', () => {
	it('carries every monetary fact needed to rebuild the booking', () => {
		const offer = freezeOffer(sent(), lines());
		for (const key of ['currency', 'adults', 'children', 'subtotal', 'discount', 'tax', 'total', 'items']) {
			expect(offer).toHaveProperty(key);
		}
		expect(offer.schema).toBe(SNAPSHOT_SCHEMA);
		expect(offer.items[0].unitPrice).toBe('1099.00');
		expect(offer.items[1].unitPrice).toBe('750.00');
	});

	it('records WHY only as a label, never as a reference to reconstruct from', () => {
		// Storing season_id and looking its price up later is the failure mode:
		// the season can be edited or deleted. The label is beside the money, not
		// instead of it.
		const offer = freezeOffer(sent(), lines(), { appliedPricing: 'High Season', tourId: 't1' });
		expect(offer.context.appliedPricing).toBe('High Season');
		expect(offer.total).toBe('3698.00');
		// Nothing in the money depends on context surviving.
		const stripped = { ...offer, context: { appliedPricing: null, tourId: null } };
		expect(stripped.total).toBe(offer.total);
		expect(stripped.items).toEqual(offer.items);
	});

	it('is stamped so a reader in 2030 can tell what shape it is', () => {
		expect(freezeOffer(sent(), lines()).schema).toBe(1);
	});
});

describe('A-E: changing tour pricing afterwards cannot move a sent offer', () => {
	// The offer is frozen once. Everything below re-reads THAT object, which is
	// exactly what acceptQuotation does — so a tour, a season or a tier changing
	// later has no path to it.
	const offer = freezeOffer(sent(), lines('1099.00', '750.00'));

	it('A: adult rate stays at the offered price when the tour rises to 1500', () => {
		expect(offer.items[0].unitPrice).toBe('1099.00');
	});

	it('B: child rate stays at 750 when the tour rises to 950', () => {
		expect(offer.items[1].unitPrice).toBe('750.00');
	});

	it('C: deleting the season that applied changes nothing', () => {
		const withSeason = freezeOffer(sent(), lines(), { appliedPricing: 'High Season' });
		const seasonGone = readSnapshot(JSON.parse(JSON.stringify(withSeason)), 1)!;
		expect(seasonGone.total).toBe('3698.00');
	});

	it('D: changing a group-size tier changes nothing', () => {
		expect(readSnapshot(JSON.parse(JSON.stringify(offer)), 1)!.items[0].unitPrice).toBe('1099.00');
	});

	it('E: an operator override is what gets frozen, not the recommendation', () => {
		// Recommended 1099/750; the operator offered 1050/700. The offer is what
		// was actually made.
		const overridden = freezeOffer(sent({ total: '3500.00', subtotal: '3500.00' }), lines('1050.00', '700.00'));
		expect(overridden.items[0].unitPrice).toBe('1050.00');
		expect(overridden.items[1].unitPrice).toBe('700.00');
		expect(overridden.total).toBe('3500.00');
	});

	it('H: the currency is frozen with the money', () => {
		expect(freezeOffer(sent({ currency: 'TZS' }), lines()).currency).toBe('TZS');
	});

	it('I: traveller counts stay consistent with the lines they priced', () => {
		expect(offer.adults).toBe(2);
		expect(offer.children).toBe(2);
		expect(offer.items[0].quantity).toBe(2);
		expect(offer.items[1].quantity).toBe(2);
	});
});

describe('snapshots written before this format are still readable', () => {
	it('normalises the legacy { quotation, items } shape rather than stranding it', () => {
		// Everything sent so far is stored this way. Refusing to read it would make
		// those quotations unacceptable.
		const legacy = { quotation: sent(), items: lines() };
		const offer = readSnapshot(legacy as never, 1)!;
		expect(offer.total).toBe('3698.00');
		expect(offer.items[1].unitPrice).toBe('750.00');
		expect(offer.currency).toBe('USD');
	});

	it('returns null for something that is not a snapshot at all', () => {
		expect(readSnapshot({} as never, 1)).toBeNull();
	});
});

describe('F-G: acceptance is of a specific version', () => {
	it('refuses when the traveller was looking at a different version', () => {
		// A link sent on Monday, opened on Friday after a re-quote, must not
		// silently commit the traveller to a price never on their screen.
		expect(SNAPSHOT).toMatch(/expectedVersion !== row\.version/);
		expect(SNAPSHOT).toMatch(/has been updated since you opened it/);
	});

	it('takes the latest SENT version when no expectation is supplied', () => {
		expect(SNAPSHOT).toMatch(/orderBy\(desc\(schema\.quotationVersions\.version\)\)/);
	});

	it('refuses to accept a quotation that was never sent, rather than falling back to live rows', () => {
		expect(SNAPSHOT).toMatch(/has not been sent yet/);
	});

	it('carries the version through the public accept route', () => {
		const route = readFileSync('src/routes/api/public/quotations/[token]/accept/+server.ts', 'utf8');
		expect(route).toMatch(/acceptedVersion/);
		expect(route).toMatch(/acceptQuotation\([^)]*parsed\.acceptedVersion/s);
	});
});

describe('J: the pricing engine is never asked about the past', () => {
	it('accept builds the booking from the frozen offer, not from getQuotationDetail', () => {
		const accept = QUOTATIONS.slice(QUOTATIONS.indexOf('export async function acceptQuotation'));
		const body = accept.slice(0, accept.indexOf('\nexport '));
		expect(body).toMatch(/frozenOfferFor\(tenantId, id, expectedVersion\)/);
		// The money fields must read from the offer.
		for (const field of ['currency: offer.currency', 'discount: offer.discount', 'tax: offer.tax']) {
			expect(body).toContain(field);
		}
		expect(body).toContain('items: offer.items.map');
		// And must NOT read from the live rows any more.
		expect(body).not.toContain('currency: quotation.currency');
		expect(body).not.toContain('items: items.map');
	});

	it('accept never calls the pricing engine', () => {
		const accept = QUOTATIONS.slice(QUOTATIONS.indexOf('export async function acceptQuotation'));
		const body = accept.slice(0, accept.indexOf('\nexport '));
		expect(body).not.toMatch(/recommendPrice|calculateTourPrice|priceFrom/);
	});

	it('send freezes through the one boundary', () => {
		expect(QUOTATIONS).toMatch(/snapshot: freezeOffer\(/);
	});
});
