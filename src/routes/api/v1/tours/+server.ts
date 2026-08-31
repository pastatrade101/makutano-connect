// A tenant's own marketplace listings.
//
// Thin on purpose: every rule — slug generation, validation, the publishing
// lifecycle — lives in $lib/server/tours. A route that re-implemented any of it
// would become a second place the rule lives, free to disagree with the portal.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createTour, listTours } from '$lib/server/tours';
import { handle, listResponse, ok, paginationFrom, parseBody, parseQuery, requireApiScope } from '$lib/server/http';

const STATUSES = [
	'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED',
	'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'
] as const;

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a price like 1200 or 1200.50');

const createSchema = z.object({
	title: z.string().min(1).max(300),
	slug: z.string().max(120).optional(),
	primaryCountryId: z.string().uuid().optional().nullable(),
	primaryCategoryId: z.string().uuid().optional().nullable(),
	shortDescription: z.string().max(600).optional().nullable(),
	description: z.string().max(20000).optional().nullable(),
	durationDays: z.number().int().min(1).max(365).optional(),
	durationNights: z.number().int().min(0).max(365).optional().nullable(),
	priceFrom: money.optional().nullable(),
	currency: z.string().length(3).optional().nullable(),
	pricingType: z.enum(['PER_PERSON', 'PER_GROUP', 'FROM']).optional(),
	travelStyle: z.string().max(80).optional().nullable(),
	groupType: z.string().max(80).optional().nullable(),
	groupSizeMin: z.number().int().min(1).max(200).optional().nullable(),
	groupSizeMax: z.number().int().min(1).max(200).optional().nullable(),
	ageRequirement: z.string().max(120).optional().nullable(),
	heroMediaId: z.string().uuid().optional().nullable(),
	accommodationSummary: z.string().max(2000).optional().nullable(),
	transportSummary: z.string().max(2000).optional().nullable(),
	mealsSummary: z.string().max(2000).optional().nullable(),
	bestTimeSummary: z.string().max(2000).optional().nullable(),
	availabilityType: z.enum(['YEAR_ROUND', 'SEASONAL', 'DATE_RANGE']).optional(),
	availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
	availableTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
	seoTitle: z.string().max(200).optional().nullable(),
	seoDescription: z.string().max(400).optional().nullable(),
	highlights: z.array(z.string().max(300)).max(20).optional(),
	included: z.array(z.string().max(300)).max(40).optional(),
	excluded: z.array(z.string().max(300)).max(40).optional()
	// Deliberately absent: status, featured, publishedAt, reviewedBy, reviewNote.
	// Those move only through the lifecycle, and featuring is a platform decision.
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z.object({ status: z.enum(STATUSES).optional(), search: z.string().max(200).optional() }).partial()
		);
		const { items, total } = await listTours(ctx.tenantId, pagination, {
			status: filters.status ? [filters.status] : undefined,
			search: filters.search
		});
		return listResponse(items, total, pagination);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const body = await parseBody(event, createSchema);
		const tour = await createTour(ctx.tenantId, body, { apiKeyId: ctx.apiKeyId });
		return ok(tour, undefined, { status: 201 });
	});
