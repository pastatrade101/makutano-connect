// The Embedded Signup launcher (§7, §31).
//
// Two ways in, one exchange path:
//   • ?session=<token>  — minted by the client's CMS through POST /api/v1/whatsapp/
//     connect-session. The token IS the tenant binding; the browser never sends a
//     tenant id, and the session is single-use with a nonce and an expiry.
//   • signed-in operator — the tenant comes from their membership.
//
// Either way the OAuth code is exchanged on the server. The Meta app secret and the
// resulting access token never touch the browser.
import { fail, type Actions } from '@sveltejs/kit';
import { AppError } from '$lib/server/errors';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { publicSignupConfig } from '$lib/server/whatsapp/config';
import { connectFromCode } from '$lib/server/whatsapp/embedded-signup';
import { consumeConnectSession, resolveConnectSession } from '$lib/server/whatsapp/onboarding';
import { embeddedSignupReady } from '$lib/server/env';
import { getTenantById } from '$lib/server/tenants';
import { log } from '$lib/server/logger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const token = url.searchParams.get('session');
	if (token) {
		let session;
		try {
			session = await resolveConnectSession(token);
		} catch (error) {
			/*
			 * A spent link is NORMAL, not exceptional.
			 *
			 * These sessions are single-use with an expiry, so a client who refreshes
			 * the page, opens the link twice, or comes back to it tomorrow arrives here
			 * on the ordinary path. resolveConnectSession throws for that, and an
			 * uncaught throw in load() is a 500 — so the person we least want to
			 * confuse, someone else's customer following a link they were sent, got a
			 * server error page.
			 *
			 * The page already says the right thing in its `unauthenticated` branch:
			 * "This connection link is invalid or has expired. Ask your provider for a
			 * new one." Fall through to that.
			 *
			 * UNAUTHORIZED only. A database outage must still be a 500: telling someone
			 * their link expired when the truth is that our server is down sends them
			 * to chase a replacement that will fail in exactly the same way.
			 */
			if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
				log.info('whatsapp_connect_link_rejected', { reason: 'expired_or_used' });
				return { ready: false, meta: publicSignupConfig(), mode: 'unauthenticated' as const, tenantName: '' };
			}
			throw error;
		}
		const tenant = await getTenantById(session.tenantId);
		return {
			ready: embeddedSignupReady(),
			meta: publicSignupConfig(),
			mode: 'session' as const,
			nonce: session.nonce,
			sessionId: session.id,
			tenantName: tenant?.name ?? 'your business',
			redirectUrl: session.redirectUrl
		};
	}

	if (!locals.user || !locals.tenant) {
		return { ready: false, meta: publicSignupConfig(), mode: 'unauthenticated' as const, tenantName: '' };
	}
	requirePermission(locals.permissions, 'whatsapp:connect');
	return {
		ready: embeddedSignupReady(),
		meta: publicSignupConfig(),
		mode: 'portal' as const,
		tenantName: locals.tenant.name,
		redirectUrl: '/app/settings/whatsapp'
	};
};

export const actions: Actions = {
	exchange: async ({ locals, request }) => {
		const data = await request.formData();
		const code = String(data.get('code') ?? '');
		const wabaId = String(data.get('wabaId') ?? '') || null;
		const phoneNumberId = String(data.get('phoneNumberId') ?? '') || null;
		const sessionToken = String(data.get('session') ?? '');

		// Resolve the tenant from the credential we were given — never from a form field.
		let tenantId: string;
		if (sessionToken) {
			const session = await resolveConnectSession(sessionToken);
			await consumeConnectSession(session.id, session.nonce);
			tenantId = session.tenantId;
		} else {
			if (!locals.user || !locals.tenant) return fail(401, { message: 'Sign in to connect WhatsApp.' });
			requirePermission(locals.permissions, 'whatsapp:connect');
			tenantId = locals.tenant.id;
		}

		const result = await connectFromCode({ tenantId, code, wabaId, phoneNumberId });
		if (!result.ok) {
			log.warn('connect_whatsapp_failed', { tenantId, error: result.error, code: result.code });
			return fail(result.status ?? 400, { message: friendlyError(result.code ?? result.error) });
		}

		await audit(
			tenantId,
			'whatsapp.connected',
			{ type: sessionToken ? 'system' : 'user', userId: locals.user?.id ?? null },
			{ type: 'whatsapp_connection', id: result.connection.id },
			{ phoneNumberId: result.connection.phoneNumberId }
		);
		return {
			success: true,
			connection: {
				displayPhoneNumber: result.connection.displayPhoneNumber,
				businessName: result.connection.businessName
			}
		};
	}
};

function friendlyError(code: string): string {
	switch (code) {
		case 'number_already_connected':
			return 'That WhatsApp number is already connected to a different account.';
		case 'number_not_accessible':
			return 'We could not verify that you own that WhatsApp number.';
		case 'no_whatsapp_number_found':
			return 'No WhatsApp number was found on that business account.';
		case 'embedded_signup_not_configured':
			return 'WhatsApp onboarding is not configured on this deployment.';
		case 'missing_code':
			return 'The connection response from Meta was incomplete — please try again.';
		default:
			return 'We could not complete the WhatsApp connection. Please try again.';
	}
}
