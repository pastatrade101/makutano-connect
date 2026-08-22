// §31/§32 — safe connection status. Never returns a token, key version or ciphertext.
import type { RequestHandler } from './$types';
import { getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { handle, ok, requireApiScope } from '$lib/server/http';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:read');
		const connection = await getConnectionForTenant(ctx.tenantId);
		return ok({
			connected: connection?.status === 'CONNECTED',
			connection: connection ? toSafeConnection(connection) : null
		});
	});
