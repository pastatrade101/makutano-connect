// Who may serve a public form.
//
// The rule is stated as an exclusion because the obvious spelling — require
// ACTIVE — is wrong in a way that hides: a trialling tenant looks perfectly
// healthy in the console, creates a form, copies the URL onto their website, and
// every visitor gets a 404. Production held no ACTIVE tenant at all, so that was
// every form for every customer.
import { describe, expect, it } from 'vitest';

/** The predicate as forms.ts states it, exercised over every tenant status. */
function reachable(status: string, deletedAt: Date | null, formActive: boolean): boolean {
	const ok = !deletedAt && !['SUSPENDED', 'CANCELLED'].includes(status);
	return ok && formActive;
}

describe('a public form is reachable for any tenant that is not suspended, cancelled or deleted', () => {
	it('serves a paying tenant', () => expect(reachable('ACTIVE', null, true)).toBe(true));

	it('serves a TRIAL tenant — the bug this replaces', () => {
		// Every live tenant in production is TRIAL.
		expect(reachable('TRIAL', null, true)).toBe(true);
	});

	it('serves a PENDING tenant awaiting billing', () => expect(reachable('PENDING', null, true)).toBe(true));

	it('refuses a suspended tenant', () => expect(reachable('SUSPENDED', null, true)).toBe(false));
	it('refuses a cancelled tenant', () => expect(reachable('CANCELLED', null, true)).toBe(false));
	it('refuses a soft-deleted tenant whatever its status', () =>
		expect(reachable('ACTIVE', new Date(), true)).toBe(false));

	it('still refuses a deactivated form on a healthy tenant', () =>
		expect(reachable('TRIAL', null, false)).toBe(false));

	it('matches the marketplace, which fixed this first', async () => {
		// Both gates must agree, or an enquiry and a form disagree about the same
		// tenant. marketplace.ts excludes exactly these two.
		const { readFileSync } = await import('node:fs');
		const marketplace = readFileSync('src/lib/server/marketplace.ts', 'utf8');
		expect(marketplace).toContain("notInArray(schema.tenants.status, ['SUSPENDED', 'CANCELLED'])");
		const forms = readFileSync('src/lib/server/forms.ts', 'utf8');
		expect(forms).toContain("['SUSPENDED', 'CANCELLED'].includes(row.tenant.status)");
	});
});
