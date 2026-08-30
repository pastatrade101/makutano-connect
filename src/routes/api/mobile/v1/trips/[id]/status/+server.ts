// Moving a trip along, from the field.
//
// The READY and IN_PROGRESS gates live in changeTripStatus, which re-derives
// readiness rather than trusting the caller — so a phone cannot mark a trip ready
// that the portal would refuse, and a bad connection cannot produce a departure
// nobody checked.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { changeTripStatus, getTripDetail, scopeFor } from '$lib/server/trips';
import { blockerLabel, statusLabel } from '$lib/labels';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

const schema = z.object({
	status: z.enum(['PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
	reason: z.string().max(500).optional()
});

export const PATCH: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'trips:write');
		const body = schema.parse(await event.request.json());

		const scope = await scopeFor(viewer.tenantId, { userId: viewer.userId, role: event.locals.role });
		const trip = await changeTripStatus(
			viewer.tenantId,
			event.params.id!,
			body.status,
			{ userId: viewer.userId },
			body.reason,
			scope
		);
		await audit(
			viewer.tenantId,
			'trip.status_changed',
			{ type: 'user', userId: viewer.userId },
			{ type: 'trip', id: trip.id },
			{ after: { status: body.status }, reason: body.reason ?? null, via: 'mobile' }
		);

		const detail = await getTripDetail(viewer.tenantId, trip.id, scope);
		return ok({
			trip: { id: trip.id, status: trip.status, statusLabel: statusLabel(trip.status) },
			readiness: {
				percent: detail.readiness.percent,
				canBeReady: detail.readiness.canBeReady,
				blocking: detail.readiness.missing.filter((c) => c.critical).map((c) => blockerLabel(c))
			}
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
