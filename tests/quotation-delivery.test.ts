import { describe, expect, it } from 'vitest';
import { freezeOffer, readSnapshot, SNAPSHOT_SCHEMA } from '../src/lib/server/quotation-snapshot';
import { quotationEmail } from '../src/lib/server/email';

/**
 * The quotation flow's honesty rules.
 *
 * Three separate lies were possible before these held:
 *   - the operator was told a quote had been delivered when nothing left the building,
 *   - the words that went out beside the money were not frozen with it,
 *   - a child line printed an amount with no rate beside it.
 *
 * None of these is a pricing bug, which is why none of them was caught by the pricing
 * tests. They are all "what did we actually tell someone" bugs.
 */

/* ------------------------------------------------------------ snapshot --- */

const quotationRow = (over: Record<string, unknown> = {}) => ({
	version: 1,
	currency: 'USD',
	adults: 2,
	children: 1,
	subtotal: '6875.00',
	discount: '0.00',
	tax: '0.00',
	total: '6875.00',
	startDate: new Date('2026-08-15T00:00:00Z'),
	endDate: new Date('2026-08-17T00:00:00Z'),
	validUntil: new Date('2026-10-09T00:00:00Z'),
	customerId: 'c1',
	bookingRequestId: 'br1',
	notes: 'Karibu! 30% deposit confirms the booking.',
	terms: 'Balance due 30 days before arrival.',
	...over
});

const items = [
	{ type: 'TOUR', title: 'Serengeti — adults', quantity: 2, unitPrice: '2500.00', total: '5000.00' },
	{ type: 'TOUR', title: 'Serengeti — children', quantity: 1, unitPrice: '1875.00', total: '1875.00' }
];

describe('the frozen offer', () => {
	it('freezes the words that went out beside the money', () => {
		const offer = freezeOffer(quotationRow(), items);
		// The traveller's page renders both, so both are part of the offer. Leaving them
		// out let the live columns be rewritten under an accepted quote.
		expect(offer.notes).toBe('Karibu! 30% deposit confirms the booking.');
		expect(offer.terms).toBe('Balance due 30 days before arrival.');
	});

	it('carries pricing provenance without ever depending on it', () => {
		const offer = freezeOffer(quotationRow(), items, {
			tourId: 'tour-1',
			appliedPricing: 'High Season'
		});
		expect(offer.context).toEqual({ tourId: 'tour-1', appliedPricing: 'High Season' });
		// Provenance is a label beside the money, never a source for it: every figure is
		// still a literal on the snapshot.
		expect(offer.total).toBe('6875.00');
		expect(offer.items[1].unitPrice).toBe('1875.00');
	});

	it('stamps the current schema version', () => {
		expect(freezeOffer(quotationRow(), items).schema).toBe(SNAPSHOT_SCHEMA);
	});

	it('reads a schema-1 snapshot back with the new keys normalised, not undefined', () => {
		// Rows written before notes/terms existed are still valid records. A reader must
		// see one shape, so absence becomes null rather than undefined.
		const legacy = { ...freezeOffer(quotationRow(), items), schema: 1 } as Record<string, unknown>;
		delete legacy.notes;
		delete legacy.terms;
		const read = readSnapshot(legacy, 1);
		expect(read).not.toBeNull();
		expect(read!.notes).toBeNull();
		expect(read!.terms).toBeNull();
		expect(read!.total).toBe('6875.00');
	});

	it('still reads the pre-format snapshots that hold whole live objects', () => {
		const ancient = { quotation: quotationRow({ sentAt: new Date('2026-09-09T10:00:00Z') }), items };
		const read = readSnapshot(ancient as unknown as Record<string, unknown>, 1);
		expect(read?.total).toBe('6875.00');
		expect(read?.items).toHaveLength(2);
	});
});

/* --------------------------------------------------------------- email --- */

describe('the quotation email', () => {
	const build = (over: Record<string, unknown> = {}) =>
		quotationEmail({
			operator: { name: 'Makutano Digital', logoUrl: null, location: 'Arusha', verified: true },
			customerFirstName: 'Pastory',
			reference: 'MAK-QT-2026-00005',
			currency: 'USD',
			total: '6875.00',
			items: items.map((i) => ({
				title: i.title,
				quantity: i.quantity,
				unitPrice: i.unitPrice,
				total: i.total
			})),
			notes: 'Karibu!',
			terms: 'Balance due 30 days before arrival.',
			validUntil: new Date('2026-10-09T00:00:00Z'),
			startDate: new Date('2026-08-15T00:00:00Z'),
			endDate: new Date('2026-08-17T00:00:00Z'),
			adults: 2,
			children: 1,
			url: 'https://journeys.example/quotes/tok',
			...over
		});

	it('shows a quantity on every line, including one', () => {
		const { html, text } = build();
		// A bare "USD 1,875.00" on the child line read as a figure with no rate behind
		// it, right next to "2 × USD 2,500.00" for the adults.
		expect(html).toContain('1 × USD 1875.00');
		expect(html).toContain('2 × USD 2500.00');
		expect(text).toContain('1 × USD 1875.00');
	});

	it('states the trip window and the party, not just a price', () => {
		const { html, text } = build();
		expect(html).toContain('15 August 2026');
		expect(html).toContain('17 August 2026');
		expect(html).toContain('2 adults');
		expect(html).toContain('1 child');
		expect(text).toContain('Travel dates: 15 August 2026 – 17 August 2026');
	});

	it('carries the expiry and the payment terms', () => {
		const { html, text } = build();
		expect(html).toContain('This price holds until 9 October 2026');
		expect(html).toContain('Balance due 30 days before arrival.');
		expect(text).toContain('Balance due 30 days before arrival.');
	});

	it('says one child, not one children', () => {
		expect(build({ children: 1 }).html).toContain('1 child');
		expect(build({ children: 3 }).html).toContain('3 children');
		expect(build({ adults: 1 }).html).toContain('1 adult');
	});

	it('omits the trip window entirely when the traveller gave no dates', () => {
		// Never invent a date the traveller did not supply.
		const { html } = build({ startDate: null, endDate: null });
		expect(html).not.toContain('Travel dates');
	});
});
