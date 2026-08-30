// The other half of the mirror: "this one is gone".
//
// PUT /quotations/mirror tells Connect about quotations that EXIST. Nothing
// told it about ones that stopped existing, so deleting sixteen quotations in
// the source left sixteen on the work list here, and no amount of re-syncing
// would have cleared them. This is that missing message.
//
// Keyed on the SOURCE's own reference, because that is the only identifier the
// source holds — it has never seen Connect's uuid.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { deleteMirroredQuotation } from '$lib/server/quotations';
import { handle, ok, requireApiScope } from '$lib/server/http';

export const DELETE: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		const reference = event.params.reference!;
		const result = await deleteMirroredQuotation(ctx.tenantId, reference);
		if (result.deleted) {
			await audit(
				ctx.tenantId,
				'quotation.deleted',
				{ type: 'api_key' },
				{ type: 'quotation', id: reference },
				{ after: { deleted: true }, externalReference: reference }
			);
		}
		// 200 either way: a delete replayed twice, or sent for something never
		// mirrored, is not a failure worth retrying.
		return ok({ externalReference: reference, deleted: result.deleted, reference: result.reference });
	});
