// Light/dark preference for the signed-in product — the tenant portal and the admin
// panel share it, because they share a browser and a person.
//
// Dark mode is a token flip: the `.mk-dark` class on a shell re-resolves the palette
// variables (see app.css), so no component needs a dark variant. Charts are the one
// exception — ApexCharts paints with literal colours, so chart pages re-derive their
// options from `chartPalette`.
import { browser } from '$app/environment';

const KEY = 'mk-theme-dark';
/** The admin panel shipped first with its own key; honour it so nobody's choice resets. */
const LEGACY_KEY = 'mk-admin-dark';

function initial(): boolean {
	if (!browser) return false;
	const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
	if (stored !== null) return stored === '1';
	// No choice yet: follow the operating system rather than assuming light.
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export const theme = $state({ dark: initial() });

export function toggleTheme(): void {
	theme.dark = !theme.dark;
	if (browser) localStorage.setItem(KEY, theme.dark ? '1' : '0');
}

/** Chart colours matching the active palette (see .mk-dark in app.css). */
export function chartPalette(dark: boolean) {
	return dark
		? { label: '#98a1b0', grid: '#343d47', legend: '#b0b8c4', tooltip: 'dark' as const }
		: { label: '#8486a7', grid: '#eaedf1', legend: '#5d7186', tooltip: 'light' as const };
}
