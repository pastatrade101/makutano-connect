// The tracking workspace: replay, presentation, and the history contract.
//
// Everything here runs without a map, a browser or a provider. The replay is
// client-side by design — a history is fetched once and stepped locally — so
// its arithmetic is plain functions, and plain functions get plain tests.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	clampIndex,
	cumulativeMetres,
	formatKm,
	haversineMetres,
	hoursForPreset,
	replayDelayMs,
	step,
	truncationNotice,
	type Fix
} from '../src/lib/tracking/replay';
import {
	STATE_TONE,
	STATE_BADGE,
	fleetOrder,
	hasPosition,
	isProviderFault,
	movement
} from '../src/lib/tracking/presentation';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const fix = (lat: number, lng: number, t: number): Fix => [lat, lng, t];

describe('distance is the route the tracker recorded, not the displacement', () => {
	it('knows Arusha to Seronera is roughly 230 km as the crow flies', () => {
		// Arusha (-3.3869, 36.6830) → Seronera (-2.4335, 34.8231).
		const m = haversineMetres(-3.3869, 36.683, -2.4335, 34.8231);
		expect(m / 1000).toBeGreaterThan(225);
		expect(m / 1000).toBeLessThan(240);
	});

	it('accumulates leg by leg, in order', () => {
		const route = [fix(0, 0, 0), fix(0, 0.01, 1), fix(0, 0.02, 2), fix(0, 0.01, 3)];
		const cum = cumulativeMetres(route);
		expect(cum).toHaveLength(4);
		expect(cum[0]).toBe(0);
		// Each 0.01° of longitude at the equator is ~1,113 m.
		expect(cum[1]).toBeCloseTo(1113, -1);
		expect(cum[2]).toBeCloseTo(2226, -1);
		// Doubling back ADDS distance. Straight-line displacement would say 1,113.
		expect(cum[3]).toBeCloseTo(3339, -1);
	});

	it('is zero for nothing and for a single fix', () => {
		expect(cumulativeMetres([])).toEqual([]);
		expect(cumulativeMetres([fix(-3, 36, 0)])).toEqual([0]);
	});

	it('formats metres below a kilometre and kilometres above', () => {
		expect(formatKm(640)).toBe('640 m');
		expect(formatKm(12_345)).toBe('12.3 km');
	});
});

describe('replay stays inside the route', () => {
	it('clamps to the ends and never wraps', () => {
		expect(clampIndex(-5, 10)).toBe(0);
		expect(clampIndex(99, 10)).toBe(9);
		expect(step(9, 10, 1)).toBe(9);
		expect(step(0, 10, -1)).toBe(0);
		expect(step(4, 10, 1)).toBe(5);
	});

	it('has no valid index for an empty route', () => {
		expect(clampIndex(0, 0)).toBe(-1);
		expect(step(0, 0, 1)).toBe(-1);
	});

	it('advances in proportion to the real gap, compressed and floored', () => {
		const route = [fix(0, 0, 0), fix(0, 0, 10 * 60_000), fix(0, 0, 10 * 60_000 + 1_000)];
		// Ten minutes parked becomes five seconds at 1×, half that at 2×.
		expect(replayDelayMs(route, 0, 1)).toBe(5_000);
		expect(replayDelayMs(route, 0, 2)).toBe(2_500);
		// A one-second gap is floored so the eye can follow it.
		expect(replayDelayMs(route, 1, 1)).toBe(120);
		// Nothing after the last fix.
		expect(replayDelayMs(route, 2, 1)).toBe(0);
	});
});

