import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The signed-in product's dark mode is a TOKEN FLIP, not a set of `dark:` variants.
 *
 * `.mk-dark` re-resolves the palette custom properties in app.css, so a component
 * written in tokens needs no dark variant at all — which is exactly why a stock
 * Tailwind colour is a bug rather than a style choice. `--color-amber-*` and
 * `--color-emerald-*` do not exist in either palette, so `text-emerald-700` keeps
 * its light value on a near-black card: 3.2:1 where `text-success` gives 7.9:1.
 *
 * It is invisible in review — the light theme looks perfect — and it had reached
 * eight files before anyone checked the other theme. Hence a test rather than a
 * note. Charts are the documented exception: ApexCharts paints literal colours,
 * so chart pages re-derive them from `chartPalette(theme.dark)`.
 */
const ROOTS = ['src/routes/app', 'src/routes/admin', 'src/lib/components'];

/** Palettes app.css actually defines, in BOTH themes. */
const TOKENS = ['success', 'warning', 'danger', 'purple', 'brand', 'slate', 'white', 'canvas'];

function svelteFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(full);
		return entry.isFile() && full.endsWith('.svelte') ? [full] : [];
	});
}

describe('the portal is written in palette tokens', () => {
	const files = ROOTS.flatMap(svelteFiles);

	it('has files to check at all, so a broken glob cannot pass silently', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('never reaches for a stock Tailwind colour scale, which has no dark value', () => {
		// Every hue Tailwind ships that the palette does NOT define.
		const stock =
			/\b(?:text|bg|border|ring|from|via|to|decoration|outline|divide|accent|shadow)-(amber|emerald|green|red|yellow|orange|lime|teal|cyan|sky|blue|indigo|violet|fuchsia|pink|rose|stone|zinc|neutral|gray)-\d{2,3}\b/g;

		const offenders: string[] = [];
		for (const file of files) {
			for (const match of fs.readFileSync(file, 'utf8').matchAll(stock)) {
				offenders.push(`${file}: ${match[0]}`);
			}
		}
		expect(offenders, `use ${TOKENS.slice(0, 4).join(' / ')} instead`).toEqual([]);
	});

	it('defines every one of those tokens in BOTH themes, or the flip is a no-op', () => {
		const css = fs.readFileSync('src/app.css', 'utf8');
		const dark = css.slice(css.indexOf('.mk-dark'));
		expect(dark.length, '.mk-dark block not found in app.css').toBeGreaterThan(0);

		for (const token of ['success', 'warning', 'danger']) {
			expect(css, `--color-${token} missing from the light palette`).toContain(`--color-${token}:`);
			expect(dark, `--color-${token} missing from .mk-dark`).toContain(`--color-${token}:`);
		}
	});
});
