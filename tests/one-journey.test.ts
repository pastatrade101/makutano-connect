// Makutano sells ONE journey, and the product should only be able to produce it.
//
// enquiry -> quotation -> acceptance -> booking, for a Tanzanian tour operator reaching
// a traveller. Two things used to let an account drift off it:
//
//   - Settings offered "How do you use Connect?", so an operator could pick Customer
//     orders and lose Quotations and Bookings from their own menu — breaking, from a
//     dropdown, the one flow the product exists to make work.
//   - A mirrored enquiry reporting CONVERTED manufactured a booking with no quotation
//     behind it, giving any tenant an integration pointed at them a second, parallel
//     way to create bookings.
import { describe, expect, it } from 'vitest';
import { moduleRelevant, normalizeWorkspace, type Module } from '../src/lib/workspace';
import { SIGNUP_INDUSTRIES, DEFAULT_SIGNUP_INDUSTRY, isSignupIndustry } from '../src/lib/server/provisioning';

describe('registration produces exactly one shape of business', () => {
	it('offers a single industry, and it is the tour operator', () => {
		expect(SIGNUP_INDUSTRIES).toHaveLength(1);
		expect(SIGNUP_INDUSTRIES[0].value).toBe('TRAVEL_TOURISM');
		expect(DEFAULT_SIGNUP_INDUSTRY).toBe('TRAVEL_TOURISM');
	});

	it('refuses any other industry, however the form posts it', () => {
		// The industry used to be stored verbatim from an unvalidated field.
		for (const other of ['RETAIL', 'RESTAURANT_FOOD', 'OTHER', 'GOVERNMENT_PUBLIC', '', 'nonsense']) {
			expect(isSignupIndustry(other)).toBe(false);
		}
		expect(isSignupIndustry('TRAVEL_TOURISM')).toBe(true);
	});

	it('gives that operator the whole quotation journey and nothing off it', () => {
		const workspace = normalizeWorkspace('BOOKINGS');
		const journey: Module[] = ['enquiries', 'quotations', 'bookings', 'trips', 'leads'];
		for (const m of journey) expect(moduleRelevant(workspace, m)).toBe(true);
		// Orders belong to a different business entirely; a tour operator should never
		// meet them, and out of the gate never does.
		expect(moduleRelevant(workspace, 'orders')).toBe(false);
	});

	it('still READS the other shapes, because existing tenants have them', () => {
		// Narrowing what can be created must not strand what was already created.
		expect(moduleRelevant(normalizeWorkspace('ORDERS'), 'orders')).toBe(true);
		expect(moduleRelevant(normalizeWorkspace('SERVICE'), 'quotations')).toBe(true);
		expect(moduleRelevant(normalizeWorkspace('HYBRID'), 'bookings')).toBe(true);
		// And an unrecognised value still fails open rather than hiding a live module.
		expect(normalizeWorkspace('BOTH')).toBe('HYBRID');
		expect(normalizeWorkspace(null)).toBe('HYBRID');
	});
});

describe('the operator Settings form cannot change the workspace', () => {
	it('does not render the picker', async () => {
		const fs = await import('node:fs');
		const page = fs.readFileSync('src/routes/app/settings/+page.svelte', 'utf8');
		expect(page).not.toContain('WORKSPACE_OPTIONS');
		expect(page).not.toContain('name="capabilities"');
	});

	it('does not READ capabilities from the posted form either', async () => {
		// Sharper than removing the input. A form that no longer renders a field posts
		// nothing for it, so `data.get('capabilities') ?? 'BOTH'` would have normalised
		// to HYBRID and silently widened the workspace on every unrelated Save — the
		// same shape of bug as the quotation prefix defaulting to 'QT'.
		const fs = await import('node:fs');
		const server = fs.readFileSync('src/routes/app/settings/+page.server.ts', 'utf8');
		expect(server).not.toContain("data.get('capabilities')");
	});
});
