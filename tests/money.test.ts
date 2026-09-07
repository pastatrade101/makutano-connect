// Money, in integers.
//
// The code this replaces multiplied with Number() and summed with +. At this
// catalogue's sizes a double holds every cent, so nothing had visibly broken —
// which is exactly why it needed a test rather than a bug report.
import { describe, expect, it } from 'vitest';
import { isAmount, multiplyAmount, sumAmounts, toAmount, toMinor } from '../src/lib/money';

describe('parsing what people actually type', () => {
	it('reads plain, grouped and spaced amounts the same way', () => {
		for (const raw of ['1200', '1200.00', '1,200', '1 200', '1,200.00']) {
			expect(toMinor(raw)).toBe(120000);
		}
	});

	it('pads a single decimal rather than reading it as cents', () => {
		// "1.5" is a pound fifty, not one pound five.
		expect(toMinor('1.5')).toBe(150);
		expect(toMinor('1.05')).toBe(105);
	});

	it('refuses what it cannot read instead of calling it zero', () => {
		// A fat-fingered price must not silently become free.
		for (const raw of ['', '  ', 'abc', '1.234', '1..2', '$100', '1e3']) {
			expect(toMinor(raw)).toBeNull();
		}
		expect(toMinor(null)).toBeNull();
		expect(toMinor(undefined)).toBeNull();
	});

	it('round-trips every amount it accepts', () => {
		for (const raw of ['0.00', '0.01', '604.00', '1099.50', '8200.00', '99999999999.99']) {
			expect(toAmount(toMinor(raw)!)).toBe(raw);
		}
	});
});

describe('arithmetic is exact, which floating point is not', () => {
	it('sums the classic case a double gets wrong', () => {
		// 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
		expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
	});

	it('multiplies a rate by a party without drift', () => {
		expect(multiplyAmount('1099.99', 7)).toBe('7699.93');
		expect(multiplyAmount('0.10', 3)).toBe('0.30');
	});

	it('holds a real safari total to the cent', () => {
		// 2 adults at 1099.50 and 2 children at 750.25.
		const adults = multiplyAmount('1099.50', 2)!;
		const children = multiplyAmount('750.25', 2)!;
		expect(sumAmounts([adults, children])).toBe('3699.50');
	});

	it('treats a count of zero and a negative count as none', () => {
		expect(multiplyAmount('1099.00', 0)).toBe('0.00');
		expect(multiplyAmount('1099.00', -3)).toBe('0.00');
	});

	it('refuses a sum containing anything unreadable', () => {
		expect(sumAmounts(['1.00', 'oops'])).toBeNull();
	});

	it('agrees with isAmount about what numeric(14,2) accepts', () => {
		expect(isAmount('1099.00')).toBe(true);
		expect(isAmount('1099.000')).toBe(false);
	});
});
