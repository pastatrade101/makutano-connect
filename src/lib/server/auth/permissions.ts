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
	'forms:read',
	'forms:write',
	'travelers:read_sensitive', // §15 passport data
	// Operations. Deliberately separate from bookings:* — the person confirming a
	// hotel has no reason to see or move money, and the person who sold the trip
	// has no reason to reassign a driver.
	'trips:read',
	'trips:write',
	'trips:assign',
	// The crew list itself. Reading it is part of preparing a trip; editing who
	// works here is an office decision, not a field one.
	'crew:read',
	'crew:write',
	// The fleet list, split the same way as crew and for the same reason: reading
	// it is part of preparing a trip, editing who is in it is an office decision.
	// Tracking deliberately gets NO permission of its own — where a vehicle is, is
	// a property of the trip and of the vehicle, so it is covered by trips:read and
	// vehicles:read. A third key would only be a third thing to forget to grant.
	'vehicles:read',
	'vehicles:write',
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
	'whatsapp:templates',
	// Marketplace listings. Writing one and putting it in front of the public are
	// deliberately separate: a published listing carries the platform's name, not
	// just the operator's, so approval is its own permission.
	'tours:read',
	'tours:write',
	'tours:publish',
	// Traveller reviews. An operator may READ their reviews and answer them; they
	// may never publish, hide, reject or alter one. Moderation carries the
	// platform's name and belongs to the platform — same reasoning as
	// tours:publish, and enforced the same way below.
	'reviews:read',
	'reviews:respond',
	'reviews:moderate'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Everything a TENANT may ever hold.
 *
 * `tours:publish` is deliberately absent. Approving a listing onto the public
 * marketplace is a PLATFORM act — the marketplace carries Makutano's name, not
 * only the operator's — so a vendor cannot approve their own content, and that
 * has to hold for the tenant OWNER too. Owners otherwise receive every
 * permission, so leaving this to the role table alone would have handed it
 * straight back.
 *
 * `reviews:moderate` is absent for the same reason, and it matters more: a
 * traveller's review is the one thing on this marketplace an operator has an
 * obvious motive to remove. An operator may answer a review. Only the platform
 * decides whether it is published.
 */
const PLATFORM_ONLY: Permission[] = ['tours:publish', 'reviews:moderate'];
const TENANT_ALL: Permission[] = ALL.filter((p) => !PLATFORM_ONLY.includes(p));

const READ_ONLY: Permission[] = [
	'tours:read',
	'orders:read',
	'trips:read',
	'crew:read',
	'vehicles:read',
	'order_links:read',
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
	// Writing the listing is sales work. Putting it live is not — see tours:publish.
	'tours:write',
	'orders:write',
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
	'trips:assign',
	'crew:write'
];

/**
 * Operations: prepares trips and nothing else.
 *
 * The narrowest role in the product, and narrow on purpose. Someone confirming a
 * hotel needs traveller passports and the trip; they do not need to see revenue,
 * price a quotation or verify a payment. Everything commercial is read-only here,
 * marketplace listings included: preparing a departure is not writing the advert.
 */
const OPERATIONS: Permission[] = [
	...READ_ONLY,
	'trips:write',
	'trips:assign',
	'crew:write',
	'vehicles:write',
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

/**
 * Crew: a driver, guide or specialist who has been given the app.
 *
 * The narrowest role there is, and narrow in a way the others are not — it is
 * the only role whose READS are row-limited. Everyone else sees the whole
 * tenant; crew see the trips they are personally on, enforced in listTrips
 * rather than by hiding anything. They can update the set-up of those trips,
 * because a guide confirming a hotel from the field is the point.
 *
 * Deliberately absent: bookings, quotations, payments, customers, the inbox, and
 * tours — a driver has no reason to see what a trip was sold for or to edit the
 * marketing copy that sold it, and passports stay behind travelers:read_sensitive,
 * which crew do not get.
 */
const CREW: Permission[] = ['trips:read', 'trips:write', 'crew:read'];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
	SUPER_ADMIN: ALL,
	OWNER: TENANT_ALL,
	ADMIN,
	BOOKING_AGENT,
	OPERATIONS,
	CREW,
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
	// Owners short-circuit, which also means a per-member override can never add
	// tours:publish back to an owner who is not entitled to it.
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
	// Deciding whose problem a departure is, separately from preparing it.
	'trips:assign',
	'crew:read',
	'crew:write',
	// Marketplace listings, so an operator's own website or CMS can read its
	// listings and draft new ones. tours:publish is deliberately absent: a website
	// key must never be able to put a listing on the public marketplace — approval
	// stays a signed-in office decision, never something a leaked key can do.
	'tours:read',
	'tours:write',
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
