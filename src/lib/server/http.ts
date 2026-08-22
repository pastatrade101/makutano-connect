// Shared HTTP plumbing for /api/v1 (§24): a single error boundary, Zod-validated
// input, consistent pagination and the tenant/scope guards every external route uses.
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { AppError, errorResponse, ok, toAppError } from './errors';
import { log } from './logger';
import { recordUsage } from './billing';
import type { ApiScope } from './auth/permissions';
import { requireScope } from './auth/permissions';

export type ApiContext = {
	tenantId: string;
	tenantName: string;
	apiKeyId: string;
	scopes: string[];
	requestId: string;
};

/** The tenant is taken from the authenticated API key — never from the payload (§3). */
export function apiContext(event: RequestEvent): ApiContext {
	const { tenant, apiKey, requestId } = event.locals;
	if (!tenant || !apiKey) throw new AppError('API_KEY_INVALID', 'A valid API key is required.');
	return { tenantId: tenant.id, tenantName: tenant.name, apiKeyId: apiKey.id, scopes: apiKey.scopes, requestId };
}

export function requireApiScope(event: RequestEvent, scope: ApiScope): ApiContext {
	const ctx = apiContext(event);
	requireScope(ctx.scopes, scope);
	return ctx;
}

/** Wrap a route handler so nothing but a typed JSON envelope ever escapes (§24, §29). */
export async function handle(event: RequestEvent, fn: () => Promise<Response>): Promise<Response> {
	try {
		const response = await fn();
		if (event.locals.tenant) void recordUsage(event.locals.tenant.id, 'api_requests');
		return response;
	} catch (err) {
		const appError = toAppError(err);
		if (appError.status >= 500) {
			log.error('api_unhandled_error', {
				requestId: event.locals.requestId,
				path: event.url.pathname,
				message: (err as Error)?.message
			});
		} else {
			log.info('api_error', { requestId: event.locals.requestId, path: event.url.pathname, code: appError.code });
		}
		return errorResponse(appError, event.locals.requestId);
	}
}

export async function parseBody<T extends z.ZodTypeAny>(event: RequestEvent, shape: T): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch {
		throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
	}
	const parsed = shape.safeParse(raw);
	if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed.', issues(parsed.error));
	return parsed.data;
}

export function parseQuery<T extends z.ZodTypeAny>(url: URL, shape: T): z.infer<T> {
	const object: Record<string, string> = {};
	for (const [k, v] of url.searchParams.entries()) object[k] = v;
	const parsed = shape.safeParse(object);
	if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Query validation failed.', issues(parsed.error));
	return parsed.data;
}

export function parseUuid(value: string, label = 'id'): string {
	const parsed = z.string().uuid().safeParse(value);
	if (!parsed.success) throw new AppError('VALIDATION_ERROR', `Invalid ${label}.`);
	return parsed.data;
}

function issues(error: z.ZodError) {
	return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/* --------------------------------------------------------- pagination ----- */

export const paginationSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(25),
	sort: z.string().optional(),
	order: z.enum(['asc', 'desc']).default('desc'),
	q: z.string().trim().max(200).optional()
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationFrom(url: URL): Pagination {
	return parseQuery(url, paginationSchema);
}

export function listResponse<T>(items: T[], total: number, pagination: Pagination) {
	return ok(items, {
		page: pagination.page,
		limit: pagination.limit,
		total,
		totalPages: Math.max(1, Math.ceil(total / pagination.limit))
	});
}

export function offsetOf(p: Pagination): number {
	return (p.page - 1) * p.limit;
}

export function idempotencyKeyOf(event: RequestEvent): string | null {
	const key = event.request.headers.get('idempotency-key');
	return key && key.length <= 255 ? key : null;
}

export { ok };
