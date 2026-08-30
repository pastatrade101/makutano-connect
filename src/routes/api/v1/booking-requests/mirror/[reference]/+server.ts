// The other half of the enquiry mirror: "this one is gone".
//
// syncBookingToMakutano only ever posts enquiries that EXIST, so a deletion in
// the source left a row here that nothing could clear — the same gap that left
// sixteen quotations stranded.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { deleteMirroredBookingRequest } from '$lib/server/booking-requests';
import { handle, ok, requireApiScope } from '$lib/server/http';

export const DELETE: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'booking_requests:write');
		const reference = event.params.reference!;
		const result = await deleteMirroredBookingRequest(ctx.tenantId, reference);
		if (result.deleted) {
			await audit(
				ctx.tenantId,
				'booking_request.deleted',
				{ type: 'api_key' },
				{ type: 'booking_request', id: reference },
				{ after: { deleted: true }, externalReference: reference }
			);
		}
		// 200 either way: a replayed delete is not a failure worth retrying.
		return ok({ externalReference: reference, deleted: result.deleted, reference: result.reference });
	});
