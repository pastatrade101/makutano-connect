// The one place that speaks HTTP to the Meta Graph API. Every sender goes through
// graphRequest(): timeouts, typed errors, and exponential-backoff retries for
// transient failures only. Ported from the working single-tenant implementation.
import { log } from '../logger';
import { metaAppConfig } from './config';
import type { WhatsAppCredentials } from './config';

export class WhatsAppApiError extends Error {
	readonly status: number;
	readonly code: number | string | null;
	readonly details: unknown;
	readonly retryable: boolean;

	constructor(
		message: string,
		opts: { status?: number; code?: number | string | null; details?: unknown; retryable?: boolean } = {}
	) {
		super(message);
		this.name = 'WhatsAppApiError';
		this.status = opts.status ?? 0;
		this.code = opts.code ?? null;
		this.details = opts.details ?? null;
		this.retryable = opts.retryable ?? false;
	}
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffDelay(attempt: number, retryAfterHeader?: string | null): number {
	const retryAfter = Number(retryAfterHeader);
	if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30_000);
	return Math.min(8000, 2 ** (attempt - 1) * 500) + Math.floor(Math.random() * 250);
}

export async function graphRequest<T = Record<string, unknown>>(params: {
	credentials: Pick<WhatsAppCredentials, 'accessToken' | 'apiVersion' | 'graphBase'>;
	path: string;
	method?: 'GET' | 'POST' | 'DELETE';
	query?: Record<string, string>;
	body?: Record<string, unknown> | null;
	retries?: number;
	timeoutMs?: number;
}): Promise<T> {
	const { credentials, path, method = 'POST', query, body = null, retries = 3, timeoutMs = 15_000 } = params;
	if (!credentials?.accessToken) {
		throw new WhatsAppApiError('WhatsApp is not configured for this tenant.', { code: 'not_configured' });
	}
	const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
	const url = `${credentials.graphBase}/${credentials.apiVersion}/${path}${qs}`;
	let lastError: WhatsAppApiError | null = null;

	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				method,
				headers: {
					Authorization: `Bearer ${credentials.accessToken}`,
					...(body ? { 'Content-Type': 'application/json' } : {})
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal
			});
			// Read the body BEFORE clearing the timer: fetch resolves on headers, so the
			// abort timer must still cover a stalled body or timeoutMs is meaningless.
			const rawText = await res.text();
			clearTimeout(timer);

			let json: Record<string, unknown>;
			try {
				json = rawText ? JSON.parse(rawText) : {};
			} catch {
				json = { raw: rawText };
			}

			if (res.ok) return json as T;

			const apiError = (json?.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
			const retryable = RETRYABLE_STATUS.has(res.status);
			log.warn('graph_api_error', {
				status: res.status,
				code: apiError.code,
				subcode: apiError.error_subcode,
				message: apiError.message,
				attempt,
				path
			});

			if (retryable && attempt <= retries) {
				await sleep(backoffDelay(attempt, res.headers.get('retry-after')));
				continue;
			}
			throw new WhatsAppApiError(apiError.message || `WhatsApp API error (HTTP ${res.status})`, {
				status: res.status,
				code: apiError.code ?? null,
				details: apiError,
				retryable
			});
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof WhatsAppApiError) throw err;
			const isTimeout = (err as Error)?.name === 'AbortError';
			lastError = new WhatsAppApiError(
				isTimeout ? 'WhatsApp request timed out' : `Network error: ${(err as Error)?.message}`,
				{
					code: isTimeout ? 'timeout' : 'network',
					retryable: true
				}
			);
			log.warn('graph_transport_error', { kind: isTimeout ? 'timeout' : 'network', attempt, path });
			if (attempt <= retries) {
				await sleep(backoffDelay(attempt));
				continue;
			}
			throw lastError;
		}
	}
	throw lastError ?? new WhatsAppApiError('WhatsApp request failed', { code: 'unknown' });
}

/** App-level Graph call (app access token) — used by Embedded Signup, not by sending. */
export async function appGraphRequest<T = Record<string, unknown>>(params: {
	path: string;
	method?: 'GET' | 'POST';
	query?: Record<string, string>;
	body?: Record<string, unknown> | null;
	token?: string;
}): Promise<T> {
	const cfg = metaAppConfig();
	return graphRequest<T>({
		credentials: {
			accessToken: params.token ?? `${cfg.appId}|${cfg.appSecret}`,
			apiVersion: cfg.graphVersion,
			graphBase: cfg.graphBase
		},
		path: params.path,
		method: params.method ?? 'GET',
		query: params.query,
		body: params.body ?? null,
		retries: 1
	});
}
