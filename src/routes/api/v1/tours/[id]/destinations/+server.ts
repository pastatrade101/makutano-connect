// Which canonical places a listing visits.
//
// PUT, not POST/DELETE per link: the composer edits the whole set and sends it
// whole, which removes a class of bug where two edits race and interleave.
// Vendors SELECT from platform destinations here; they cannot create one.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getTourDetail, setTourDestinations } from '$lib/server/tours';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const bodySchema = z.object({ destinationIds: z.array(z.string().uuid()).max(30) });

export const PUT: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const { destinationIds } = await parseBody(event, bodySchema);
		await setTourDestinations(ctx.tenantId, event.params.id!, destinationIds, { apiKeyId: ctx.apiKeyId });
		const detail = await getTourDetail(ctx.tenantId, event.params.id!);
		return ok(detail.destinations);
	});
