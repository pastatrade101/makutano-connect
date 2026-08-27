// Shared plumbing for the mobile API.
//
// The app talks to the SAME session, permissions and visibility rules the browser
// does — this module only shapes them into JSON and keeps the failure envelope
// identical to /api/v1 so one client can handle both.
import { json, type RequestEvent } from '@sveltejs/kit';
import { AppError, toAppError } from './errors';
import type { Permission } from './auth/permissions';

export type MobileViewer = {
	userId: string;
	tenantId: string;
	permissions: readonly string[];
};

export function ok<T>(data: T, init?: ResponseInit): Response {
	return json({ success: true, data }, init);
}

export function problem(error: unknown, requestId?: string | null): Response {
	const appError = toAppError(error);
	// Same envelope and status mapping /api/v1 uses, so one client can handle both.
	return json(
		{ success: false, error: { code: appError.code, message: appError.message, requestId } },
		{ status: appError.status }
	);
}

/** Every mobile route starts here: a real session, a real tenant, real permissions. */
export function requireViewer(event: RequestEvent): MobileViewer {
	if (!event.locals.user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.');
	if (!event.locals.tenant) throw new AppError('TENANT_NOT_FOUND', 'This account has no workspace yet.');
	return {
		userId: event.locals.user.id,
		tenantId: event.locals.tenant.id,
		permissions: event.locals.permissions ?? []
	};
}

export function requirePermissionOrThrow(viewer: MobileViewer, permission: Permission): void {
	if (!viewer.permissions.includes(permission)) {
		throw new AppError('FORBIDDEN', `Missing required permission: ${permission}`);
	}
}
