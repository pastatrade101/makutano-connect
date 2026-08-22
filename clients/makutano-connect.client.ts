// Drop-in client for Goldfinch's Express backend (Phase 5).
//
// Copy to tour-website/backend/src/services/makutano-connect.service.ts and set:
//   MAKUTANO_API_URL=https://connect.makutano.co.tz
//   MAKUTANO_API_KEY=mk_live_…      (server-only — never send it to a browser)
//
// This replaces Goldfinch's direct Meta integration. Goldfinch no longer needs
// WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID or
// WHATSAPP_APP_SECRET: Connect owns the Meta layer and resolves Goldfinch's tenant and
// WhatsApp connection from the API key alone.
//
// Note what is deliberately absent: there is no way to pass a tenant id, a
// phone_number_id, or a WABA. A client cannot address another tenant's number even by
// accident, because the wire format has no field for it.

export class MakutanoConnectError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
		readonly details?: unknown
	) {
		super(message);
		this.name = 'MakutanoConnectError';
	}
}

type Envelope<T> =
	| { success: true; data: T; meta?: Record<string, unknown> }
	| { success: false; error: { code: string; message: string; details?: unknown } };

const baseUrl = () => (process.env.MAKUTANO_API_URL ?? '').replace(/\/+$/, '');
const apiKey = () => process.env.MAKUTANO_API_KEY ?? '';

export const isConfigured = (): boolean => Boolean(baseUrl() && apiKey());

async function request<T>(
	path: string,
	init: {
		method?: string;
		body?: unknown;
		idempotencyKey?: string;
		query?: Record<string, string | number | undefined>;
	} = {}
): Promise<T> {
	if (!isConfigured()) {
		throw new MakutanoConnectError('NOT_CONFIGURED', 'MAKUTANO_API_URL / MAKUTANO_API_KEY are not set.', 503);
	}

	const url = new URL(`${baseUrl()}/api/v1${path}`);
	for (const [k, v] of Object.entries(init.query ?? {})) {
		if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await fetch(url, {
			method: init.method ?? 'GET',
			headers: {
				Authorization: `Bearer ${apiKey()}`,
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				// Makes a retry after a timeout safe: Connect replays the original result
				// rather than creating a second booking request or sending twice.
				...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {})
			},
			body: init.body ? JSON.stringify(init.body) : undefined,
			signal: controller.signal
		});

		const payload = (await res.json().catch(() => null)) as Envelope<T> | null;
		if (!payload) {
			throw new MakutanoConnectError(
				'BAD_RESPONSE',
				`Makutano Connect returned a non-JSON response (HTTP ${res.status}).`,
				res.status
			);
		}
		if (!payload.success) {
			throw new MakutanoConnectError(payload.error.code, payload.error.message, res.status, payload.error.details);
		}
		return payload.data;
	} catch (err) {
		if (err instanceof MakutanoConnectError) throw err;
		const timedOut = (err as Error)?.name === 'AbortError';
		throw new MakutanoConnectError(
			timedOut ? 'TIMEOUT' : 'NETWORK',
			timedOut ? 'Makutano Connect timed out.' : `Network error: ${(err as Error).message}`,
			504
		);
	} finally {
		clearTimeout(timer);
	}
}

/* ---- identity ----------------------------------------------------------- */

export const whoAmI = () =>
	request<{
		tenant: { id: string; name: string };
		plan: { code: string; features: Record<string, boolean>; limits: Record<string, number> };
		whatsapp: { connected: boolean; displayPhoneNumber: string | null };
	}>('/me');

/* ---- outbound WhatsApp (Phase 4) ---------------------------------------- */

export type OutboundContent =
	| { type: 'text'; text: string; previewUrl?: boolean }
	| { type: 'template'; templateName: string; language?: string; components?: unknown[] }
	| { type: 'image'; link: string; caption?: string }
	| { type: 'document'; link: string; filename?: string; caption?: string };

/**
 * Send a WhatsApp message. Recipient, type and content only — Connect resolves which
 * number it goes out from. Accepted asynchronously (202): Connect persists the message
 * and dispatches it on its queue, so Meta being slow never blocks a Goldfinch request.
 */
