// Deleting an enquiry from the phone, and putting it back.
//
// DELETE hides the row; it never destroys one. The undo in the app calls the
// restore below, and the row is still there long after the snackbar has gone —
// "recoverable" has to mean recoverable tomorrow, not for six seconds.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { restoreBookingRequest, softDeleteBookingRequest } from '$lib/server/booking-requests';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

export const DELETE: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'booking_requests:write');
		const row = await softDeleteBookingRequest(viewer.tenantId, event.params.id!);
		await audit(
			viewer.tenantId,
			'booking_request.deleted',
			{ type: 'user', userId: viewer.userId },
			{ type: 'booking_request', id: row.id },
			{ after: { deleted: true }, via: 'mobile' }
		);
		return ok({ id: row.id, deleted: true });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'booking_requests:write');
		const row = await restoreBookingRequest(viewer.tenantId, event.params.id!);
		await audit(
			viewer.tenantId,
			'booking_request.restored',
			{ type: 'user', userId: viewer.userId },
			{ type: 'booking_request', id: row.id },
			{ after: { deleted: false }, via: 'mobile' }
		);
		return ok({ id: row.id, deleted: false });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
