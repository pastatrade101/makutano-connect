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

/** Display helper — never used for matching. */
export function formatPhone(e164: string | null | undefined): string {
	if (!e164) return '';
	return `+${e164}`;
}

export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	return normalizePhone(a) === normalizePhone(b);
}
