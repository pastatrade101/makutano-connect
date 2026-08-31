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

/** Never store or log a raw address — the hash is enough to rate-limit by. */
export function clientKey(event: RequestEvent): string {
	try {
		return sha256(event.getClientAddress()).slice(0, 24);
	} catch {
		return 'unknown';
	}
}

/**
 * Reference data (countries, destinations) changes rarely and is read on every
 * page; listings change when an operator publishes. Both are cached at the edge
 * for long enough to matter and short enough that a new listing appears quickly.
 */
export const CACHE_REFERENCE = 'public, max-age=300, stale-while-revalidate=600';
export const CACHE_LISTING = 'public, max-age=60, stale-while-revalidate=300';

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
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