export const sendWhatsApp = (params: { to: string; content: OutboundContent; idempotencyKey?: string }) =>
	request<{ id: string; conversationId: string; status: string; to: string }>('/whatsapp/messages', {
		method: 'POST',
		body: { to: params.to, content: params.content },
		idempotencyKey: params.idempotencyKey
	});

export const whatsappConnection = () =>
	request<{
		connected: boolean;
		connection: { displayPhoneNumber: string | null; status: string; lastWebhookAt: string | null } | null;
	}>('/whatsapp/connection');

/* ---- inbox (Phase 5: Goldfinch keeps its CMS, Connect holds the data) ---- */

export const listConversations = (params: { page?: number; limit?: number; open?: boolean } = {}) =>
	request<Array<Record<string, unknown>>>('/conversations', {
		query: { page: params.page, limit: params.limit, open: params.open === undefined ? undefined : String(params.open) }
	});

export const listMessages = (conversationId: string, params: { page?: number; limit?: number } = {}) =>
	request<Array<Record<string, unknown>>>(`/conversations/${conversationId}/messages`, { query: params });

/* ---- enquiries, customers, leads ---------------------------------------- */

export type BookingRequestInput = {
	customer: {
		firstName?: string;
		lastName?: string;
		email?: string | null;
		phone?: string | null;
		whatsappPhone?: string | null;
		country?: string | null;
	};
	adults?: number;
	children?: number;
	startDate?: string | null;
	endDate?: string | null;
	estimatedTotal?: string | null;
	notes?: string | null;
	items?: Array<{
		title: string;
		quantity?: number;
		unitPrice?: string | null;
		externalReference?: string | null;
		externalSource?: string | null;
	}>;
};

/**
 * Submit a website enquiry. Connect matches or creates the customer, opens a lead,
 * links the WhatsApp conversation and sends the acknowledgement — the whole §17 chain.
 *
 * Pass a stable idempotencyKey (e.g. your own enquiry row id) so a user double-submit
 * or a retry cannot create two enquiries.
 */
export const createBookingRequest = (input: BookingRequestInput, idempotencyKey?: string) =>
	request<{ id: string; reference: string; status: string; conversationId: string | null; leadId: string | null }>(
		'/booking-requests',
		{
			method: 'POST',
			body: { ...input, source: 'WEBSITE', externalSource: 'goldfinch' },
			idempotencyKey
		}
	);

export const listBookingRequests = (params: { page?: number; limit?: number; status?: string; q?: string } = {}) =>
	request<Array<Record<string, unknown>>>('/booking-requests', { query: params });

export const getBookingRequest = (id: string) => request<Record<string, unknown>>(`/booking-requests/${id}`);

export const listCustomers = (params: { page?: number; limit?: number; q?: string } = {}) =>
	request<Array<Record<string, unknown>>>('/customers', { query: params });

export const listLeads = (params: { page?: number; limit?: number; stage?: string } = {}) =>
	request<Array<Record<string, unknown>>>('/leads', { query: params });

/* ---- receiving events from Connect --------------------------------------- */

/**
 * Verify a webhook Connect sends to Goldfinch (header `x-makutano-signature`,
 * format `t=<unix>,v1=<hex>`). Register the endpoint under Developers → Webhooks and
 * store the returned secret as MAKUTANO_WEBHOOK_SECRET.
 *
 * The timestamp window is what stops an attacker replaying a body they captured once.
 */
export function verifyConnectWebhook(
	rawBody: string,
	signatureHeader: string,
	secret: string,
	toleranceSeconds = 300
): boolean {
	const parts = Object.fromEntries(
		String(signatureHeader)
			.split(',')
			.map((p) => p.split('=', 2) as [string, string])
	);
	const timestamp = Number(parts.t);
	if (!Number.isFinite(timestamp)) return false;
	if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const crypto = require('node:crypto') as typeof import('node:crypto');
	const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
	const a = Buffer.from(expected);
	const b = Buffer.from(String(parts.v1 ?? ''));
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}
