/**
 * The closed vocabularies a tour listing is built from.
 *
 * These live outside `server/` because the composer, the admin review screen and
 * the validator all have to agree on them. When the list only existed in the
 * markup, the server accepted anything: `currency` was checked against
 * /^[A-Z]{3}$/, so "ABC" was a currency, and `group_type` was checked against
 * nothing at all — while the marketplace built its "group type" filter from
 * `distinct(groupType)`. Every operator typing their own wording ("Private",
 * "private tour", "Privé") silently became another filter option matching one
 * listing. A closed list is the fix, and the place to keep it is one file.
 */

export type Currency = { code: string; label: string; symbol: string };

/**
 * What an operator may price in.
 *
 * Deliberately short: these are the currencies a Tanzanian operator actually
 * invoices in. Adding one is a decision about what the marketplace supports, not
 * a thing an operator should be able to do by typing.
 */
export const CURRENCIES: readonly Currency[] = [
	{ code: 'USD', label: 'US dollar', symbol: '$' },
	{ code: 'TZS', label: 'Tanzanian shilling', symbol: 'TSh' },
	{ code: 'EUR', label: 'Euro', symbol: '€' },
	{ code: 'GBP', label: 'Pound sterling', symbol: '£' },
	{ code: 'KES', label: 'Kenyan shilling', symbol: 'KSh' }
];

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code);

export const isCurrency = (v: string | null | undefined): boolean =>
	!!v && CURRENCY_CODES.includes(v.trim().toUpperCase());

export const currencyLabel = (code: string | null | undefined): string => {
	const found = CURRENCIES.find((c) => c.code === code?.toUpperCase());
	return found ? `${found.code} · ${found.label}` : (code ?? '');
};

export type GroupTypeOption = { value: string; label: string; hint: string };

/**
 * Who else is on the trip.
 *
 * Stored as a code and rendered through `groupTypeLabel`, the same way pricing
 * type and availability already work — so the wording can be improved later
 * without a migration, and two operators describing the same thing land on the
 * same filter.
 */
export const GROUP_TYPES: readonly GroupTypeOption[] = [
	{ value: 'PRIVATE', label: 'Private tour', hint: 'Only the people who book together.' },
	{ value: 'SMALL_GROUP', label: 'Small group', hint: 'Strangers travel together, up to about twelve.' },
	{ value: 'GROUP', label: 'Group tour', hint: 'A larger scheduled departure.' },
	{ value: 'FAMILY', label: 'Family trip', hint: 'Built around travelling with children.' },
	{ value: 'SOLO_FRIENDLY', label: 'Solo traveller', hint: 'Designed for one person travelling alone.' }
];

export const GROUP_TYPE_VALUES: readonly string[] = GROUP_TYPES.map((g) => g.value);

export const groupTypeLabel = (value: string | null | undefined): string =>
	GROUP_TYPES.find((g) => g.value === value)?.label ?? value ?? '';

/** What a price means. Already a closed list server-side; named here so the UI shares it. */
export const PRICING_TYPE_OPTIONS: readonly GroupTypeOption[] = [
	{ value: 'PER_PERSON', label: 'Per person', hint: 'The usual choice — the price one traveller pays.' },
	{ value: 'PER_GROUP', label: 'Per group', hint: 'One price for the whole booking.' },
	{ value: 'FROM', label: 'Starting from', hint: 'A floor price that varies by season or size.' }
];

export const pricingTypeLabel = (value: string | null | undefined): string =>
	PRICING_TYPE_OPTIONS.find((p) => p.value === value)?.label ?? value ?? '';
