// §31 — the reusable WhatsApp connection entry point for a client CMS.
//
// The CMS calls this server-to-server with its API key and receives only a short-lived
// onboarding session: no Meta app secret, no access token, no tenant id needed by the
// browser. The returned launchUrl is what the client redirects its user to.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireFeature } from '$lib/server/billing';
import { publicSignupConfig } from '$lib/server/whatsapp/config';
import { createConnectSession } from '$lib/server/whatsapp/onboarding';
import { embeddedSignupReady } from '$lib/server/env';
import { AppError } from '$lib/server/errors';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const bodySchema = z.object({ redirectUrl: z.string().url().max(500).optional().nullable() }).default({});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:read');
		await requireFeature(ctx.tenantId, 'whatsapp');
		if (!embeddedSignupReady()) {
			throw new AppError('NOT_CONFIGURED', 'WhatsApp onboarding is not configured on this deployment.');
		}
		const body = await parseBody(event, bodySchema);
		const session = await createConnectSession({
			tenantId: ctx.tenantId,
			apiKeyId: ctx.apiKeyId,
			redirectUrl: body.redirectUrl ?? null
		});
		// publicSignupConfig() is intentionally the app id + config id only — both are
		// public values in Meta's SDK; the app SECRET never appears here.
		return ok({ ...session, meta: publicSignupConfig() }, undefined, { status: 201 });
	});
