// Shared plumbing for the UNAUTHENTICATED marketplace API.
//
// Every endpoint under /api/public/* is reachable by anyone, so the things that
// must never be forgotten live here rather than being retyped six times: the
// CORS header the marketplace site needs, a rate limit keyed on a HASH of the
// caller's address, and an error path that cannot leak a stack trace.
//
// There is deliberately NO tenant plumbing in this file. A public caller names a
// slug; the server resolves who owns it. Nothing here reads a tenant id from a
// request, and nothing should ever be added that does.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { AppError, errorResponse, toAppError } from './errors';
import { enforce } from './rate-limit';
import { sha256 } from './encryption';
import { log } from './logger';
import { env } from './env';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Headers a trusted first-party origin uses to speak for the person it relays. */
const ORIGIN_SECRET_HEADER = 'x-makutano-origin-secret';
const ORIGIN_CLIENT_IP_HEADER = 'x-makutano-client-ip';

/**
 * Longest plausible address. An IPv6 address with a zone is 45 characters; this
 * is generous and still refuses a header used as a smuggling channel.
 */
const MAX_ADDRESS_LENGTH = 64;
/** Hex, digits, dots, colons — everything a v4 or v6 address needs, nothing else. */
const ADDRESS_SHAPE = /^[0-9a-fA-F.:%]+$/;

/**
 * Compare secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the buffers are always the same length, which
 * timingSafeEqual requires and which stops the comparison revealing the secret's
 * length.
 */
function secretMatches(presented: string | null): boolean {
	const expected = env().ORIGIN_SHARED_SECRET;
	// No secret configured means the feature is off. Never treat "" as a match.
	if (!expected || !presented) return false;
	const a = createHash('sha256').update(presented).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

/**
 * Who the rate limiter should count this request against.
 *
 * Normally the peer address, hashed — never stored or logged raw.
 *
 * THE RELAY CASE. The marketplace submits enquiries from a SERVER-SIDE form
 * action, so Connect sees the marketplace container for every traveller on the
 * internet. That collapsed the whole public into one bucket of ten per ten
 * minutes: the eleventh traveller in that window would have been told "Too many
 * requests" and lost their enquiry, having done nothing wrong. (Browsing is
 * unaffected — those loads run in the traveller's own browser, which is why
 * production shows sixteen distinct keys for tours and none for enquiries.)
 *
 * So a trusted origin may name the person it is relaying — but ONLY when it
 * proves who it is with the shared secret. Without a valid secret the header is
 * ignored completely, because a rate limiter that believes an unauthenticated
 * "here is my IP" header is not a rate limiter at all: anyone could send a fresh
 * value per request and never be limited.
 */
export function clientKey(event: RequestEvent): string {
	try {
		const forwarded = relayedAddress(event);
		return sha256(forwarded ?? event.getClientAddress()).slice(0, 24);
	} catch {
		return 'unknown';
	}
}

/** The address a trusted origin vouched for, or null — null meaning "use the peer". */
function relayedAddress(event: RequestEvent): string | null {
	if (!secretMatches(event.request.headers.get(ORIGIN_SECRET_HEADER))) return null;
	const raw = event.request.headers.get(ORIGIN_CLIENT_IP_HEADER)?.trim();
	// A trusted origin that sends nothing usable gets the peer key, not a pass.
	if (!raw || raw.length > MAX_ADDRESS_LENGTH || !ADDRESS_SHAPE.test(raw)) return null;
	return raw;
}

/**
 * Reference data (countries, destinations) changes rarely and is read on every
 * page; listings change when an operator publishes. Both are cached at the edge
 * for long enough to matter and short enough that a new listing appears quickly.
 */
export const CACHE_REFERENCE = 'public, max-age=300, stale-while-revalidate=600';
export const CACHE_LISTING = 'public, max-age=60, stale-while-revalidate=300';

/*
 * PATCH is here because the review endpoint exports it — a traveller editing a
 * review they already submitted. Without it the browser's preflight rejects the
 * edit before it is ever sent, and the failure reads as a CORS error rather than
 * anything about reviews. Every method any public endpoint exports has to be
 * listed here or it cannot be called cross-origin from the marketplace.
 */
const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
	'access-control-allow-headers': 'content-type'
};

export function publicJson(data: unknown, cacheControl: string, meta?: Record<string, unknown>): Response {
	return json({ success: true, data, ...(meta ? { meta } : {}) }, { headers: { ...CORS, 'cache-control': cacheControl } });
}

/** CORS has to be on the error too, or the browser reports a CORS failure instead of the 404. */
function publicError(err: unknown, requestId?: string | null): Response {
	const res = errorResponse(toAppError(err), requestId ?? undefined);
	for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
	res.headers.set('cache-control', 'no-store');
	return res;
}

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

type HandleOptions = {
	/** Requests allowed per window, per hashed address. */
	limit?: number;
	windowSeconds?: number;
	scope: string;
};

/**
 * One error boundary for every public endpoint.
 *
 * Anything unexpected becomes a 500 with no detail; the detail goes to the log.
 * A public marketplace is the wrong place to discover that an error message
 * quoted a column name.
 */
export async function handlePublic(
	event: RequestEvent,
	opts: HandleOptions,
	fn: () => Promise<Response>
): Promise<Response> {
	try {
		await enforce(`${opts.scope}:${clientKey(event)}`, opts.limit ?? 120, opts.windowSeconds ?? 60);
		return await fn();
	} catch (err) {
		const appError = toAppError(err);
		if (appError.status >= 500) {
			log.error('public_api_error', { path: event.url.pathname, message: (err as Error)?.message });
		}
		return publicError(err, event.locals.requestId);
	}
}

/**
 * A slug from a URL segment.
 *
 * Bounded and character-restricted before it reaches a query — not because the
 * driver would be unsafe, but because a 4KB "slug" is a pointless database round
 * trip and an obvious probe.
 */
const slugSchema = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Not a valid slug.');

export function parseSlug(value: string | undefined): string {
	const parsed = slugSchema.safeParse((value ?? '').toLowerCase());
	// A malformed slug is indistinguishable from one that does not exist. Saying
	// "invalid" instead of "not found" would tell a prober which shapes are real.
	if (!parsed.success) throw new AppError('NOT_FOUND', 'Not found.');
	return parsed.data;
}

/**
 * Public pagination, with its own ceiling.
 *
 * The portal's helper allows 100 per page behind an API key. Anonymous callers
 * get 48 — enough for any page the site renders, low enough that the endpoint is
 * not a convenient way to copy the whole catalogue.
 */
export const publicPageSchema = z.object({
	page: z.coerce.number().int().min(1).max(500).default(1),
	perPage: z.coerce.number().int().min(1).max(48).default(24)
});

export function publicPagination(url: URL): { page: number; limit: number; sort?: string; order: 'asc' | 'desc' } {
	const parsed = publicPageSchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		perPage: url.searchParams.get('perPage') ?? undefined
	});
	if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid pagination.');
	return { page: parsed.data.page, limit: parsed.data.perPage, order: 'desc' };
}

export function pageMeta(page: number, limit: number, total: number) {
	return { page, perPage: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
