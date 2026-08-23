// Consistent internal error codes and JSON envelopes (§24, §33). Every API route
// returns either {success:true,data} or {success:false,error:{code,message}} — never
// a stack trace (§29).
import { json } from '@sveltejs/kit';

export const ErrorCodes = {
	TENANT_NOT_FOUND: 404,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	API_KEY_INVALID: 401,
	API_KEY_REVOKED: 401,
	API_KEY_EXPIRED: 401,
	INSUFFICIENT_SCOPE: 403,
	WHATSAPP_NOT_CONNECTED: 409,
	META_API_ERROR: 502,
	BOOKING_NOT_FOUND: 404,
	BOOKING_REQUEST_NOT_FOUND: 404,
	QUOTATION_NOT_FOUND: 404,
	CUSTOMER_NOT_FOUND: 404,
	LEAD_NOT_FOUND: 404,
	CONVERSATION_NOT_FOUND: 404,
	PAYMENT_NOT_FOUND: 404,
	PAYMENT_FAILED: 402,
	VALIDATION_ERROR: 422,
	RATE_LIMITED: 429,
	IDEMPOTENCY_CONFLICT: 409,
	CONFLICT: 409,
	PLAN_LIMIT_REACHED: 402,
	ENTITLEMENT_LIMIT_REACHED: 402,
	FEATURE_NOT_AVAILABLE: 402,
	TENANT_SUSPENDED: 403,
	SUBSCRIPTION_INACTIVE: 402,
	WHATSAPP_POLICY_BLOCKED: 422,
	NOT_FOUND: 404,
	INTERNAL_ERROR: 500,
	NOT_CONFIGURED: 503
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly details: unknown;

	constructor(code: ErrorCode, message: string, details: unknown = null) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.status = ErrorCodes[code];
		this.details = details;
	}
}

export const fail = (code: ErrorCode, message: string, details: unknown = null) => new AppError(code, message, details);

export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> };
export type ApiFailure = { success: false; error: { code: string; message: string; details?: unknown } };

export function ok<T>(data: T, meta?: Record<string, unknown>, init?: ResponseInit) {
	const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
	return json(body, init);
}

export function errorResponse(err: unknown, requestId?: string) {
	const e = toAppError(err);
	const body: ApiFailure = {
		success: false,
		error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }
	};
	return json(body, { status: e.status, headers: requestId ? { 'x-request-id': requestId } : undefined });
}

/** Map anything thrown into a safe AppError — never leak internals (§24). */
export function toAppError(err: unknown): AppError {
	if (err instanceof AppError) return err;
	if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
		// SvelteKit HttpError
		const he = err as { status: number; body: { message?: string } };
		const code = (Object.keys(ErrorCodes) as ErrorCode[]).find((k) => ErrorCodes[k] === he.status) ?? 'INTERNAL_ERROR';
		return new AppError(code, he.body?.message ?? 'Request failed');
	}
	return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
}
