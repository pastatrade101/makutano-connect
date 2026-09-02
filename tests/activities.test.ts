// Pure tests. No database, so nothing here can pass by skipping.
//
// The strings below are real: every one appears in the activities column of a
// published itinerary today, with its live frequency in the comment where it
// matters. A normaliser tested against invented input tells you nothing about
// the inventory it has to survive.
import { describe, expect, it } from 'vitest';
import { ACTIVITY_SLUGS, activitiesFor, activityFor } from '$lib/activity-normalise';

describe('activityFor — wording variants collapse to one activity', () => {
	it('maps every game-drive phrasing in current inventory to game-drive', () => {
		const real = [
			'serengeti game drive', // 38 uses
			'transit game drive', // 27
			'early game drive at ngorongoro crater', // 17
			'tarangire game drive', // 15
			'serengeti afternoon game drive', // 11
			'ngorongoro crater game drive',
			'arusha national park game drive',
			'morning and afternoon game drives',
			'full day game drive',
			'guided game drive',
			'private game drives in the serengeti',
			'central serengeti wildlife viewing'
		];
		for (const line of real) expect(activityFor(line), line).toBe('game-drive');
	});

	it('does not create a separate activity per wording variant', () => {
		const slugs = new Set(
			['morning game drive', 'afternoon game drive', 'en-route game drive'].map(activityFor)
		);
		expect(slugs.size).toBe(1);
	});

	it('reads the other activities that occur in inventory', () => {
		expect(activityFor('walking safari')).toBe('walking-safari');
		expect(activityFor('boat safari on the rufiji river')).toBe('boat-safari');
		expect(activityFor('beach leisure')).toBe('beach-time');
		expect(activityFor('relax by the ocean')).toBe('beach-time');
		expect(activityFor('snorkelling or water sports')).toBe('beach-time');
		expect(activityFor('stone town tour')).toBe('cultural-visit');
		expect(activityFor('spice tour')).toBe('cultural-visit');
		expect(activityFor('materuni village visit')).toBe('cultural-visit');
		expect(activityFor('materuni waterfalls')).toBe('waterfall-walk');
	});
});

describe('activityFor — operational lines are not activities', () => {
	/*
	 * These are the bulk of the column. "picnic lunch" alone is 113 of 478 uses,
	 * and transfers and flights are around 95 more. None of them is a reason
	 * somebody books a safari, and a taxonomy containing "airport transfer" is a
	 * taxonomy nobody can filter with.
	 */
	it('returns null for meals, transfers, flights and briefings', () => {
		const operational = [
			'picnic lunch',
			'bush picnic',
			'airport transfer',
			'hotel transfer',
			'scenic transfer',
			'transfer to arusha',
			'flight from zanzibar,',
			'return flight to zanzibar',
			'domestic flight',
			'safari briefing',
			'trip briefing',
			'welcome dinner',
			'arrival',
			'overnight at a midrange safari lodge or tented camp'
		];
		for (const line of operational) expect(activityFor(line), line).toBeNull();
	});

	it('returns null for descriptive prose that is not an activity at all', () => {
		expect(
			activityFor('a park famous for tree-climbing lions, flamingos and large elephant herds')
		).toBeNull();
		expect(activityFor('meet your private safari guide and luxury 4x4 vehicle')).toBeNull();
	});

	it('returns null for nothing', () => {
		expect(activityFor('')).toBeNull();
		expect(activityFor('   ')).toBeNull();
		expect(activityFor(null)).toBeNull();
		expect(activityFor(undefined)).toBeNull();
	});
});

describe('activityFor — the more decisive activity wins', () => {
	it('reads a walking day that also drives as walking', () => {
		expect(activityFor('walking safari and afternoon game drive')).toBe('walking-safari');
	});

	it('reads a boat day that also drives as a boat safari', () => {
		expect(activityFor('morning game drive, then a boat safari')).toBe('boat-safari');
	});
});

describe('activitiesFor — a day list becomes a tour-level set', () => {
	it('says a thing once however many days do it', () => {
		expect(
			activitiesFor([
				'serengeti game drive',
				'tarangire game drive',
				'ngorongoro crater game drive'
			])
		).toEqual(['game-drive']);
	});

	it('returns taxonomy order, not the order the days happened to be written', () => {
		const out = activitiesFor(['beach leisure', 'walking safari', 'serengeti game drive']);
		expect(out).toEqual(['game-drive', 'walking-safari', 'beach-time']);
	});

	it('drops the operational lines and keeps the rest', () => {
		expect(
			activitiesFor(['picnic lunch', 'airport transfer', 'serengeti game drive', 'domestic flight'])
		).toEqual(['game-drive']);
	});

	it('is empty for an itinerary of pure logistics', () => {
		expect(activitiesFor(['picnic lunch', 'airport transfer', 'welcome dinner'])).toEqual([]);
	});

	it('handles an empty or absent list', () => {
		expect(activitiesFor([])).toEqual([]);
		expect(activitiesFor([null, undefined, ''])).toEqual([]);
	});
});

describe('the canonical set', () => {
	it('only ever returns a slug that exists in the taxonomy', () => {
		const lines = [
			'serengeti game drive',
			'walking safari',
			'boat safari on the rufiji river',
			'beach leisure',
			'stone town tour',
			'materuni waterfalls'
		];
		for (const line of lines) {
			const slug = activityFor(line);
			expect(ACTIVITY_SLUGS).toContain(slug);
		}
	});

	it('holds only slugs, so a name can be reworded without breaking a filter', () => {
		for (const slug of ACTIVITY_SLUGS) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
	});

	it('has no duplicates', () => {
		expect(new Set(ACTIVITY_SLUGS).size).toBe(ACTIVITY_SLUGS.length);
	});
});
