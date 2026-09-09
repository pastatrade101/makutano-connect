/**
 * The frozen commercial offer.
 *
 * A sent quotation is a historical fact: it is what this business offered this
 * traveller on this day. Changing a tour's price afterwards must not change it,
 * and neither must changing a season, a group tier, or the marketplace price.
 *
 * That invariant did NOT hold. sendQuotation wrote a snapshot, but nothing ever
 * read it back — acceptQuotation loaded the LIVE quotation and its LIVE items
 * and copied those into the booking. The audit put it exactly right:
 * immutability existed because no editor existed, not because anything enforced
 * it. The first `updateQuotation()` anyone added would have silently rewritten
 * offers that travellers had already accepted.
 *
 * So this module is the boundary. Money that has been sent is read from here and
 * from nowhere else, and the pricing engine is never consulted about the past:
 *
 *   pricing.ts answers  "what should we charge now?"
 *   this module answers "what did we actually offer?"
 *
 * A booking must be built from the second answer.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';

/**
 * The snapshot format version, stored in every row this writes.
 *
 * Snapshots outlive the code that made them — a quotation accepted in 2026 may
 * be read in 2030, by which time pricing will have grown seasons, tiers and
 * whatever comes after. Stamping the shape means a future reader can tell what
 * it is looking at instead of guessing from which keys happen to be present.
 */
export const SNAPSHOT_SCHEMA = 2;

/** One line of the offer, as a value. Nothing here is a reference. */
export type FrozenItem = {
	type: string | null;
	title: string;
	description: string | null;
	quantity: number;
	unitPrice: string;
	total: string;
	startDate: string | null;
	endDate: string | null;
	externalReference: string | null;
	externalSource: string | null;
};

export type FrozenOffer = {
	schema: number;
	version: number;
	frozenAt: string;
	currency: string;
	adults: number;
	children: number;
	subtotal: string;
	discount: string;
	tax: string;
	total: string;
	startDate: string | null;
	endDate: string | null;
	validUntil: string | null;
	customerId: string | null;
	bookingRequestId: string | null;
	/**
	 * The words that went out beside the money.
	 *
	 * The traveller's page renders these, so they are part of the offer that was
	 * made, not delivery-channel decoration: a message reading "30% deposit confirms
	 * the booking" is a commercial term. They were absent from the snapshot, so the
	 * live columns could be rewritten under an accepted quote while the record still
	 * claimed to be complete. Frozen with the rest.
	 */
	notes: string | null;
	terms: string | null;
	items: FrozenItem[];
	/**
	 * Why the price was what it was — for a human reading the record later.
	 *
	 * EXPLANATORY ONLY. Nothing above is ever reconstructed from these: storing
	 * "season_id = X" and looking up its price later is precisely the failure
	 * this design exists to prevent, because the season can be edited or deleted.
	 * The money above is values; this is a label beside them.
	 */
	context: { appliedPricing: string | null; tourId: string | null };
};

const asDate = (value: unknown): string | null =>
	value instanceof Date ? value.toISOString() : typeof value === 'string' && value ? value : null;

/** Build the frozen offer from the live rows, at the moment of sending. */
export function freezeOffer(
	quotation: Record<string, unknown>,
	items: Record<string, unknown>[],
	context: { appliedPricing?: string | null; tourId?: string | null } = {}
): FrozenOffer {
	return {
		schema: SNAPSHOT_SCHEMA,
		version: Number(quotation.version ?? 1),
		frozenAt: new Date().toISOString(),
		currency: String(quotation.currency ?? 'USD'),
		adults: Number(quotation.adults ?? 1),
		children: Number(quotation.children ?? 0),
		subtotal: String(quotation.subtotal ?? '0.00'),
		discount: String(quotation.discount ?? '0.00'),
		tax: String(quotation.tax ?? '0.00'),
		total: String(quotation.total ?? '0.00'),
		startDate: asDate(quotation.startDate),
		endDate: asDate(quotation.endDate),
		validUntil: asDate(quotation.validUntil),
		customerId: (quotation.customerId as string | null) ?? null,
		bookingRequestId: (quotation.bookingRequestId as string | null) ?? null,
		notes: (quotation.notes as string | null) ?? null,
		terms: (quotation.terms as string | null) ?? null,
		items: items.map((i) => ({
			type: (i.type as string | null) ?? null,
			title: String(i.title ?? ''),
			description: (i.description as string | null) ?? null,
			quantity: Number(i.quantity ?? 1),
			unitPrice: String(i.unitPrice ?? '0.00'),
			total: String(i.total ?? '0.00'),
			startDate: asDate(i.startDate),
			endDate: asDate(i.endDate),
			externalReference: (i.externalReference as string | null) ?? null,
			externalSource: (i.externalSource as string | null) ?? null
		})),
		context: { appliedPricing: context.appliedPricing ?? null, tourId: context.tourId ?? null }
	};
}

/**
 * Read a snapshot back, including ones written before this format existed.
 *
 * The rows already in production hold `{ quotation, items }` — the whole live
 * objects, as they were. Those are still values, so they are still a valid
 * historical record; they just have a different shape. Refusing to read them
 * would strand every quotation sent so far, so they are normalised here rather
 * than migrated.
 */
export function readSnapshot(raw: Record<string, unknown>, version: number): FrozenOffer | null {
	if (!raw) return null;
	if (typeof raw.schema === 'number' && Array.isArray(raw.items)) {
		// Schema 1 predates notes/terms. Absent means "nothing was said", which is the
		// truth for those rows — normalised to null so every reader sees one shape.
		const offer = raw as unknown as FrozenOffer;
		return { ...offer, notes: offer.notes ?? null, terms: offer.terms ?? null };
	}
	const legacy = raw as { quotation?: Record<string, unknown>; items?: Record<string, unknown>[] };
	if (!legacy.quotation) return null;
	return {
		...freezeOffer(legacy.quotation, legacy.items ?? []),
		version,
		frozenAt: asDate(legacy.quotation.sentAt) ?? ''
	};
}

/**
 * The offer a traveller is accepting.
 *
 * `expectedVersion` is the version the traveller was actually looking at. When
 * it is supplied and does not match the latest sent version, this REFUSES rather
 * than accepting the newer one: a link sent on Monday, opened on Friday after
 * the operator has re-quoted, must not silently commit the traveller to a
 * different price than the one on their screen. Absent an expectation — an
 * operator accepting on the traveller's behalf in the portal — the latest sent
 * version is the offer that stands.
 */
export async function frozenOfferFor(
	tenantId: string,
	quotationId: string,
	expectedVersion?: number | null
): Promise<FrozenOffer> {
	const [row] = await db()
		.select()
		.from(schema.quotationVersions)
		.where(and(eq(schema.quotationVersions.tenantId, tenantId), eq(schema.quotationVersions.quotationId, quotationId)))
		.orderBy(desc(schema.quotationVersions.version))
		.limit(1);

	if (!row) {
		// Nothing was ever sent, so there is no offer to accept. Falling back to
		// the live rows here would reintroduce exactly the bug this closes.
		throw new AppError('CONFLICT', 'This quotation has not been sent yet, so there is nothing to accept.');
	}

	if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== row.version) {
		throw new AppError(
			'CONFLICT',
			'This quotation has been updated since you opened it. Please reload to see the current offer before accepting.'
		);
	}

	const offer = readSnapshot(row.snapshot, row.version);
	if (!offer) throw new AppError('CONFLICT', 'The sent version of this quotation could not be read.');
	return offer;
}
