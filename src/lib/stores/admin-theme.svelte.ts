// Admin dark-mode state, shared between the shell (which owns the toggle) and any
// page that renders charts — ApexCharts paints with literal colors, so chart-bearing
// pages re-derive their options from this instead of hardcoding a light palette.
import { browser } from '$app/environment';

export const adminTheme = $state({
	dark: browser ? localStorage.getItem('mk-admin-dark') === '1' : false
});

export function toggleAdminDark(): void {
	adminTheme.dark = !adminTheme.dark;
	if (browser) localStorage.setItem('mk-admin-dark', adminTheme.dark ? '1' : '0');
}

/** Chart colors matching the active palette (see .mk-dark in app.css). */
export function chartPalette(dark: boolean) {
	return dark
		? { label: '#98a1b0', grid: '#343d47', legend: '#b0b8c4', tooltip: 'dark' as const }
		: { label: '#8486a7', grid: '#eaedf1', legend: '#5d7186', tooltip: 'light' as const };
}
