// Sending a quotation that already exists.
//
// The create route can send in the same call, which covers "price it and go".
// This covers the other half: a draft saved earlier — on the phone, in the
// portal, or by somebody else on the team — whose next action is simply to put
// it in front of the traveller. Without this the phone could raise a draft it
// had no way to finish.
import { audit } from '$lib/server/audit';
import { sendQuotation } from '$lib/server/quotations';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'quotations:write');

		const quotation = await sendQuotation(viewer.tenantId, event.params.id!, viewer.userId);
		await audit(
			viewer.tenantId,
			'quotation.sent',
			{ type: 'user', userId: viewer.userId },
			{ type: 'quotation', id: event.params.id! },
			{ via: 'mobile' }
		);
		return ok({ id: event.params.id, sent: true, status: quotation?.status ?? 'SENT' });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
