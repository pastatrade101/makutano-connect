// What a quotation for this enquiry should probably say.
//
// The rule itself lives in $lib/server/quotations.ts, because the portal builds
// its quotation from the same draft — the phone and the web must not disagree
// about what a marketplace enquiry is worth.
import { draftQuotationFor } from '$lib/server/quotations';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'quotations:write');
		return ok(await draftQuotationFor(viewer.tenantId, event.params.id!));
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
