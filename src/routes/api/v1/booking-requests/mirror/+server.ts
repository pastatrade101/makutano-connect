// The enquiry mirror's update half.
//
// POST /booking-requests creates the enquiry once. Nothing then told Connect
// that the booking had been confirmed, that money had moved, or that an
// amendment had changed the price — so Connect's copy froze at the moment of
// creation while the real record went on living.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { upsertBookingRequestMirror } from '$lib/server/booking-requests';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const schema = z.object({
	externalReference: z.string().min(1).max(200),
	externalSource: z.string().max(100).optional(),
	status: z.string().max(40).optional().nullable(),
	paymentStatus: z.string().max(40).optional().nullable(),
	estimatedTotal: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.optional()
		.nullable(),
	currency: z.string().length(3).optional().nullable(),
	notes: z.string().max(5000).optional().nullable(),
	amendment: z
		.object({
			summary: z.string().max(2000).optional().nullable(),
			priceEffect: z.string().max(200).optional().nullable(),
			state: z.string().max(40).optional().nullable()
		})
		.optional()
		.nullable()
});

export const PUT: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:write');
		const body = await parseBody(event, schema);
		const result = await upsertBookingRequestMirror(ctx.tenantId, body);
		if (result.updated) {
			await audit(
				ctx.tenantId,
				'booking_request.updated',
				{ type: 'api_key' },
				{ type: 'booking_request', id: body.externalReference },
				{ after: { status: body.status, paymentStatus: body.paymentStatus }, externalReference: body.externalReference }
			);
		}
		// 200 either way: a status change for a reference Connect never saw is not
		// a failure worth retrying.
		return ok({ externalReference: body.externalReference, updated: result.updated, reference: result.reference });
	});