describe('history ranges are only what the backend honestly supports', () => {
	it('Today is hours since local midnight, at least one, at most a day', () => {
		const at = (h: number, m = 0) => {
			const d = new Date();
			d.setHours(h, m, 0, 0);
			return d;
		};
		expect(hoursForPreset('today', at(0, 5))).toBe(1);
		expect(hoursForPreset('today', at(9, 30))).toBe(10);
		expect(hoursForPreset('today', at(23, 59))).toBe(24);
	});

	it('custom is a bounded number of hours ending now, never a date range', () => {
		expect(hoursForPreset('custom', new Date(), 0)).toBe(1);
		expect(hoursForPreset('custom', new Date(), 12)).toBe(12);
		expect(hoursForPreset('custom', new Date(), 500)).toBe(24);
		expect(hoursForPreset('custom', new Date(), Number.NaN)).toBe(1);
	});

	it('the fixed presets are what they say', () => {
		expect(hoursForPreset('6h', new Date())).toBe(6);
		expect(hoursForPreset('24h', new Date())).toBe(24);
	});
});

describe('a cut-off route says so, with the real numbers', () => {
	it('names the count and which end was kept', () => {
		expect(truncationNotice(2000, 2000)).toBe(
			'Showing the most recent 2,000 recorded points — earlier points in this range were cut off.'
		);
	});
	it('still warns when the limit is unknown', () => {
		expect(truncationNotice(1500, null)).toContain('incomplete');
	});
});

describe('a provider fault is never drawn as an offline vehicle', () => {
	it('gives UNAVAILABLE the warning tone and OFFLINE the muted one', () => {
		expect(STATE_TONE.UNAVAILABLE).toBe('warning');
		expect(STATE_TONE.OFFLINE).toBe('muted');
		expect(STATE_TONE.UNAVAILABLE).not.toBe(STATE_TONE.OFFLINE);
		expect(isProviderFault('UNAVAILABLE')).toBe(true);
		expect(isProviderFault('OFFLINE')).toBe(false);
	});

	it('every state has a word, and no two share one', () => {
		const words = Object.values(STATE_BADGE);
		expect(new Set(words).size).toBe(words.length);
		for (const w of words) expect(w.trim().length).toBeGreaterThan(0);
	});

	it('orders a fleet by what needs looking at first', () => {
		const rows = [
			{ name: 'b', state: 'NOT_CONFIGURED' as const },
			{ name: 'a', state: 'OFFLINE' as const },
			{ name: 'c', state: 'LIVE' as const },
			{ name: 'd', state: 'UNAVAILABLE' as const },
			{ name: 'e', state: 'STALE' as const }
		];
		expect(fleetOrder(rows).map((r) => r.state)).toEqual(['LIVE', 'STALE', 'OFFLINE', 'UNAVAILABLE', 'NOT_CONFIGURED']);
	});

	it('does not put a vehicle with no fix on the map', () => {
		expect(hasPosition({ latitude: null, longitude: null })).toBe(false);
		expect(hasPosition({ latitude: -3.4, longitude: 36.7 })).toBe(true);
		expect(hasPosition({ latitude: Number.NaN, longitude: 36.7 })).toBe(false);
	});

	it('reads walking pace as parked', () => {
		expect(movement(null)).toBe('—');
		expect(movement(2)).toBe('Parked');
		expect(movement(41.6)).toBe('42 km/h');
	});
});

/* ---------------------------------------------------- the history contract ---- */

const originalFetch = globalThis.fetch;

describe('history keeps the most recent points when a day is too long', () => {
	it('drops the EARLIEST fixes and says so', async () => {
		vi.resetModules();
		vi.stubEnv('TRACCAR_BASE_URL', 'https://gps.example.invalid');
		const { TraccarProvider, MAX_POSITIONS } = await import('../src/lib/server/tracking/traccar');
		const provider = new TraccarProvider({ baseUrl: 'https://gps.example.invalid', username: 'u', password: 'p' });
		const n = MAX_POSITIONS + 5;
		const t0 = Date.parse('2026-09-05T06:00:00Z');
		const positions = Array.from({ length: n }, (_, i) => ({
			deviceId: 1,
			latitude: -3.4,
			longitude: 36.7 + i * 0.0001,
			fixTime: new Date(t0 + i * 1000).toISOString()
		}));
		globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			const body = url.includes('/devices') ? [{ id: 1, uniqueId: 'ref-a' }] : positions;
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;
		try {
			const h = await provider.history('ref-a', new Date(t0), new Date(t0 + n * 1000));
			expect(h.truncated).toBe(true);
			expect(h.positions).toHaveLength(MAX_POSITIONS);
			// The LAST recorded fix survives; the first five are the ones dropped.
			expect(h.positions[h.positions.length - 1].recordedAt.getTime()).toBe(t0 + (n - 1) * 1000);
			expect(h.positions[0].recordedAt.getTime()).toBe(t0 + 5 * 1000);
			// Still oldest-first.
			for (let i = 1; i < h.positions.length; i += 1) {
				expect(h.positions[i].recordedAt.getTime()).toBeGreaterThan(h.positions[i - 1].recordedAt.getTime());
			}
		} finally {
			globalThis.fetch = originalFetch;
			vi.unstubAllEnvs();
		}
	});
});

