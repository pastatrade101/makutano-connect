// Clearing a quotation off the work list from the phone.
//
// Connect does not own quotations — the tenant's own site does — so this is
// housekeeping on Connect's copy, not a delete that reaches back to the source.
// It exists because the source cannot always tell us it deleted something.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { restoreQuotation, softDeleteQuotation } from '$lib/server/quotations';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

export const DELETE: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'quotations:write');
		const row = await softDeleteQuotation(viewer.tenantId, event.params.id!);
		await audit(
			viewer.tenantId,
			'quotation.deleted',
			{ type: 'user', userId: viewer.userId },
			{ type: 'quotation', id: row.id },
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
		requirePermissionOrThrow(viewer, 'quotations:write');
		const row = await restoreQuotation(viewer.tenantId, event.params.id!);
		await audit(
			viewer.tenantId,
			'quotation.restored',
			{ type: 'user', userId: viewer.userId },
			{ type: 'quotation', id: row.id },
			{ after: { deleted: false }, via: 'mobile' }
		);
		return ok({ id: row.id, deleted: false });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
