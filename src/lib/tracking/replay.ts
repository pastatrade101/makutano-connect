/**
 * Route replay, entirely on the client.
 *
 * A history is fetched ONCE for a range and everything here works on that
 * array: stepping, scrubbing, distance. Nothing in this file talks to a server,
 * which is the point — dragging a timeline must never become a request per
 * pixel.
 *
 * Pure and dependency-free so it is testable without a map or a browser.
 */

/** A recorded fix as the history endpoints send it: [latitude, longitude, epoch ms]. */
export type Fix = [number, number, number];

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two points, in metres. */
export function haversineMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(bLat - aLat);
	const dLng = toRad(bLng - aLng);
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Distance travelled up to each fix, in metres, following the fixes IN ORDER.
 *
 * Index i is the route length from the first fix to fix i, so the last entry is
 * the whole route. This is the sum of the legs the tracker actually recorded —
 * not the straight line from start to end, which for a safari loop can be a
 * few hundred metres for a day of driving.
 */
export function cumulativeMetres(fixes: readonly Fix[]): number[] {
	const out: number[] = [];
	let total = 0;
	for (let i = 0; i < fixes.length; i += 1) {
		if (i > 0) {
			const [aLat, aLng] = fixes[i - 1];
			const [bLat, bLng] = fixes[i];
			total += haversineMetres(aLat, aLng, bLat, bLng);
		}
		out.push(total);
	}
	return out;
}

export function formatKm(metres: number): string {
	if (metres < 1000) return `${Math.round(metres)} m`;
	return `${(metres / 1000).toFixed(1)} km`;
}

/** Keep a replay index inside the route. An empty route has no valid index. */
export function clampIndex(index: number, length: number): number {
	if (length <= 0) return -1;
	if (!Number.isFinite(index)) return 0;
	return Math.min(length - 1, Math.max(0, Math.round(index)));
}

/** Next/previous, stopping at the ends rather than wrapping — a replay that loops lies about where the route ended. */
export function step(index: number, length: number, by: 1 | -1): number {
	return clampIndex(index + by, length);
}

/** The ranges the history endpoint honestly supports: `hours`, 1 to 24, ending now. */
export type HistoryPreset = 'today' | '6h' | '24h' | 'custom';

export const HISTORY_MAX_HOURS = 24;

/**
 * Hours to ask for. "Today" is the hours since local midnight, which is what an
 * operator means by it; it is never more than 24 because the backend keeps a
 * day, and never less than 1 because a zero-hour window is not a route.
 *
 * "Custom" is a bounded number of hours ending now — NOT a date range. The
 * backend takes `hours` only, and pretending otherwise would be inventing an
 * API. The bound is enforced here as well as server-side.
 */
export function hoursForPreset(preset: HistoryPreset, now: Date, customHours = 12): number {
	switch (preset) {
		case '6h':
			return 6;
		case '24h':
			return HISTORY_MAX_HOURS;
		case 'today': {
			const midnight = new Date(now);
			midnight.setHours(0, 0, 0, 0);
			const elapsed = (now.getTime() - midnight.getTime()) / 3_600_000;
			return Math.min(HISTORY_MAX_HOURS, Math.max(1, Math.ceil(elapsed)));
		}
		case 'custom':
			return Math.min(HISTORY_MAX_HOURS, Math.max(1, Math.round(Number.isFinite(customHours) ? customHours : 1)));
	}
}

/**
 * What to tell the operator when the backend cut the route.
 *
 * Uses the backend's own count and limit — never a number typed into the UI —
 * and says which END was kept, because the server keeps the most recent points.
 */
export function truncationNotice(points: number, limit: number | null | undefined): string {
	const n = points.toLocaleString('en-US');
	if (limit && limit > 0 && points >= limit) return `Showing the most recent ${n} recorded points — earlier points in this range were cut off.`;
	return `Showing the most recent ${n} recorded points — the route for this range is incomplete.`;
}

/** Replay speeds the operator can pick. Real time is 1×; a day of fixes at 1× is a long afternoon. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * How long to wait before advancing to the next fix, in ms, at a given speed.
 *
 * Fixes are unevenly spaced — a parked vehicle records every few minutes, a
 * moving one every few seconds — so a fixed tick would make parking fly past
 * and driving crawl. Advance in proportion to the real gap, compressed so a
 * ten-minute gap becomes a couple of seconds rather than ten minutes of
 * staring at a stationary dot, and floored so nothing is faster than the eye.
 */
export function replayDelayMs(fixes: readonly Fix[], index: number, speed: ReplaySpeed): number {
	const next = index + 1;
	if (next >= fixes.length) return 0;
	const gap = Math.max(0, fixes[next][2] - fixes[index][2]);
	// 120:1 compression, capped: ten minutes parked becomes five seconds, and an
	// hour-long gap is still five seconds rather than thirty. Floored at 120 ms so
	// a burst of one-second fixes does not blur into a line.
	const compressed = Math.min(5_000, gap / 120);
	return Math.max(120, compressed) / speed;
}
