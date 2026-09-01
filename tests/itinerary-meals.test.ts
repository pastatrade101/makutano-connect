import { describe, expect, it } from 'vitest';
import { MEALS, mealsLabel, normaliseMeals, parseMeals } from '../src/lib/tour-options';

/**
 * The point of the closed set is that three spellings of one fact stop being
 * three facts. These tests are the live data that proved it: the same six-day
 * itinerary carried 'Dinner', 'All meals' and 'Breakfast, lunch'.
 */
describe('itinerary meals', () => {
	it('reads the sentences the free-text column actually held', () => {
		expect(parseMeals('Dinner')).toEqual(['DINNER']);
		expect(parseMeals('All meals')).toEqual(['BREAKFAST', 'LUNCH', 'DINNER']);
		expect(parseMeals('Breakfast, lunch')).toEqual(['BREAKFAST', 'LUNCH']);
	});

	it('reads the wordings a person would also write', () => {
		expect(parseMeals('Full board')).toEqual(['BREAKFAST', 'LUNCH', 'DINNER']);
		// Half board is breakfast and the evening meal, never lunch.
		expect(parseMeals('Half board')).toEqual(['BREAKFAST', 'DINNER']);
		expect(parseMeals('supper only')).toEqual(['DINNER']);
		expect(parseMeals('BREAKFAST')).toEqual(['BREAKFAST']);
	});

	it('keeps the order of the day, not the order given', () => {
		expect(parseMeals(['DINNER', 'BREAKFAST'])).toEqual(['BREAKFAST', 'DINNER']);
		expect(normaliseMeals(['dinner', 'lunch'])).toEqual(['LUNCH', 'DINNER']);
	});

	it('drops anything outside the vocabulary instead of storing it', () => {
		expect(normaliseMeals(['BRUNCH', 'CANAPES', 'LUNCH'])).toEqual(['LUNCH']);
		expect(parseMeals('')).toEqual([]);
		expect(parseMeals(null)).toEqual([]);
		expect(parseMeals('picnic')).toEqual([]);
	});

	it('says it back the way a person would', () => {
		expect(mealsLabel(['BREAKFAST', 'LUNCH', 'DINNER'])).toBe('All meals');
		expect(mealsLabel(['BREAKFAST'])).toBe('Breakfast');
		expect(mealsLabel(['BREAKFAST', 'DINNER'])).toBe('Breakfast and dinner');
		expect(mealsLabel(['BREAKFAST', 'LUNCH'])).toBe('Breakfast and lunch');
		expect(mealsLabel([])).toBeNull();
		expect(mealsLabel(null)).toBeNull();
	});

	it('round-trips: what a person reads parses back to what was stored', () => {
		for (const set of [['BREAKFAST'], ['LUNCH', 'DINNER'], MEALS.map((m) => m.value)]) {
			expect(parseMeals(mealsLabel(set)!)).toEqual(normaliseMeals(set));
		}
	});
});
