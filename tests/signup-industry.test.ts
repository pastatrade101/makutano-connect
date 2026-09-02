// Pure tests. Signup accepts one kind of business, and the check that enforces
// it is the only thing standing between the form and the tenants table — the
// industry field arrived with no validation at all before this.
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIGNUP_INDUSTRY,
	INDUSTRIES,
	isSignupIndustry,
	SIGNUP_INDUSTRIES
} from '$lib/server/provisioning';

describe('what signup will create', () => {
	it('offers tour and travel operators, and nothing else', () => {
		expect(SIGNUP_INDUSTRIES.map((i) => i.value)).toEqual(['TRAVEL_TOURISM']);
	});

	it('accepts the travel industry', () => {
		expect(isSignupIndustry('TRAVEL_TOURISM')).toBe(true);
	});

	it('refuses every other industry the product has ever offered', () => {
		const others = INDUSTRIES.map((i) => i.value).filter((v) => v !== 'TRAVEL_TOURISM');
		expect(others.length).toBeGreaterThan(0);
		for (const value of others) expect(isSignupIndustry(value), value).toBe(false);
	});

	it('refuses anything a browser might post that is not an industry at all', () => {
		// The field is a plain form value. These are what a curl or a tampered form
		// sends, and each used to be written to the tenant verbatim.
		for (const junk of ['', ' ', 'RETAIL ', 'travel_tourism', 'ANYTHING', '../admin', '{}']) {
			expect(isSignupIndustry(junk), JSON.stringify(junk)).toBe(false);
		}
	});

	it('defaults to the one industry it does accept', () => {
		expect(isSignupIndustry(DEFAULT_SIGNUP_INDUSTRY)).toBe(true);
	});
});

describe('what the product can still read', () => {
	/*
	 * Narrowing signup must not narrow history. Production holds a tenant on
	 * OTHER and three on no industry at all; dropping values from INDUSTRIES would
	 * leave those rows unable to resolve to a label.
	 */
	it('keeps every historical industry readable', () => {
		const values = INDUSTRIES.map((i) => i.value);
		for (const legacy of ['OTHER', 'RETAIL', 'RESTAURANT_FOOD', 'HOSPITALITY', 'HEALTHCARE']) {
			expect(values, legacy).toContain(legacy);
		}
	});

	it('is a superset of what signup offers', () => {
		const all = new Set(INDUSTRIES.map((i) => i.value));
		for (const offered of SIGNUP_INDUSTRIES) expect(all.has(offered.value)).toBe(true);
		expect(SIGNUP_INDUSTRIES.length).toBeLessThan(INDUSTRIES.length);
	});
});
