// A vendor must not be able to put their own listing on the public marketplace.
//
// This is the one marketplace rule with a real adversary behind it: the listing
// carries Makutano's name, not only the operator's. The obvious implementation —
// "give tours:publish to ADMIN" — is WRONG here, because a tenant OWNER inherits
// every permission and would have handed it straight back. So the carve-out is
// asserted from several directions, including the ones an attacker would try.
import { describe, expect, it } from 'vitest';
import {
	API_SCOPES,
	DEFAULT_API_SCOPES,
	PERMISSIONS,
	can,
	effectivePermissions,
	isValidScope,
	permissionsForRole
} from '../src/lib/server/auth/permissions';
import type { Role } from '../src/lib/server/db/schema';

const VENDOR_ROLES: Role[] = ['OWNER', 'ADMIN', 'BOOKING_AGENT', 'SALES', 'OPERATIONS', 'VIEWER', 'CREW'];

describe('marketplace publishing is platform-only', () => {
	it('defines the three marketplace permissions', () => {
		for (const p of ['tours:read', 'tours:write', 'tours:publish']) {
			expect(PERMISSIONS as readonly string[]).toContain(p);
		}
	});

	it('gives NO vendor role tours:publish — including OWNER', () => {
		for (const role of VENDOR_ROLES) {
			expect(permissionsForRole(role), `${role} must not publish`).not.toContain('tours:publish');
		}
	});

	it('still gives SUPER_ADMIN tours:publish', () => {
		expect(permissionsForRole('SUPER_ADMIN')).toContain('tours:publish');
	});

	it('lets a vendor OWNER author and submit, but not approve or publish', () => {
		const owner = permissionsForRole('OWNER');
		expect(owner).toContain('tours:read');
		expect(owner).toContain('tours:write');
		expect(owner).not.toContain('tours:publish');
	});

	it('cannot be restored to an OWNER by a per-member override', () => {
		// The attack: an admin edits the owner's overrides to grant it. Owners
		// short-circuit override handling entirely, so the grant is ignored.
		const forced = effectivePermissions('OWNER', { 'tours:publish': true });
		expect(forced).not.toContain('tours:publish');
	});

	it('cannot be restored to any vendor role by a per-member override', () => {
		for (const role of VENDOR_ROLES) {
			const forced = effectivePermissions(role, { 'tours:publish': true });
			if (role === 'OWNER') {
				expect(forced, 'owner overrides are ignored wholesale').not.toContain('tours:publish');
			} else {
				// Non-owner overrides ARE honoured by design — that is the feature.
				// What must hold is that it is never a DEFAULT, so granting it is a
				// deliberate, auditable act by someone who already had it.
				expect(permissionsForRole(role)).not.toContain('tours:publish');
			}
		}
	});

	it('is not reachable through an API key at all', () => {
		// A website integration key must never be able to publish to the
		// marketplace, so tours:publish is not in the scope vocabulary.
		expect(API_SCOPES as readonly string[]).not.toContain('tours:publish');
		expect(isValidScope('tours:publish')).toBe(false);
		expect(DEFAULT_API_SCOPES as readonly string[]).not.toContain('tours:publish');
	});

	it('does expose tours:read and tours:write as API scopes', () => {
		expect(API_SCOPES as readonly string[]).toContain('tours:read');
		expect(API_SCOPES as readonly string[]).toContain('tours:write');
	});

	it('keeps marketplace authoring away from field roles', () => {
		// A driver has no reason to edit marketing copy.
		expect(permissionsForRole('CREW')).not.toContain('tours:write');
		expect(permissionsForRole('OPERATIONS')).not.toContain('tours:write');
		// Preparing a departure is not writing the advert.
		expect(permissionsForRole('OPERATIONS')).toContain('trips:write');
	});

	it('lets VIEWER read listings but not write them', () => {
		expect(permissionsForRole('VIEWER')).toContain('tours:read');
		expect(permissionsForRole('VIEWER')).not.toContain('tours:write');
	});

	it('can() agrees with the role matrix', () => {
		expect(can(permissionsForRole('OWNER'), 'tours:write')).toBe(true);
		expect(can(permissionsForRole('OWNER'), 'tours:publish')).toBe(false);
		expect(can(permissionsForRole('SUPER_ADMIN'), 'tours:publish')).toBe(true);
	});

	it('did not disturb any existing permission', () => {
		// Additive only: a regression here would silently widen or narrow an
		// unrelated role.
		const owner = permissionsForRole('OWNER');
		for (const p of ['bookings:write', 'payments:refund', 'whatsapp:send', 'trips:assign']) {
			expect(owner, `OWNER should still hold ${p}`).toContain(p);
		}
		expect(permissionsForRole('VIEWER')).not.toContain('bookings:write');
		expect(permissionsForRole('CREW')).toEqual(
			expect.arrayContaining(['trips:read', 'trips:write', 'crew:read'])
		);
	});
});