describe('nothing that names a provider device reaches a client', () => {
	const files = [
		'src/routes/app/tracking/+page.server.ts',
		'src/routes/app/tracking/positions/+server.ts',
		'src/routes/app/tracking/history/+server.ts',
		'src/routes/api/mobile/v1/vehicles/+server.ts',
		'src/routes/api/mobile/v1/vehicles/[id]/tracking/+server.ts',
		'src/routes/api/mobile/v1/trips/[id]/tracking/+server.ts'
	];
	for (const f of files) {
		it(`${f} sends no reference, device id or credential`, () => {
			const src = readFileSync(f, 'utf8');
			// The response objects. A `tracked: Boolean(v.trackerDeviceRef)` is fine —
			// it is a boolean — but the ref itself, a provider id or a token is not.
			const responses = src.split('return').slice(1).join('return');
			expect(responses).not.toMatch(/trackerDeviceRef\s*[,}]/);
			expect(responses).not.toMatch(/deviceRef\s*:/);
			expect(responses).not.toMatch(/providerDeviceId|uniqueId|accessToken|password/);
		});
	}

	it('the history endpoints accept only a vehicle or trip id and an hour count', () => {
		const web = readFileSync('src/routes/app/tracking/history/+server.ts', 'utf8');
		expect(web).toMatch(/searchParams\.get\('vehicle'\)/);
		expect(web).toMatch(/searchParams\.get\('hours'\)/);
		expect(web).not.toMatch(/searchParams\.get\('(device|ref|deviceId|uniqueId)'\)/);
		expect(web).toContain('limit: HISTORY_POINT_LIMIT');
		for (const f of [
			'src/routes/api/mobile/v1/vehicles/[id]/tracking/+server.ts',
			'src/routes/api/mobile/v1/trips/[id]/tracking/+server.ts'
		]) {
			const src = readFileSync(f, 'utf8');
			expect(src).toContain("searchParams.get('hours')");
			expect(src).toMatch(/Math\.min\(MAX_HOURS/);
			expect(src).toContain('limit: HISTORY_POINT_LIMIT');
		}
	});
});

describe('the Live Map page polls the fleet, once, and replays locally', () => {
	const page = readFileSync('src/routes/app/tracking/+page.svelte', 'utf8');
	it('draws every vehicle from the one fleet poll rather than one request per marker', () => {
		expect(page).toContain("fetch('/app/tracking/positions')");
		expect(page).not.toMatch(/fetch\(`\/app\/tracking\/positions\?/);
		expect(page).toMatch(/markers\b/);
	});
	it('fetches history once per range and never on scrub', () => {
		// The only history request is inside loadHistory(); the scrubber only
		// changes an index.
		const calls = page.match(/fetch\(`\/app\/tracking\/history/g) ?? [];
		expect(calls).toHaveLength(1);
		expect(page).toMatch(/oninput=\{[^}]*replayIndex/);
	});
	it('tells the operator when the route was cut off', () => {
		expect(page).toContain('truncationNotice(');
	});
	it('stops polling when the tab is hidden and on destroy', () => {
		expect(page).toContain("document.visibilityState === 'visible'");
		expect(page).toMatch(/clearInterval\(poll\)/);
	});
});
