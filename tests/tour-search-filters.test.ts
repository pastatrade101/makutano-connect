import { describe, expect, it } from 'vitest';

/**
 * The two filters behind the home-page search bar.
 *
 * They exist because a search box whose fields do not filter anything is a
 * fabricated control: it looks like it works and quietly ignores you. Both are
 * built on columns the composer already writes — group size and availability —
 * and both treat a NULL bound as "not stated", never as "no".
 *
 * The SQL is exercised against the live schema by the DB suite; these pin the
 * RULES so a later change that tightens a null into an exclusion fails here.
 */
const partyMatches = (
	travellers: number,
	min: number | null,
	max: number | null
): boolean => (min === null || min <= travellers) && (max === null || max >= travellers);

const dateMatches = (
	date: string,
	availabilityType: string,
	from: string | null,
	to: string | null
): boolean =>
	availabilityType === 'YEAR_ROUND' || ((from === null || from <= date) && (to === null || to >= date));

describe('travellers filter', () => {
	it('matches a party inside the published group size', () => {
		// The live listing: private, 2–6 people.
		expect(partyMatches(4, 2, 6)).toBe(true);
		expect(partyMatches(2, 2, 6)).toBe(true);
		expect(partyMatches(6, 2, 6)).toBe(true);
	});

	it('excludes a party the trip cannot take', () => {
		expect(partyMatches(1, 2, 6)).toBe(false);
		expect(partyMatches(10, 2, 6)).toBe(false);
	});

	it('treats an unstated bound as no limit, not as a closed door', () => {
		// Hiding every listing whose operator left the field blank would make the
		// filter look broken rather than permissive.
		expect(partyMatches(12, null, null)).toBe(true);
		expect(partyMatches(12, 2, null)).toBe(true);
		expect(partyMatches(1, null, 6)).toBe(true);
	});
});

describe('date filter', () => {
	it('lets a year-round trip through on any date', () => {
		expect(dateMatches('2026-01-15', 'YEAR_ROUND', null, null)).toBe(true);
		// Even with a stale window on the row: YEAR_ROUND is the operator's answer.
		expect(dateMatches('2026-01-15', 'YEAR_ROUND', '2025-01-01', '2025-12-31')).toBe(true);
	});

	it('honours a seasonal window at both ends', () => {
		expect(dateMatches('2026-07-01', 'SEASONAL', '2026-06-01', '2026-09-30')).toBe(true);
		expect(dateMatches('2026-06-01', 'SEASONAL', '2026-06-01', '2026-09-30')).toBe(true);
		expect(dateMatches('2026-09-30', 'SEASONAL', '2026-06-01', '2026-09-30')).toBe(true);
		expect(dateMatches('2026-05-31', 'SEASONAL', '2026-06-01', '2026-09-30')).toBe(false);
		expect(dateMatches('2026-10-01', 'SEASONAL', '2026-06-01', '2026-09-30')).toBe(false);
	});

	it('treats a half-open window as open at that end', () => {
		expect(dateMatches('2030-01-01', 'DATE_RANGE', '2026-06-01', null)).toBe(true);
		expect(dateMatches('2020-01-01', 'DATE_RANGE', null, '2026-09-30')).toBe(true);
	});
});
