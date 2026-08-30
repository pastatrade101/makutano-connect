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
	// Publishing a public order entry point is not the same as processing orders.
	'order_links:read',
	'order_links:write',
	'order_links:archive',
	'catalog:read',
	'catalog:write',
	'forms:read',
	'forms:write',
	'travelers:read_sensitive', // §15 passport data
	// Operations. Deliberately separate from bookings:* — the person confirming a
	// hotel has no reason to see or move money, and the person who sold the trip
	// has no reason to reassign a driver.
	'trips:read',
	'trips:write',
	'trips:assign',
	'webhooks:read',
	'webhooks:write',
	'billing:read',
	'billing:write',
	'audit:read',
	// Inbox visibility & control (§team-access): base conversations:read grants TEAM
	// threads + own assignments; these widen or manage that scope.
	'conversations:view_all',
	'conversations:view_private',
	'conversations:assign',
	// Erasing a customer's message history is an owner/admin act, not a daily one.
	'conversations:delete',
	// High-risk payment capabilities, deliberately separate from payments:write.
	'payments:request',
	'payments:verify',
	'payments:refund',
	// Authoring templates is not the same as sending with them.
	'whatsapp:templates'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const READ_ONLY: Permission[] = [
	'orders:read',
	'trips:read',
	'order_links:read',
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

// Presented in the UI as "Manager": runs the office day-to-day.
const BOOKING_AGENT: Permission[] = [
	...SALES,
	// Publishing a public order entry point stays a Manager+ decision (§28).
	'order_links:write',
	'bookings:write',
	'payments:write',
	'travelers:read_sensitive',
	'conversations:view_all',
	'conversations:assign',
	'payments:request',
	'payments:verify',
	// A manager may run a trip and hand one over. Sales deliberately may not:
	// closing a sale and preparing a departure are different jobs.
	'trips:write',
	'trips:assign'
];

/**
 * Operations: prepares trips and nothing else.
 *
 * The narrowest role in the product, and narrow on purpose. Someone confirming a
 * hotel needs traveller passports and the trip; they do not need to see revenue,
 * price a quotation or verify a payment. Everything commercial is read-only here.
 */
const OPERATIONS: Permission[] = [
	...READ_ONLY,
	'trips:write',
	'trips:assign',
	'travelers:read_sensitive',
	'customers:write',
	'conversations:write',
	'whatsapp:send'
];

const ADMIN: Permission[] = [
	...BOOKING_AGENT,
	'conversations:delete',
	'forms:write',
	'tenant:write',
	'members:write',
	'api_keys:read',
	'api_keys:write',
	'whatsapp:connect',
	'whatsapp:templates',
	'webhooks:write',
	'audit:read',
	'conversations:view_private',
	'payments:refund',
	'order_links:archive'
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
	SUPER_ADMIN: ALL,
	OWNER: ALL,
	ADMIN,
	BOOKING_AGENT,
	OPERATIONS,
	SALES,
	VIEWER: READ_ONLY
};

export function permissionsForRole(role: Role): Permission[] {
	return [...new Set(ROLE_PERMISSIONS[role] ?? READ_ONLY)];
}

/**
 * Role defaults + the member's sparse overrides (§4-§5). Overrides are IGNORED for
 * owners: an owner can never lock themselves out of their own tenant (§12). Plan
 * entitlements are checked separately at every point of use and always win (§6).
 */
export function effectivePermissions(role: Role, overrides: Record<string, boolean> | null | undefined): Permission[] {
	const base = new Set(permissionsForRole(role));
	if (role === 'OWNER' || role === 'SUPER_ADMIN' || !overrides) return [...base];
	for (const [key, granted] of Object.entries(overrides)) {
		if (!(PERMISSIONS as readonly string[]).includes(key)) continue; // unknown keys never grant anything
		if (granted) base.add(key as Permission);
		else base.delete(key as Permission);
	}
	return [...base];
}

/** True when the member's permissions differ from their role defaults. */
export function isCustomized(role: Role, overrides: Record<string, boolean> | null | undefined): boolean {
	if (!overrides || role === 'OWNER' || role === 'SUPER_ADMIN') return false;
	const defaults = new Set(permissionsForRole(role));
	return Object.entries(overrides).some(([key, granted]) => {
		if (!(PERMISSIONS as readonly string[]).includes(key)) return false;
		return granted !== defaults.has(key as Permission);
	});
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
	'payments:read',
	// Operations, so a tour operator's own ops tooling can read and prepare trips.
	// Deliberately NOT in DEFAULT_API_SCOPES: a key minted for a website form has
	// no business assigning drivers.
	'trips:read',
	'trips:write',
	// Passport data over the API is opt-in, never a default.
	'travelers:read_sensitive'
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
