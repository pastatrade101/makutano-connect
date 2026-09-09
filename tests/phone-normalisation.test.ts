// Where a dial code may be added, and where it must never be.
//
// A traveller's number was re-expanded with the TENANT's dial code at SEND time. The
// number was already canonical, so the expansion did not fail loudly — it produced a
// real, different, Tanzanian number, and the quotation went there carrying a live
// accept link that books at that price.
import { describe, expect, it } from 'vitest';
import { normalizePhone, toE164Digits } from '../src/lib/server/phone';

describe('capture time — a country is known, so a national number may be promoted', () => {
	it('expands a leading zero using the country given', () => {
		expect(normalizePhone('0712345678', 'TZ')).toBe('255712345678');
		expect(normalizePhone('0712 345 678', 'TZ')).toBe('255712345678');
	});

	it('leaves an already-international number alone', () => {
		expect(normalizePhone('+255712345678', 'TZ')).toBe('255712345678');
		expect(normalizePhone('+447700900123', 'TZ')).toBe('447700900123');
	});

	it('returns null for nothing usable', () => {
		expect(normalizePhone('', 'TZ')).toBeNull();
		expect(normalizePhone(null, 'TZ')).toBeNull();
	});

	it('KNOWN GAP: a fragment shorter than 10 digits is given the dial code anyway', () => {
		// Pinned as current behaviour, NOT endorsed. The `digits.length <= 9` branch
		// cannot tell a national number from a typo, so half a number becomes a real,
		// short Tanzanian one. Out of scope here — changing it alters how every form
		// stores numbers — but recorded so the next person meets it as a decision
		// rather than a surprise.
		expect(normalizePhone('12345', 'TZ')).toBe('25512345');
	});
});

describe("send time — the only country in scope is the tenant's, so none may be applied", () => {
	it('sends a canonical number to exactly the same destination', () => {
		// The regression: same in, same out, no second country code.
		expect(toE164Digits('255712345678')).toBe('255712345678');
		expect(toE164Digits('+255712345678')).toBe('255712345678');
		expect(toE164Digits('447700900123')).toBe('447700900123');
	});

	it('never prefixes a short foreign number with the tenant dial code', () => {
		// The exact shape that broke: <= 9 digits, not starting with 255. Capture-time
		// normalisation with a Tanzanian tenant turns this into a real TZ number...
		expect(normalizePhone('61234567', 'TZ')).toBe('25561234567');
		// ...and send-time must not, because by then it is somebody's stored number.
		expect(toE164Digits('61234567')).toBe('61234567');
	});

	it('is idempotent — normalising an already-normalised number changes nothing', () => {
		const once = toE164Digits('+255752093014')!;
		expect(toE164Digits(once)).toBe(once);
		expect(toE164Digits(toE164Digits(once))).toBe(once);
	});

	it('still refuses lengths that cannot be a phone number', () => {
		expect(toE164Digits('12345')).toBeNull();
		expect(toE164Digits('1234567890123456')).toBeNull();
		expect(toE164Digits('')).toBeNull();
	});
});
