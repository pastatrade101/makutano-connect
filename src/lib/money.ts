/**
 * Exact money arithmetic.
 *
 * Every money column in this database is numeric(14,2), which postgres-js hands
 * back as a STRING — so the values arriving here are exact. What was not exact
 * was what happened next: quotations.ts multiplied with `Number(unitPrice) *
 * quantity` and quotation-lines.ts summed with `+`, both IEEE-754. At the sizes
 * this catalogue trades in ($604 to $8,200) a double holds every cent, so
 * nothing has gone visibly wrong yet — but 0.1 + 0.2 is not 0.3 in binary
 * floating point, and a rounding that lands a cent out on a five-figure safari
 * is the kind of bug an operator reports as "your maths is wrong" and nobody
 * can reproduce.
 *
 * So: parse to integer MINOR UNITS once, do all arithmetic in integers, and
 * format back at the boundary. No third-party decimal library, because the only
 * operations pricing needs are add, multiply-by-a-count and compare — and a
 * dependency that has to be kept in step across three repositories is a larger
 * liability than forty lines.
 *
 * Minor units are cents here because every currency in CURRENCIES has two
 * decimal places. A zero-decimal currency (JPY) would need this revisited, and
 * the parser would reject its whole-number input today rather than silently
 * dividing by a hundred.
 */

/** A money amount as an exact integer count of minor units (cents). */
export type Minor = number;

/** Digits with at most two decimals — the shape numeric(14,2) accepts. */
export const isAmount = (value: string): boolean => /^-?\d+(\.\d{1,2})?$/.test(value.trim());

/**
 * "1,200", "1 200" and "1200.5" are all how people type twelve hundred.
 *
 * Returns null rather than 0 for anything unparseable, because a price the
 * operator fat-fingered must not silently become free.
 */
export function toMinor(value: string | number | null | undefined): Minor | null {
	if (value === null || value === undefined) return null;
	const cleaned = String(value).replace(/[,\s]/g, '').trim();
	if (cleaned === '' || !isAmount(cleaned)) return null;
	const negative = cleaned.startsWith('-');
	const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
	// Pad rather than parse: "1.5" is 150 cents, not 15.
	const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	return negative ? -cents : cents;
}

/** Back to the string form the database and the API speak. */
export function toAmount(minor: Minor): string {
	const negative = minor < 0;
	const abs = Math.abs(Math.round(minor));
	return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A price multiplied by a whole number of travellers. Exact by construction. */
export const times = (minor: Minor, count: number): Minor => minor * Math.max(0, Math.trunc(count));

/** Sum, in minor units. */
export const sum = (values: Minor[]): Minor => values.reduce((total, v) => total + v, 0);

/** Parse, operate, format — for callers that only hold strings. */
export function multiplyAmount(amount: string, count: number): string | null {
	const minor = toMinor(amount);
	return minor === null ? null : toAmount(times(minor, count));
}

export function sumAmounts(amounts: string[]): string | null {
	const parsed = amounts.map(toMinor);
	if (parsed.some((v) => v === null)) return null;
	return toAmount(sum(parsed as Minor[]));
}
