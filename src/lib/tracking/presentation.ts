/**
 * How a tracking state LOOKS. The state itself is decided on the server —
 * types.ts / stateForAge — and nothing here re-derives it from an age.
 *
 * Two rules the map and the list both follow:
 *   colour is never the only carrier (every state has a word), and
 *   a provider fault is drawn as a fault, not as an offline vehicle.
 */
import type { TrackingState } from '$lib/server/tracking/types';

export type Tone = 'success' | 'warning' | 'muted';

export const STATE_TONE: Record<TrackingState, Tone> = {
	LIVE: 'success',
	RECENT: 'success',
	STALE: 'warning',
	OFFLINE: 'muted',
	NOT_CONFIGURED: 'muted',
	UNAVAILABLE: 'warning'
};

/** Text and dot classes, from the app's own palette. */
export const TONE_TEXT: Record<Tone, string> = {
	success: 'text-success',
	warning: 'text-warning',
	muted: 'text-slate-400'
};
export const TONE_DOT: Record<Tone, string> = {
	success: 'bg-success',
	warning: 'bg-warning',
	muted: 'bg-slate-300'
};

/** Marker colours for Leaflet, which takes hex, not classes. Matches the palette above. */
export const MARKER_HEX: Record<Tone, string> = {
	// The same three colours the text and dots use (src/app.css @theme), so a pin
	// and the row beside it never disagree about how a vehicle is doing.
	success: '#3d6b52',
	warning: '#a9722a',
	muted: '#94a3b8'
};

/** Short badge text for a list row. The full sentence lives in TRACKING_LABEL. */
export const STATE_BADGE: Record<TrackingState, string> = {
	LIVE: 'LIVE',
	RECENT: 'RECENT',
	STALE: 'STALE',
	OFFLINE: 'OFFLINE',
	NOT_CONFIGURED: 'NOT SET UP',
	UNAVAILABLE: 'UNAVAILABLE'
};

/** Whether a state means "we could not find out" rather than "the vehicle is quiet". */
export const isProviderFault = (state: TrackingState): boolean => state === 'UNAVAILABLE';

/** Whether there is a position worth putting on a map. */
export const hasPosition = (v: { latitude: number | null; longitude: number | null }): boolean =>
	v.latitude != null && v.longitude != null && Number.isFinite(v.latitude) && Number.isFinite(v.longitude);

/**
 * Order for a fleet list: the vehicles an operator needs to look at first.
 * Reporting first, then quiet, then faults, then unconfigured; ties by name.
 */
const RANK: Record<TrackingState, number> = {
	LIVE: 0,
	RECENT: 1,
	STALE: 2,
	OFFLINE: 3,
	UNAVAILABLE: 4,
	NOT_CONFIGURED: 5
};
export function fleetOrder<T extends { state: TrackingState; name: string }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
}

/** Movement text from a speed, or a dash. Under walking pace is parked, not "2 km/h". */
export function movement(speedKph: number | null | undefined): string {
	if (speedKph == null || !Number.isFinite(speedKph)) return '—';
	return speedKph > 3 ? `${Math.round(speedKph)} km/h` : 'Parked';
}
