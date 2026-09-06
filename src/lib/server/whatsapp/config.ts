// Meta / WhatsApp Cloud API configuration (§7). Nothing here is hardcoded and nothing
// is exported to the browser — META_APP_SECRET in particular never leaves the server.
import { env } from '../env';

export const GRAPH_BASE = 'https://graph.facebook.com';

export function metaAppConfig() {
	const e = env();
	return {
		appId: e.META_APP_ID,
		appSecret: e.META_APP_SECRET,
		configId: e.WHATSAPP_CONFIG_ID, // Facebook Login for Business configuration
		graphVersion: e.META_GRAPH_VERSION,
		verifyToken: e.WHATSAPP_VERIFY_TOKEN,
		graphBase: GRAPH_BASE
	};
}

/** Safe subset that MAY be sent to a browser to launch the Embedded Signup popup. */
export function publicSignupConfig() {
	const c = metaAppConfig();
	return { appId: c.appId, configId: c.configId, graphVersion: c.graphVersion };
}

/** Where Meta sends the browser back after the hosted flow. Must be listed in the
 *  Meta app under Facebook Login for Business → Settings → Valid OAuth Redirect URIs,
 *  or Meta answers "URL Blocked" before the dialog ever opens. */
export function signupRedirectUri() {
	return `${env().PUBLIC_APP_URL.replace(/\/+$/, '')}/connect/whatsapp`;
}

/**
 * Meta's own hosted Embedded Signup page — the second door onto the same flow.
 *
 * The JS SDK opens a popup from our domain; this one hands the whole dialog to
 * business.facebook.com and returns with the authorization code in the URL. It needs
 * no SDK script and survives popup blockers, which makes it the reliable path on
 * mobile — and it is the flow Meta issues a link for.
 *
 * `state` is round-tripped verbatim, so it is what makes the return leg safe: it
 * carries our single-use, tenant-bound onboarding token. A code that comes back
 * without one did not start here and is refused.
 *
 * featureType is deliberately empty, matching the SDK call in the launcher, so both
 * doors run the SAME onboarding and land on the exchange path this server already
 * implements. Meta's coexistence variant ("whatsapp_business_app_onboarding") is a
 * different flow — change it here, in one place, if that is ever what we want.
 */
export function hostedSignupUrl(params: { state: string; redirectUri?: string }) {
	const c = metaAppConfig();
	if (!c.appId || !c.configId) return null;
	const query = new URLSearchParams({
		app_id: c.appId,
		config_id: c.configId,
		redirect_uri: params.redirectUri ?? signupRedirectUri(),
		state: params.state,
		extras: JSON.stringify({ version: 'v4', sessionInfoVersion: '3', featureType: '' })
	});
	return `https://business.facebook.com/messaging/whatsapp/onboard/?${query.toString()}`;
}

export type WhatsAppCredentials = {
	accessToken: string;
	phoneNumberId: string;
	wabaId: string;
	apiVersion: string;
	graphBase: string;
	tenantId: string;
	connectionId: string;
};
