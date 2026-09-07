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
import { db, schema } from './db';
import {
	calculateTourPrice,
	lowestAdultPrice,
	type PriceRequest,
	type PriceResult,
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
