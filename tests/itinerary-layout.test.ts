// The composer's advice has to describe what the PAGE does, not what reads nicely.
//
// These are the two rules an operator cannot see from inside a text box: the day
// photograph is a layout switch, and length is a layout input. The bands are read
// off the live catalogue — 108 published days, median title 44 characters, median
// description 454 — so the test's job is mostly to keep the advice SILENT for the
// content operators already write. Advice that fires on the median is a nag.
import { describe, expect, it } from 'vitest';
import {
	titleAdvice,
	printedTitle,
	descriptionAdvice,
	photoEvenness,
	plainLength,
	TITLE_ONE_LINE
} from '../src/lib/itinerary-layout';

const words = (n: number) => 'x'.repeat(n);

describe('the composer stays quiet about content that is already fine', () => {
	it('says nothing about a median title', () => {
		expect(titleAdvice('Tarangire to Ngorongoro Highlands', 2)).toBeNull(); // 32
		expect(titleAdvice(words(TITLE_ONE_LINE), 2)).toBeNull();
	});

	it('says nothing about a median description, with or without a photograph', () => {
		const median = `<p>${words(454)}</p>`;
		expect(descriptionAdvice(median, true)).toBeNull();
		expect(descriptionAdvice(median, false)).toBeNull();
	});

	it('says nothing at all about an empty day, which the readiness panel owns', () => {
		expect(descriptionAdvice('', true)).toBeNull();
		expect(titleAdvice('', 1)).toBeNull();
	});
});

describe('and speaks where the rendered page actually changes', () => {
	it('names the second line, past the width of the day header', () => {
		expect(titleAdvice(words(TITLE_ONE_LINE + 1), 3)).toMatch(/second line/i);
	});

	it('measures what the page PRINTS, not what was typed', () => {
		// 40 of the catalogue's 75 Makutano days carry this prefix. Counting it
		// would fire the length advice on titles that print well within the band.
		const typed = 'Day 5: Ngorongoro Crater Game Drive';
		expect(printedTitle(typed, 5)).toBe('Ngorongoro Crater Game Drive');
		// Only the day's OWN number is a prefix; anything else is the title.
		expect(printedTitle(typed, 4)).toBe(typed);
		expect(printedTitle('Two days in Ruaha', 2)).toBe('Two days in Ruaha');
	});

	it('points out the prefix, because it is free to fix and why most are long', () => {
		expect(titleAdvice('Day 5: Ngorongoro Crater Game Drive', 5)).toMatch(/numbers each day itself/i);
		// A real 86-character title, from the live catalogue. Under the band once
		// the prefix goes, so the advice is about the prefix and not the length.
		const real = 'Day 5: Ngorongoro Crater Game Drive – Return to Arusha / Kilimanjaro Airport Departure';
		expect(printedTitle(real, 5).length).toBe(79);
	});

	it('gives DIFFERENT advice for the same short prose depending on the picture', () => {
		// The whole point of resolving the photograph before the prose: 200
		// characters is a fine short day, and a gap beside a 4:3 photograph.
		const short = `<p>${words(200)}</p>`;
		expect(descriptionAdvice(short, false)).toBeNull();
		expect(descriptionAdvice(short, true)).toMatch(/gap/i);
	});

	it('names the shrinking picture rather than just "too long"', () => {
		const long = `<p>${words(900)}</p>`;
		expect(descriptionAdvice(long, true)).toMatch(/tile/i);
		expect(descriptionAdvice(long, false)).toMatch(/long read/i);
	});

	it('measures the words, not the markup', () => {
		expect(plainLength('<p><strong>Two</strong> words</p>')).toBe(9);
		expect(plainLength(`<p>${words(60)}</p>`)).toBe(60);
		expect(plainLength(null)).toBe(0);
	});
});

describe('evenness is about the SET, and an itinerary with no photographs is even', () => {
	it('calls all-or-nothing even, and says so in both directions', () => {
		expect(photoEvenness(0, 6).even).toBe(true);
		expect(photoEvenness(0, 6).message).toMatch(/every day prints the same way/i);
		expect(photoEvenness(6, 6).even).toBe(true);
		expect(photoEvenness(6, 6).message).toMatch(/every day prints the same way/i);
	});

	it('only calls a MIXED itinerary uneven', () => {
		const mixed = photoEvenness(3, 6);
		expect(mixed.even).toBe(false);
		expect(mixed.message).toMatch(/3 of 6/);
		expect(mixed.message).toMatch(/changes shape/i);
	});

	it('counts the singular correctly, because 5 of 6 is the commonest near-miss', () => {
		expect(photoEvenness(5, 6).message).toContain('the other day prints');
		expect(photoEvenness(4, 6).message).toContain('the other 2 print');
	});

	it('has nothing to say about a tour with no days', () => {
		expect(photoEvenness(0, 0)).toEqual({ even: true, message: '' });
	});
});
