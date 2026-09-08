/**
 * Reading a tour's pricing out of the database and into the engine.
 *
 * The engine itself (src/lib/pricing.ts) is pure and knows nothing about
 * Drizzle — it has to run in the browser too, so the composer's preview is
 * computed by the same code that prices a real quotation rather than by a second
 * implementation that agrees with it until it does not. This module is the only
 * place that turns rows into that engine's input.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db, schema, txDb } from './db';
import { AppError } from './errors';
import {
	calculateTourPrice,
	lowestAdultPrice,
	validatePricing,
	type GroupTier,
	type PriceRequest,
	type PriceResult,
	type Season,
	type TourPricing
} from '$lib/pricing';

/**
 * A tour's complete pricing configuration.
 *
 * Falls back to price_from when the new adult rate is unset, so the 54 tours
 * published before this existed keep quoting exactly what they quote today.
 * Nothing has to be migrated for the engine to answer for them.
 */
export async function tourPricingFor(tenantId: string, tourId: string): Promise<TourPricing | null> {
	const [tour] = await db()
		.select({
			currency: schema.tours.currency,
			pricingType: schema.tours.pricingType,
			priceFrom: schema.tours.priceFrom,
			adultPrice: schema.tours.adultPrice,
			childPrice: schema.tours.childPrice
		})
		.from(schema.tours)
		.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId)))
		.limit(1);
	if (!tour) return null;

	const [tiers, seasons] = await Promise.all([
		db()
			.select()
			.from(schema.tourPriceTiers)
			.where(eq(schema.tourPriceTiers.tourId, tourId))
			.orderBy(asc(schema.tourPriceTiers.minTravellers)),
		db()
			.select()
			.from(schema.tourPriceSeasons)
			.where(eq(schema.tourPriceSeasons.tourId, tourId))
			.orderBy(asc(schema.tourPriceSeasons.startsOn))
	]);

	const adult = tour.adultPrice ?? tour.priceFrom;
	return {
		currency: tour.currency ?? 'USD',
		perGroup: tour.pricingType === 'PER_GROUP',
		base: adult ? { adult, child: tour.childPrice ?? null } : null,
		tiers: tiers.map((t) => ({
			minTravellers: t.minTravellers,
			maxTravellers: t.maxTravellers,
			adult: t.adultPrice,
			child: t.childPrice
		})),
		seasons: seasons.map((s) => ({
			name: s.name,
			startsOn: String(s.startsOn),
			endsOn: String(s.endsOn),
			adult: s.adultPrice,
			child: s.childPrice
		}))
	};
}

/** The recommendation for one enquiry, or null when the tour is not priced. */
export async function recommendPrice(
	tenantId: string,
	tourId: string,
	request: PriceRequest
): Promise<PriceResult | null> {
	const pricing = await tourPricingFor(tenantId, tourId);
	return pricing ? calculateTourPrice(pricing, request) : null;
}

/**
 * What the marketplace should advertise as "From ...".
 *
 * Derived, never typed separately: the product rule is that no claim may be made
 * which the software cannot honour, and a hand-entered "from" price drifts away
 * from the rates underneath it the first time an operator edits a tier.
 */
export async function marketplacePriceFrom(tenantId: string, tourId: string): Promise<string | null> {
	const pricing = await tourPricingFor(tenantId, tourId);
	return pricing ? lowestAdultPrice(pricing) : null;
}

/* ------------------------------------------------------------------ save --- */

export type PricingInput = {
	currency: string;
	adultPrice: string;
	childPrice: string | null;
	tiers: GroupTier[];
	seasons: Season[];
};

/**
 * Save a tour's pricing, and derive what the marketplace advertises.
 *
 * price_from is a DERIVED compatibility field from here on. Ten public surfaces
 * and the JSON-LD Offer read it, so the column stays and the public contract
 * does not move — but once a tour has structured pricing, nobody types it. The
 * browser cannot submit it and the operator is shown it, not asked for it: two
 * editable pricing authorities is how "From $1,099" comes to sit above a tour
 * that actually charges $950.
 *
 * ONE TRANSACTION, via txDb. Rules and the derived price commit together or not
 * at all — a save that stored a new 7+ tier and left price_from advertising the
 * old floor would be a public claim the software no longer honours. txDb and not
 * db(): a transaction over Supabase's transaction pooler wedges the pool
 * permanently, with no error and no slow query, just a later unrelated write
 * hanging for ever (docs/PROJECTS.md rule 3).
 */
export async function saveTourPricing(
	tenantId: string,
	tourId: string,
	input: PricingInput
): Promise<{ priceFrom: string }> {
	const pricing: TourPricing = {
		currency: input.currency,
		// V1 structured pricing is per-person, including its group-size rates: a
		// per-person price that varies with party size is still per person. Calling
		// it PER_GROUP would tell the marketplace the figure covers the whole party.
		perGroup: false,
		base: { adult: input.adultPrice, child: input.childPrice },
		tiers: input.tiers,
		seasons: input.seasons
	};

	const problems = validatePricing(pricing);
	if (problems.length) {
		// The operator's own words, not a constraint name. The database enforces
		// the same invariants underneath; this is the version a person can act on.
		throw new AppError('VALIDATION_ERROR', problems[0].message);
	}

	/*
	 * The advertised price must be REACHABLE.
	 *
	 * lowestAdultPrice runs over the configuration that just passed validation, so
	 * it can only return a rate a real party could actually be quoted. A tour
	 * whose structured pricing yields no adult price cannot be published with one.
	 */
	const derived = lowestAdultPrice(pricing);
	if (!derived) {
		throw new AppError('VALIDATION_ERROR', 'Set an adult price before saving.');
	}

	await txDb().transaction(async (tx) => {
		await tx
			.update(schema.tours)
			.set({
				currency: input.currency,
				adultPrice: input.adultPrice,
				childPrice: input.childPrice,
				// Derived, never submitted. See the note above.
				priceFrom: derived,
				updatedAt: new Date()
			})
			.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId)));

		// Replaced wholesale rather than diffed: the set is small, the form submits
		// all of it, and a partial update is how an orphaned tier survives a rename.
		await tx.delete(schema.tourPriceTiers).where(eq(schema.tourPriceTiers.tourId, tourId));
		if (input.tiers.length) {
			await tx.insert(schema.tourPriceTiers).values(
				input.tiers.map((t) => ({
					tenantId,
					tourId,
					minTravellers: t.minTravellers,
					maxTravellers: t.maxTravellers,
					adultPrice: t.adult,
					childPrice: t.child
				}))
			);
		}

		await tx.delete(schema.tourPriceSeasons).where(eq(schema.tourPriceSeasons.tourId, tourId));
		if (input.seasons.length) {
			await tx.insert(schema.tourPriceSeasons).values(
				input.seasons.map((s) => ({
					tenantId,
					tourId,
					name: s.name.trim(),
					startsOn: s.startsOn,
					endsOn: s.endsOn,
					adultPrice: s.adult,
					childPrice: s.child
				}))
			);
		}
	});

	return { priceFrom: derived };
}

/**
 * Has this tour moved to structured pricing yet?
 *
 * Legacy tours keep a hand-typed price_from and no adult_price, and must go on
 * behaving exactly as they do today — publishing, displaying and quoting through
 * the fallback — until an operator deliberately saves structured pricing.
 * Opening or editing a tour must never migrate it.
 */
export const isStructured = (tour: { adultPrice: string | null }): boolean => tour.adultPrice !== null;
