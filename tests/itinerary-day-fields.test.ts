// A day's field has three jobs, and it has to be wired into all three.
//
// The composer holds the itinerary as one `draft.days` array, posts it whole as
// JSON, and replaceItinerary DELETES every row and re-inserts. That shape makes
// an omission silent in a particular way: a field the payload does not carry is
// not "left alone", it is written back as null.
//
// That is what happened to the day photograph. tour_itinerary_days.media_id has
// always existed, marketplace.ts reads it, and TourItinerary.svelte switches the
// day between a one- and two-column layout on it — but the composer's Day type
// never had it. So an operator who opened the itinerary step and pressed Save
// stripped every photograph off the tour, and the public page quietly lost the
// layout it had been importing with.
//
// A second, quieter version of the same fault: travelMode and the day's pin were
// missing from dayPrint, the change-detection print. A field missing THERE never
// turns the step "Unsaved changes" and never trips the leave-guard, so the work
// is lost on navigate-away rather than on save.
//
// Hence the structural test below rather than three assertions about mediaId: it
// reads the Day type and requires every field in it to appear in all three
// places, so the NEXT field added is caught by the same net.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const COMPOSER = fs.readFileSync('src/routes/app/tours/[id]/+page.svelte', 'utf8');
const ACTION = fs.readFileSync('src/routes/app/tours/[id]/+page.server.ts', 'utf8');

/** The `type Day = { ... }` the composer edits. */
function dayFields(): string[] {
	const block = COMPOSER.match(/\ttype Day = \{([\s\S]*?)\n\t\};/);
	if (!block) throw new Error('The Day type could not be found — this test is reading the wrong shape.');
	return [...block[1].matchAll(/^\t\t([a-zA-Z]+)[?]?:/gm)].map((m) => m[1]);
}

const dayPrint = COMPOSER.match(/const dayPrint = \(d: Day\) =>([\s\S]*?)\n\t\t\]\);/)?.[1] ?? '';
/** The loader's projection — the start of the round trip, and where this bug also was. */
const LOADED = ACTION.match(/itinerary: detail\.itinerary\.map\(\(d\) => \(\{([\s\S]*?)\n\t\t\}\)\)/)?.[1] ?? '';
const seed = COMPOSER.match(/days: data\.itinerary\.map\(([\s\S]*?)\n\t\t\t\)/)?.[1] ?? '';

/**
 * Deliberate exclusions, each with a reason. Adding to this list is a decision;
 * silently forgetting a field is the bug.
 *
 * Empty, and that is the goal. mealsNote used to live here — "display of an old
 * value, never edited" — which is exactly the reasoning that let a save destroy
 * it. A field the vendor cannot edit still has to survive the round trip.
 */
const EXCLUDED = new Set<string>();

describe('every field of a day is wired all the way through', () => {
	it('finds a Day type worth checking', () => {
		expect(dayFields().length).toBeGreaterThan(8);
		expect(dayPrint).not.toBe('');
		expect(seed).not.toBe('');
		expect(LOADED).not.toBe('');
	});

	it('sends every field to the browser in the first place', () => {
		// Missing here and the composer seeds the field as absent, so even a
		// correct save writes null over it. This is where the photo bug started.
		const missing = dayFields().filter((f) => !EXCLUDED.has(f) && !new RegExp(`\\b${f}:`).test(LOADED));
		expect(missing).toEqual([]);
	});

	it('seeds every field from the saved row', () => {
		const missing = dayFields().filter((f) => !EXCLUDED.has(f) && !new RegExp(`\\b${f}:`).test(seed));
		expect(missing).toEqual([]);
	});

	it('counts every field as an unsaved change', () => {
		// Missing here = no "Unsaved changes" badge and no leave-guard.
		const missing = dayFields().filter((f) => !EXCLUDED.has(f) && !new RegExp(`d\\.${f}\\b`).test(dayPrint));
		expect(missing).toEqual([]);
	});

	it('reads every field back in the save action', () => {
		// Missing here = replaceItinerary writes null over whatever was there.
		const missing = dayFields().filter((f) => !EXCLUDED.has(f) && !new RegExp(`d\\.${f}\\b`).test(ACTION));
		expect(missing).toEqual([]);
	});
});
