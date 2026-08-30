// Moving a trip along its operational life.
//
// Separate from PATCH because it is a different kind of act: PATCH edits set-up
// details, this asserts a fact about the trip. Marking READY in particular is a
// promise that the trip can leave, and the service re-checks readiness rather
// than taking the caller's word for it.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { changeTripStatus } from '$lib/server/trips';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const patchSchema = z.object({
	status: z.enum(['PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
	reason: z.string().max(500).optional()
});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:write');
		const id = parseUuid(event.params.id!, 'trip id');
		const body = await parseBody(event, patchSchema);
		const trip = await changeTripStatus(ctx.tenantId, id, body.status, { apiKeyId: ctx.apiKeyId }, body.reason);
		await audit(
			ctx.tenantId,
			'trip.status_changed',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'trip', id },
			{ after: { status: body.status }, reason: body.reason ?? null }
		);
		return ok(trip);
	});
