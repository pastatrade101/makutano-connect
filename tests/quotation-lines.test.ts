import { describe, expect, it } from 'vitest';
import { normalisePrice, quotationLines, quotationLinesTotal } from '../src/lib/quotation-lines';

describe('quotationLines', () => {
	it('quotes a per-group tour once, whatever the party size', () => {
		const lines = quotationLines({
			title: 'Private Serengeti charter',
			perGroup: true,
			adults: 4,
			children: 2,
			adultPrice: '9000'
		});
		expect(lines).toHaveLength(1);
		expect(lines[0].quantity).toBe(1);
		// The bug this guards: 6 × 9000 = 54,000 for a 9,000 trip.
		expect(quotationLinesTotal(lines)).toBe('9000.00');
	});

	it('keeps one line when nobody is a child', () => {
		const lines = quotationLines({ title: 'Northern Circuit', adults: 3, children: 0, adultPrice: '2950' });
		expect(lines).toHaveLength(1);
		expect(lines[0].title).toBe('Northern Circuit');
		expect(lines[0].quantity).toBe(3);
		expect(quotationLinesTotal(lines)).toBe('8850.00');
	});

	it('splits adults and children onto their own lines', () => {
		const lines = quotationLines({
			title: 'Northern Circuit',
			adults: 2,
			children: 2,
			adultPrice: '2950',
			childPrice: '1475'
		});
		expect(lines.map((l) => [l.title, l.quantity, l.unitPrice])).toEqual([
			['Northern Circuit — adults', 2, '2950.00'],
			['Northern Circuit — children', 2, '1475.00']
		]);
		expect(quotationLinesTotal(lines)).toBe('8850.00');
	});

	it('never invents a child discount', () => {
		const lines = quotationLines({ title: 'Trip', adults: 1, children: 1, adultPrice: '2000' });
		expect(lines[1].unitPrice).toBe('2000.00');
	});

	it('lets a child be free without dropping the line', () => {
		const lines = quotationLines({ title: 'Trip', adults: 2, children: 1, adultPrice: '2000', childPrice: '0' });
		expect(lines).toHaveLength(2);
		expect(lines[1].unitPrice).toBe('0.00');
		expect(quotationLinesTotal(lines)).toBe('4000.00');
	});

	it('quotes a children-only party without an empty adult line', () => {
		const lines = quotationLines({ title: 'Trip', adults: 0, children: 2, adultPrice: '900' });
		expect(lines).toHaveLength(1);
		expect(lines[0].title).toBe('Trip — children');
		expect(quotationLinesTotal(lines)).toBe('1800.00');
	});

	it('puts what is included on the first line only', () => {
		const lines = quotationLines({
			title: 'Trip',
			included: 'Park fees, lodging',
			adults: 2,
			children: 1,
			adultPrice: '100'
		});
		expect(lines[0].description).toBe('Park fees, lodging');
		expect(lines[1].description).toBeNull();
	});

	it('reads the prices people actually type', () => {
		expect(normalisePrice('2,950')).toBe('2950.00');
		expect(normalisePrice('2 950.5')).toBe('2950.50');
		expect(normalisePrice('')).toBe('');
		expect(normalisePrice('abc')).toBe('');
	});
});
