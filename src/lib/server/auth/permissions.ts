// Server-side permission matrix (§23). The UI may hide controls, but every mutation
// re-checks here — hidden buttons are not authorization.
import type { Role } from '../db/schema';
import { AppError } from '../errors';

export const PERMISSIONS = [
	'tenant:read',
	'tenant:write',
	'members:read',
	'members:write',
	'api_keys:read',
	'api_keys:write',
	'whatsapp:read',
	'whatsapp:connect',
	'whatsapp:send',
	'customers:read',
	'customers:write',
	'leads:read',
	'leads:write',
	'conversations:read',
	'conversations:write',
	'booking_requests:read',
	'booking_requests:write',
	'bookings:read',
	'bookings:write',
	'quotations:read',
	'quotations:write',
	'payments:read',
	'payments:write',
	'orders:read',
	'orders:write',
	'catalog:read',
	'catalog:write',
	'forms:read',
	'forms:write',
	'travelers:read_sensitive', // §15 passport data
	'webhooks:read',
	'webhooks:write',
	'billing:read',
	'billing:write',
	'audit:read'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const READ_ONLY: Permission[] = [
	'orders:read',
	'catalog:read',
	'forms:read',
	'tenant:read',
	'members:read',
	'whatsapp:read',
	'customers:read',
	'leads:read',
	'conversations:read',
	'booking_requests:read',
	'bookings:read',
	'quotations:read',
	'payments:read',
	'webhooks:read',
	'billing:read'
];

const SALES: Permission[] = [
	...READ_ONLY,
	'orders:write',
	'catalog:write',
	'customers:write',
	'leads:write',
	'conversations:write',
	'booking_requests:write',
	'quotations:write',
	'whatsapp:send'
];

const BOOKING_AGENT: Permission[] = [...SALES, 'bookings:write', 'payments:write', 'travelers:read_sensitive'];

const ADMIN: Permission[] = [
	...BOOKING_AGENT,
	'forms:write',
	'tenant:write',
	'members:write',
	'api_keys:read',
	'api_keys:write',
	'whatsapp:connect',
	'webhooks:write',
	'audit:read'
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
	SUPER_ADMIN: ALL,
	OWNER: ALL,
	ADMIN,
	BOOKING_AGENT,
	SALES,
	VIEWER: READ_ONLY
};

export function permissionsForRole(role: Role): Permission[] {
	return [...new Set(ROLE_PERMISSIONS[role] ?? READ_ONLY)];
}

export function can(permissions: readonly Permission[] | undefined, permission: Permission): boolean {
	return !!permissions?.includes(permission);
}

/** Throw FORBIDDEN unless the permission is held. Use in every server action/route. */
export function requirePermission(permissions: readonly Permission[] | undefined, permission: Permission): void {
	if (!can(permissions, permission)) {
		throw new AppError('FORBIDDEN', `Missing required permission: ${permission}`);
	}
}

/* ---- API key scopes (§6) map onto the same permission vocabulary ------------ */

export const API_SCOPES = [
	'orders:read',
	'orders:write',
	'catalog:read',
	'catalog:write',
	'bookings:read',
	'bookings:write',
	'booking_requests:read',
	'booking_requests:write',
	'leads:read',
	'leads:write',
	'customers:read',
	'customers:write',
	'conversations:read',
	'whatsapp:read',
	'whatsapp:send',
	'quotations:read',
	'quotations:write',
	'payments:read'
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const DEFAULT_API_SCOPES: ApiScope[] = [
	'booking_requests:read',
	'booking_requests:write',
	'bookings:read',
	'customers:read',
	'customers:write',
	'leads:read',
	'leads:write',
	'whatsapp:read',
	'whatsapp:send',
	'quotations:read'
];

export function isValidScope(scope: string): scope is ApiScope {
	return (API_SCOPES as readonly string[]).includes(scope);
}

/** Throw INSUFFICIENT_SCOPE unless the key carries the scope. */
export function requireScope(scopes: readonly string[] | undefined, scope: ApiScope): void {
	if (!scopes?.includes(scope)) {
		throw new AppError('INSUFFICIENT_SCOPE', `This API key is missing the required scope: ${scope}`);
	}
}
