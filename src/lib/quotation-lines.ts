/**
 * Turning a party and a price into quotation lines.
 *
 * This is the money rule, and it lives in ONE place because it is applied on
 * two surfaces. The phone and the portal both let an operator confirm how many
 * adults and children are travelling and what each is charged; if each built
 * its own lines, the same enquiry would eventually produce two different
 * quotations depending on which screen the operator happened to be on.
 *
 * Three rules, all of them things that cost real money when they go wrong:
 *
 *  1. A PER_GROUP tour is quoted once. Multiplying a group price by the party
 *     size quotes a family of four at four times the real trip.
 *  2. Children are counted and priced separately. Folding them into the adult
 *     count charges a child the adult rate.
 *  3. The child rate is never invented. No tour in this catalogue publishes
 *     one, so it defaults to the adult rate and only the operator moves it.
 */
export type QuotationLineInput = {
	title: string;
	/** Shown to the traveller under the first line. */
	included?: string | null;
	perGroup?: boolean;
	adults: number;
	children: number;
	adultPrice: string;
	childPrice?: string | null;
};

export type QuotationLine = {
	title: string;
	description: string | null;
	quantity: number;
	unitPrice: string;
};

/** Digits and at most two decimals — the shape the quotation service accepts. */
export const isPrice = (value: string): boolean => /^\d+(\.\d{1,2})?$/.test(value);

/** "1,200" and "1 200" are how people type; both mean 1200.00. */
export const normalisePrice = (raw: string): string => {
	const cleaned = String(raw ?? '').replace(/[,\s]/g, '').trim();
	const value = Number(cleaned);
	return cleaned !== '' && Number.isFinite(value) && value >= 0 ? value.toFixed(2) : '';
};

export function quotationLines(input: QuotationLineInput): QuotationLine[] {
	const description = input.included?.trim() ? input.included.trim() : null;
	const adultPrice = normalisePrice(input.adultPrice) || '0.00';
	const childPrice = normalisePrice(input.childPrice ?? '') || adultPrice;
	const adults = Math.max(0, Math.trunc(input.adults));
	const children = Math.max(0, Math.trunc(input.children));

	// Rule 1: the group price is the whole trip.
	if (input.perGroup) {
		return [{ title: input.title, description, quantity: 1, unitPrice: adultPrice }];
	}

	// No children: one line, and no need to say "adults" on it.
	if (children === 0) {
		return [{ title: input.title, description, quantity: Math.max(1, adults), unitPrice: adultPrice }];
	}

	// Rules 2 and 3: two lines, so the traveller can see what each part of the
	// party costs and the booking this becomes carries the same breakdown.
	return [
		...(adults > 0
			? [{ title: `${input.title} — adults`, description, quantity: adults, unitPrice: adultPrice }]
			: []),
		{
			title: `${input.title} — children`,
			description: adults > 0 ? null : description,
			quantity: children,
			unitPrice: childPrice
		}
	];
}

/** What those lines add up to, before any discount or tax. */
export const quotationLinesTotal = (lines: QuotationLine[]): string =>
	lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0).toFixed(2);
