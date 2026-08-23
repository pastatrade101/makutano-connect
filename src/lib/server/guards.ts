// Page-load guards for the tenant portal.
//
// SvelteKit runs a page's `load` in PARALLEL with its layout's `load`. So a layout that
// redirects (no active tenant, not signed in) does not stop the page load from running
// first — and a page that reaches straight for `locals.tenant!.id` or checks a
// permission against an empty array throws a 500 that beats the redirect.
//
// These guards make the page agree with the layout: same redirect, no 500.
import { redirect } from '@sveltejs/kit';
import type { Tenant } from './db/schema';
import { requirePermission, type Permission } from './auth/permissions';

type PortalLocals = {
	user: App.Locals['user'];
	tenant: App.Locals['tenant'];
	permissions: App.Locals['permissions'];
};

/**
 * Resolve the tenant for a portal page, redirecting exactly as the layout would.
 * Returns a non-null tenant so callers never need `!`.
 */
export function requireTenant(locals: PortalLocals): Tenant {
	if (!locals.user) redirect(303, '/login');
	if (!locals.tenant) redirect(303, locals.user.isSuperAdmin ? '/admin' : '/login');
	return locals.tenant;
}

/** requireTenant() + a permission check, in the order a page actually needs them. */
export function requireTenantPermission(locals: PortalLocals, permission: Permission): Tenant {
	const tenant = requireTenant(locals);
	requirePermission(locals.permissions, permission);
	return tenant;
}
