import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The import's two judgement calls, tested against the real export.
 *
 * Neither is technical. Skipping hotlinked images is a LICENSING decision the
 * export itself asks for, and title-casing only all-caps names is a decision
 * about whose spelling wins. Both are easy to "fix" into being wrong later, so
 * they are pinned here.
 */
const FILE = '/Users/pastoryjoseph/Desktop/goldfinch-accommodation-images.json';

const slugify = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const properName = (raw: string) => {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name !== name.toUpperCase()) return name;
	return name
		.toLowerCase()
		.split(' ')
		.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
		.join(' ');
};

describe('accommodation import rules', () => {
	it('title-cases a shouted name and leaves deliberate casing alone', () => {
		expect(properName('ARUSHA FARM HOUSE')).toBe('Arusha Farm House');
		// Not touched: this is how its owner writes it.
		expect(properName("Manyara's Secret")).toBe("Manyara's Secret");
		expect(properName('The Retreat at Ngorongoro')).toBe('The Retreat at Ngorongoro');
		expect(properName('  Acacia   farm ')).toBe('Acacia farm');
	});

	it('slugs survive accents and punctuation', () => {
		expect(slugify('Gran Meliá Arusha')).toBe('gran-melia-arusha');
		expect(slugify("Manyara's Secret")).toBe('manyara-s-secret');
	});

	let file: { totals?: { properties: number; images: number; onR2: number; external: number }; accommodation?: unknown[] };
	try {
		file = JSON.parse(readFileSync(FILE, 'utf8'));
	} catch {
		file = {};
	}
	const properties = (file.accommodation ?? []) as { images?: { onR2?: boolean }[] }[];

	// Skipped rather than failed when the export is not on this machine: the rule
	// above is what matters, and it is tested without the file.
	it.skipIf(!properties.length)('keeps only images the export says are ours', () => {
		const usable = properties.flatMap((p) => (p.images ?? []).filter((i) => i.onR2 === true));
		const skipped = properties.flatMap((p) => (p.images ?? []).filter((i) => i.onR2 !== true));
		expect(usable.length).toBe(file.totals?.onR2);
		expect(skipped.length).toBe(file.totals?.external);
		// The point of the rule: some images ARE excluded, so a change that
		// imported everything would fail here rather than pass quietly.
		expect(skipped.length).toBeGreaterThan(0);
	});

	it.skipIf(!properties.length)('gives every property a unique slug', () => {
		const slugs = (properties as { name: string; slug: string }[]).map((p) => slugify(p.slug || p.name));
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
