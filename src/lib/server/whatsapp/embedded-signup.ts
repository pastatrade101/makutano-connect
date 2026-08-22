// Meta Embedded Signup — server side (§7).
//
// The browser runs Meta's popup and hands back an OAuth `code` (plus waba_id and
// phone_number_id on a fresh signup). Everything after that happens here: exchange the
// code, prove the token actually owns the number, register it, subscribe our app to
// its webhooks, and store the encrypted credential. No token, app secret or encryption
// key ever reaches the browser.
//
// Ported from the working single-tenant implementation; the ownership checks below are
// the parts that make it safe to run for many tenants against one Meta app.
import crypto from 'node:crypto';
import { log } from '../logger';
import { appGraphRequest, WhatsAppApiError } from './client';
import { metaAppConfig } from './config';
import { getConnectionByPhoneNumberId, upsertConnection } from './connections';
import type { WhatsappConnection } from '../db/schema';

type ConnectResult =
	{ ok: true; connection: WhatsappConnection } | { ok: false; error: string; code?: string; status?: number };

/**
 * Discover the WABA + first phone number a token grants access to.
 *
 * Meta's *Reconnect* flow returns only the code — no waba_id/phone_number_id — so they
 * are resolved from the token itself: debug_token → granular_scopes → phone_numbers.
 */
async function discoverWabaAndPhone(accessToken: string) {
	const cfg = metaAppConfig();
	try {
		const dbg = await appGraphRequest<{
			data?: { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> };
		}>({
			path: 'debug_token',
			query: { input_token: accessToken, access_token: `${cfg.appId}|${cfg.appSecret}` }
		});
		const wabaIds = new Set<string>();
		for (const s of dbg?.data?.granular_scopes ?? []) {
			if (/whatsapp_business/.test(s.scope ?? '')) (s.target_ids ?? []).forEach((id) => wabaIds.add(id));
		}
		for (const wabaId of wabaIds) {
			try {
				const pn = await appGraphRequest<{
					data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }>;
				}>({
					path: `${wabaId}/phone_numbers`,
					token: accessToken,
					query: { fields: 'id,display_phone_number,verified_name' }
				});
				const first = pn?.data?.[0];
				if (first?.id) {
					return {
						wabaId,
						phoneNumberId: first.id,
						displayPhoneNumber: first.display_phone_number ?? null,
						businessName: first.verified_name ?? null
					};
				}
			} catch (err) {
				log.warn('phone_numbers_lookup_failed', { wabaId, message: (err as Error)?.message });
			}
		}
	} catch (err) {
		log.warn('debug_token_failed', { message: (err as Error)?.message });
	}
	return null;
}

