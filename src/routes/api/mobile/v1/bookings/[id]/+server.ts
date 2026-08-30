// Deleting a booking from the phone, and putting it back.
//
// Never a hard delete: that would cascade into the trip, the travellers, the
// status history and the payment requests, and orphan the payments — money in
// the ledger with nothing to point at. The trip is cancelled on the way out,
// because a departure whose booking has been deleted is not something anyone
// should still be preparing.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { restoreBooking, softDeleteBooking } from '$lib/server/bookings';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

export const DELETE: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'bookings:write');
		const { booking } = await softDeleteBooking(viewer.tenantId, event.params.id!, viewer.userId);
		await audit(
			viewer.tenantId,
			'booking.deleted',
			{ type: 'user', userId: viewer.userId },
			{ type: 'booking', id: booking.id },
			{ after: { deleted: true }, via: 'mobile' }
		);
		return ok({ id: booking.id, deleted: true });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'bookings:write');
		const booking = await restoreBooking(viewer.tenantId, event.params.id!);
		await audit(
			viewer.tenantId,
			'booking.restored',
			{ type: 'user', userId: viewer.userId },
			{ type: 'booking', id: booking.id },
			{ after: { deleted: false }, via: 'mobile' }
		);
		return ok({ id: booking.id, deleted: false });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
