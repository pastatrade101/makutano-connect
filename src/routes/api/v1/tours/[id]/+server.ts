// One listing. getTour/updateTour are tenant-scoped, so an id belonging to
// another tenant is a 404 here — not a 403, which would confirm it exists.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getTourDetail, softDeleteTour, updateTour } from '$lib/server/tours';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a price like 1200 or 1200.50');

// The same field set as create, all optional. status/featured are absent for the
// same reason: they are not editable properties, they are lifecycle outcomes.
const patchSchema = z
	.object({
		title: z.string().min(1).max(300),
		slug: z.string().max(120),
		primaryCountryId: z.string().uuid().nullable(),
		shortDescription: z.string().max(600).nullable(),
		description: z.string().max(20000).nullable(),
		durationDays: z.number().int().min(1).max(365),
		durationNights: z.number().int().min(0).max(365).nullable(),
		priceFrom: money.nullable(),
		currency: z.string().length(3).nullable(),
		pricingType: z.enum(['PER_PERSON', 'PER_GROUP', 'FROM']),
		travelStyle: z.string().max(80).nullable(),
		groupType: z.string().max(80).nullable(),
		groupSizeMin: z.number().int().min(1).max(200).nullable(),
		groupSizeMax: z.number().int().min(1).max(200).nullable(),
		ageRequirement: z.string().max(120).nullable(),
		heroMediaId: z.string().uuid().nullable(),
		accommodationSummary: z.string().max(2000).nullable(),
		transportSummary: z.string().max(2000).nullable(),
		mealsSummary: z.string().max(2000).nullable(),
		bestTimeSummary: z.string().max(2000).nullable(),
		availabilityType: z.enum(['YEAR_ROUND', 'SEASONAL', 'DATE_RANGE']),
		availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
		availableTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
		seoTitle: z.string().max(200).nullable(),
		seoDescription: z.string().max(400).nullable(),
		highlights: z.array(z.string().max(300)).max(20),
		included: z.array(z.string().max(300)).max(40),
		excluded: z.array(z.string().max(300)).max(40)
	})
	.partial();

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:read');
		return ok(await getTourDetail(ctx.tenantId, event.params.id!));
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const body = await parseBody(event, patchSchema);
		return ok(await updateTour(ctx.tenantId, event.params.id!, body, { apiKeyId: ctx.apiKeyId }));
	});

export const DELETE: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		// Soft: an indexed public URL must not become a hard 404 by accident, and
		// an enquiry that named this tour has to keep making sense.
		await softDeleteTour(ctx.tenantId, event.params.id!, { apiKeyId: ctx.apiKeyId });
		return ok({ deleted: true });
	});
