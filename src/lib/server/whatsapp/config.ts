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

export type WhatsAppCredentials = {
	accessToken: string;
	phoneNumberId: string;
	wabaId: string;
	apiVersion: string;
	graphBase: string;
	tenantId: string;
	connectionId: string;
};
