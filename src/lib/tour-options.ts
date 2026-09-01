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

/**
 * Which meals a day includes.
 *
 * A closed set, because it is one: the column used to be free text and the live
 * data had already produced 'Dinner', 'All meals' and 'Breakfast, lunch' for the
 * same six days — three spellings that no filter, summary or translation can
 * read. Order matters and is the order of the day, not the alphabet.
 */
export const MEALS = [
	{ value: 'BREAKFAST', label: 'Breakfast' },
	{ value: 'LUNCH', label: 'Lunch' },
	{ value: 'DINNER', label: 'Dinner' }
] as const;

export type Meal = (typeof MEALS)[number]['value'];
export const MEAL_VALUES: readonly string[] = MEALS.map((m) => m.value);

/** Anything not in the vocabulary is dropped, and the order of the day is imposed. */
export const normaliseMeals = (values: readonly unknown[] | null | undefined): Meal[] => {
	const wanted = new Set((values ?? []).map((v) => String(v).trim().toUpperCase()));
	return MEALS.filter((m) => wanted.has(m.value)).map((m) => m.value);
};

/**
 * Read meals from whatever a caller sent: the closed set, or a sentence.
 *
 * The public v1 API has always taken `meals` as free text, and integrations that
 * send "Breakfast, lunch" must keep working — breaking them to tidy a column
 * would be making somebody else pay for our schema change. Text is parsed with
 * the same patterns the backfill migration used, so an old client and an old row
 * end up at the same answer.
 */
export function parseMeals(value: unknown): Meal[] {
	if (Array.isArray(value)) return normaliseMeals(value);
	const text = String(value ?? '').toLowerCase();
	if (!text.trim()) return [];
	const everything = /all meals|full board/.test(text);
	return normaliseMeals([
		everything || /breakfast/.test(text) || /half board/.test(text) ? 'BREAKFAST' : '',
		everything || /lunch/.test(text) ? 'LUNCH' : '',
		everything || /dinner|supper/.test(text) || /half board/.test(text) ? 'DINNER' : ''
	]);
}

/**
 * "Breakfast, lunch and dinner" — or "All meals" when it is all of them.
 *
 * Rendered server-side so every reader says it the same way, and so the public
 * API can keep handing the marketplace a plain sentence rather than making every
 * consumer reimplement this.
 */
export function mealsLabel(values: readonly string[] | null | undefined): string | null {
	const meals = normaliseMeals(values);
	if (!meals.length) return null;
	if (meals.length === MEALS.length) return 'All meals';
	const labels = meals.map((m) => MEALS.find((x) => x.value === m)!.label);
	if (labels.length === 1) return labels[0];
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1].toLowerCase()}`;
}

/* --------------------------------------------------------- accommodation ---- */

/** What a place costs in comfort, not in money. */
export const ACCOMMODATION_LEVELS = [
	{ value: 'LUXURY', label: 'Luxury' },
	{ value: 'MID_RANGE', label: 'Mid-range' },
	{ value: 'BUDGET', label: 'Budget' }
] as const;

/** What kind of place it is. */
export const LODGE_TYPES = [
	{ value: 'SAFARI_LODGE', label: 'Safari lodge' },
	{ value: 'TENTED_CAMP', label: 'Tented camp' },
	{ value: 'HOTEL', label: 'Hotel' },
	{ value: 'BOUTIQUE_HOTEL', label: 'Boutique hotel' },
	{ value: 'ECO_LODGE', label: 'Eco lodge' },
	{ value: 'BEACH_RESORT', label: 'Beach resort' }
] as const;

export const accommodationLevelLabel = (value: string | null | undefined): string | null =>
	ACCOMMODATION_LEVELS.find((l) => l.value === value)?.label ?? null;

export const lodgeTypeLabel = (value: string | null | undefined): string | null =>
	LODGE_TYPES.find((t) => t.value === value)?.label ?? null;

/**
 * "COUPLES" and "Couples" are the same audience.
 *
 * The source export contains both spellings — literally, in the same file — so
 * anything reading these as facets has to fold them together or show one tag
 * twice. Title case wins because that is what a reader sees.
 */
export const normaliseBestFor = (values: readonly unknown[] | null | undefined): string[] => {
	const seen = new Map<string, string>();
	for (const raw of values ?? []) {
		const text = String(raw).trim().replace(/[_-]+/g, ' ');
		if (!text) continue;
		const label = text
			.toLowerCase()
			.split(' ')
			.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
			.join(' ');
		if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
	}
	return [...seen.values()];
};
