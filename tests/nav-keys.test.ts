// Keyed {#each} blocks over the nav groups must key on something UNIQUE.
//
// Two groups deliberately carry `label: ''` — the Home/Inbox pair at the top of the
// sidebar and the Settings footer at the bottom. The mobile "More" sheet keyed on
// `group.label` alone, so both produced the key '' and Svelte threw
// each_key_duplicate mid-render: the state flipped, the sheet never appeared, and
// "More" read as a dead button on every phone. The only symptom was a console error
// nobody sees on a handset.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const LAYOUT = 'src/routes/app/+layout.svelte';

describe('app navigation', () => {
	const source = fs.readFileSync(LAYOUT, 'utf8');

	it('has more than one group with a blank label, which is what makes the key matter', () => {
		// If this ever stops being true the bug becomes unreproducible, and the test
		// below would pass for the wrong reason — so assert the precondition too.
		const blanks = source.match(/label: '',/g) ?? [];
		expect(blanks.length).toBeGreaterThan(1);
	});

	it('never keys a groups loop on the label alone', () => {
		expect(source).not.toContain('{#each groups as group (group.label)}');
	});

	it('keys every groups loop on label + first href', () => {
		const loops = source.match(/\{#each groups as group \([^)]*\)\}/g) ?? [];
		expect(loops.length).toBeGreaterThan(0);
		for (const loop of loops) expect(loop).toContain('group.items[0].href');
	});
});
