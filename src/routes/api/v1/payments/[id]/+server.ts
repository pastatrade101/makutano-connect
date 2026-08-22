import type { RequestHandler } from './$types';
import { getPayment } from '$lib/server/payments';
import { handle, ok, parseUuid, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'payments:read');
		return ok(await getPayment(ctx.tenantId, parseUuid(event.params.id!, 'payment id')));
	});