export async function connectFromCode(params: {
	tenantId: string;
	code: string;
	wabaId?: string | null;
	phoneNumberId?: string | null;
}): Promise<ConnectResult> {
	const cfg = metaAppConfig();
	if (!cfg.appId || !cfg.appSecret || !cfg.configId)
		return { ok: false, error: 'embedded_signup_not_configured', status: 503 };
	if (!params.code) return { ok: false, error: 'missing_code', status: 422 };

	let { wabaId, phoneNumberId } = params;
	let displayPhoneNumber: string | null = null;
	let businessName: string | null = null;

	try {
		// 1. Exchange the code for a business-scoped token. Embedded Signup codes from
		//    FB.login (config_id + response_type:code) are exchanged WITHOUT a
		//    redirect_uri — sending one makes Meta reject the exchange outright.
		const tok = await appGraphRequest<{ access_token?: string; expires_in?: number }>({
			path: 'oauth/access_token',
			query: { client_id: cfg.appId, client_secret: cfg.appSecret, code: params.code }
		});
		const accessToken = tok.access_token;
		if (!accessToken) return { ok: false, error: 'no_access_token_returned', status: 502 };
		const tokenExpiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null;

		// 2. Fill in anything the browser did not supply (the Reconnect flow).
		if (!phoneNumberId || !wabaId) {
			const found = await discoverWabaAndPhone(accessToken);
			if (found) {
				wabaId = wabaId || found.wabaId;
				phoneNumberId = phoneNumberId || found.phoneNumberId;
				displayPhoneNumber = found.displayPhoneNumber;
				businessName = found.businessName;
			}
		}
		if (!phoneNumberId)
			return { ok: false, error: 'no_whatsapp_number_found', code: 'no_whatsapp_number_found', status: 404 };

		// 3. AUTHORITATIVE ownership check: read the number WITH the exchanged token. A
		//    token that cannot read this phone_number_id does not own it, so we refuse to
		//    store the connection. This is what stops a caller from claiming a number by
		//    simply passing someone else's phone_number_id.
		try {
			const num = await appGraphRequest<{ display_phone_number?: string; verified_name?: string }>({
				path: phoneNumberId,
				token: accessToken,
				query: { fields: 'display_phone_number,verified_name' }
			});
			displayPhoneNumber = num.display_phone_number ?? displayPhoneNumber;
			businessName = num.verified_name ?? businessName;
		} catch (err) {
			log.warn('phone_ownership_check_failed', {
				tenantId: params.tenantId,
				phoneNumberId,
				message: (err as Error)?.message
			});
			return { ok: false, error: 'number_not_accessible', code: 'number_not_accessible', status: 403 };
		}

		// 4. Even with a valid token, refuse a number already owned by a DIFFERENT tenant.
		//    Without this the upsert would silently transfer ownership — and with it every
		//    inbound message for that number — to the caller. Re-connecting your own
		//    number is fine.
		const existing = await getConnectionByPhoneNumberId(phoneNumberId);
		if (existing && existing.tenantId !== params.tenantId) {
			log.warn('number_owned_by_other_tenant', { phoneNumberId, owner: existing.tenantId, attempted: params.tenantId });
			return { ok: false, error: 'number_already_connected', code: 'number_already_connected', status: 409 };
		}

		// 5. Owning business id — best effort, purely informational.
		let metaBusinessId: string | null = null;
		if (wabaId) {
			try {
				const waba = await appGraphRequest<{ owner_business_info?: { id?: string } }>({
					path: wabaId,
					token: accessToken,
					query: { fields: 'id,name,owner_business_info' }
				});
				metaBusinessId = waba?.owner_business_info?.id ?? null;
			} catch (err) {
				log.warn('waba_details_failed', { wabaId, message: (err as Error)?.message });
			}
		}

		// 6. Register the number on Cloud API. Idempotent — "already registered" is fine.
		try {
			const pin = String(crypto.randomInt(100000, 999999));
			await appGraphRequest({
				path: `${phoneNumberId}/register`,
				method: 'POST',
				token: accessToken,
				body: { messaging_product: 'whatsapp', pin }
			});
		} catch (err) {
			log.warn('phone_register_note', { phoneNumberId, message: (err as Error)?.message });
		}

		// 7. Subscribe our app to this WABA's webhooks so inbound events reach us.
		if (wabaId) {
			try {
				await appGraphRequest({ path: `${wabaId}/subscribed_apps`, method: 'POST', token: accessToken });
			} catch (err) {
				log.warn('subscribe_app_failed', { wabaId, message: (err as Error)?.message });
			}
		}

		// 8. Store the encrypted credential.
		const connection = await upsertConnection({
			tenantId: params.tenantId,
			metaBusinessId,
			wabaId: wabaId ?? null,
			phoneNumberId,
			displayPhoneNumber,
			businessName,
			accessToken,
			tokenExpiresAt
		});

		log.info('embedded_signup_connected', { tenantId: params.tenantId, phoneNumberId, businessName });
		return { ok: true, connection };
	} catch (err) {
		const apiError = err instanceof WhatsAppApiError ? err : null;
		log.error('embedded_signup_failed', {
			tenantId: params.tenantId,
			error: (err as Error)?.message,
			status: apiError?.status,
			code: apiError?.code
		});
		return {
			ok: false,
			error: (err as Error)?.message ?? 'exchange_failed',
			status: apiError?.status ?? 502,
			code: String(apiError?.code ?? 'meta_api_error')
		};
	}
}
