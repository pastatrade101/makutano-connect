// §31 — disconnecting stops outbound sends but preserves message/conversation history
// and audit records.
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { disconnect } from '$lib/server/whatsapp/connections';
import { AppError } from '$lib/server/errors';
import { handle, ok, requireApiScope } from '$lib/server/http';

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:send');
		const connection = await disconnect(ctx.tenantId);
		if (!connection) throw new AppError('WHATSAPP_NOT_CONNECTED', 'This account has no WhatsApp connection.');
		await audit(
			ctx.tenantId,
			'whatsapp.disconnected',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'whatsapp_connection', id: connection.id }
		);
		return ok(connection);
	});
