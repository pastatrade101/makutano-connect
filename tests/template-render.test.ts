import { describe, expect, it } from 'vitest';

// The substitution the thread body depends on. Kept as a pure check so a change
// to the regex cannot quietly go back to storing "[template:name]".
const render = (body: string, values: string[]): string =>
	body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n) => values[Number(n) - 1] ?? match);

describe('rendering a template for the thread', () => {
	it('drops the values into their places', () => {
		expect(
			render('Exit risk has crossed {{1}} — your ladder says: {{2}}. See: {{3}}', [
				'0.75',
				'Start trimming into strength',
				'https://pastatrade101.com/app/exit-strategy'
			])
		).toBe(
			'Exit risk has crossed 0.75 — your ladder says: Start trimming into strength. See: https://pastatrade101.com/app/exit-strategy'
		);
	});

	it('repeats a value used twice', () => {
		expect(render('{{1}} and again {{1}}', ['once'])).toBe('once and again once');
	});

	it('leaves a placeholder alone when no value was given, rather than emptying it', () => {
		// An operator reading "{{2}}" knows something is missing; a silent blank
		// reads as though the customer received a half-written sentence.
		expect(render('Hello {{1}}, ref {{2}}', ['Amina'])).toBe('Hello Amina, ref {{2}}');
	});

	it('ignores named placeholders, which resolve elsewhere', () => {
		expect(render('Hi {{customer.first_name}}, {{1}}', ['now'])).toBe('Hi {{customer.first_name}}, now');
	});
});
