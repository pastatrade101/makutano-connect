// Phone normalization (§10). Incoming WhatsApp identifiers arrive as E.164 digits
// without a '+', so that is the canonical storage form: everything is reduced to
// digits, and a national number is promoted using the tenant's country dial code.
const DIAL_CODES: Record<string, string> = {
	TZ: '255',
	KE: '254',
	UG: '256',
	RW: '250',
	BI: '257',
	ZM: '260',
	MW: '265',
	MZ: '258',
	ZA: '27',
	NG: '234',
	GH: '233',
	ET: '251',
	US: '1',
	GB: '44',
	DE: '49',
	FR: '33',
	IT: '39',
	ES: '34',
	NL: '31',
	IN: '91',
	CN: '86',
	AE: '971'
};

/**
 * @param raw       anything a form or Meta may hand us
 * @param country   ISO-3166 alpha-2, used only to expand a leading 0
 * @returns E.164 digits with no '+', or null when nothing usable remains
 *
 * KNOWN GAP, recorded deliberately rather than patched.
 *
 * The `digits.length <= 9` branch below cannot tell a national number from a typo, so
 * normalizePhone('12345', 'TZ') returns '25512345' — a fragment becomes an apparently
 * valid E.164 destination, and something will eventually try to message it. Pinned by
 * tests/phone-normalisation.test.ts so it is met as a decision, not a surprise.
 *
 * The fix is NOT another prefix rule. It needs real validation — per-country length and
 * prefix rules, or a library — and a decision about what to do with a number that fails
 * it, since rejecting at capture time means refusing an enquiry over a mistyped phone.
 * That is its own piece of work; see the send-time fix in toE164Digits below, which is
 * the separate and narrower half.
 */
export function normalizePhone(raw: string | null | undefined, country?: string | null): string | null {
	if (!raw) return null;
	let digits = String(raw).replace(/[^\d+]/g, '');
	if (digits.startsWith('+')) digits = digits.slice(1);
	digits = digits.replace(/\D/g, '');
	if (!digits) return null;

	const dial = country ? DIAL_CODES[country.toUpperCase()] : undefined;
	if (dial) {
		// Local format: 0712345678 → 255712345678
		if (digits.startsWith('0')) digits = dial + digits.slice(1);
		// Bare national number of plausible length gets the dial code too.
		else if (!digits.startsWith(dial) && digits.length <= 9) digits = dial + digits;
	}
	if (digits.length < 7 || digits.length > 15) return null;
	return digits;
}

/**
 * Reduce an ALREADY-CANONICAL number to E.164 digits, without inventing a country.
 *
 * normalizePhone() promotes a national number using a country's dial code, which is
 * correct at CAPTURE time — someone typing 0712345678 into a Tanzanian operator's form
 * means +255712345678. It is wrong at SEND time, where the stored value is already
 * canonical and the only country in scope is the TENANT's, not the traveller's: a short
 * foreign number that does not begin with the tenant's dial code was silently given one,
 * turning it into a real and different Tanzanian number — and the quotation, carrying a
 * live accept link, was delivered to whoever owns it.
 *
 * So: strip to digits, never prefix.
 */
export function toE164Digits(raw: string | null | undefined): string | null {
	if (!raw) return null;
	let digits = String(raw).replace(/[^\d+]/g, '');
	if (digits.startsWith('+')) digits = digits.slice(1);
	digits = digits.replace(/\D/g, '');
	if (!digits) return null;
	if (digits.length < 7 || digits.length > 15) return null;
	return digits;
}

/** Display helper — never used for matching. */
export function formatPhone(e164: string | null | undefined): string {
	if (!e164) return '';
	return `+${e164}`;
}

export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	return normalizePhone(a) === normalizePhone(b);
}
