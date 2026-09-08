import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fixtures must not consume a namespace the next run also needs.
 *
 * A tour slug is unique GLOBALLY (tours_slug_live_idx) and createTour's
 * freeSlug() tries `base`, `base-2` … `base-8` before giving up. A fixed title in
 * a fixture therefore works perfectly eight times and then fails — in beforeAll,
 * with "Too many listings share this title", which reads as a bug in the tour
 * code rather than as a suite that has filled its own slug space. Nothing cleans
 * these rows up, so the eight runs can be spread over weeks.
 *
 * The rule: any title a fixture creates carries a per-run token.
 */
const TEST_FILES = fs
	.readdirSync('tests')
	.filter((name) => name.endsWith('.test.ts'))
	.map((name) => `tests/${name}`);

describe('test fixtures do not exhaust a global namespace', () => {
	it('sees the suite, so a broken glob cannot pass silently', () => {
		expect(TEST_FILES.length).toBeGreaterThan(30);
	});

	it('never creates a tour under a hard-coded title', () => {
		// A single-quoted title is literal by definition; a template literal is only
		// safe if it interpolates something, which `${` proves.
		const literal = /createTour\([^)]*?title:\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/gs;
		const offenders: string[] = [];

		for (const file of TEST_FILES) {
			const source = fs.readFileSync(file, 'utf8');
			for (const match of source.matchAll(literal)) {
				const title = match[0].slice(match[0].indexOf('title:'));
				if (title.includes('${')) continue; // interpolated — carries a token
				offenders.push(`${file}: ${title.replace(/\s+/g, ' ')}`);
			}
		}
		expect(offenders, 'give the title a per-run token, e.g. `Vendor A Listing ${stamp}`').toEqual([]);
	});
});
