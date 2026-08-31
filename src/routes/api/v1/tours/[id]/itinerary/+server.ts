// The day-by-day. Reusable package content — deliberately not trip_items, which
// belong to one departure that actually ran.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getTourDetail, replaceItinerary } from '$lib/server/tours';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const daySchema = z.object({
	dayNumber: z.number().int().min(1).max(365),
	title: z.string().min(1).max(300),
	description: z.string().max(8000).optional().nullable(),
	destinationId: z.string().uuid().optional().nullable(),
	accommodation: z.string().max(300).optional().nullable(),
	meals: z.string().max(200).optional().nullable(),
	activities: z.array(z.string().max(200)).max(20).optional(),
	distance: z.string().max(80).optional().nullable(),
	estimatedTravelTime: z.string().max(80).optional().nullable(),
	mediaId: z.string().uuid().optional().nullable()
});

// Whole-list replace, inside a transaction in the service — a failure must not
// leave a tour with half an itinerary.
const bodySchema = z.object({ days: z.array(daySchema).max(60) });

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:read');
		const detail = await getTourDetail(ctx.tenantId, event.params.id!);
		return ok(detail.itinerary);
	});

export const PUT: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const { days } = await parseBody(event, bodySchema);
		return ok(await replaceItinerary(ctx.tenantId, event.params.id!, days, { apiKeyId: ctx.apiKeyId }));
	});
