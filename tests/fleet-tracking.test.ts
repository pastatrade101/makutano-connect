// Fleet tracking: the rules that must hold whether or not a GPS server is reachable.
//
// The adversary here is not a hacker, it is a plausible-looking implementation.
// Two mistakes would each be quiet and expensive:
//
//   Writing only trips.vehicle_id on assignment. That column is new; the READINESS
//   check and the blocked-trip SQL both read trips.vehicle, the TEXT. A structured
//   assignment that skipped the snapshot would mark every trip in the tenant as
//   unable to depart while looking, in the database, like a correct assignment.
//
//   Calling a device LIVE because it exists. A tracker parked in a yard for a week
//   still answers; saying "live" about it invites somebody to stop worrying about a
//   vehicle they should be phoning about.
//
// Traccar is never contacted. The adapter is driven through a mocked fetch, which
// is what makes these tests honest about what they prove: the NORMALISATION and the
// RULES, not connectivity.
import { afterEach, describe, expect, it, vi } from 'vitest';

// env() validates the WHOLE environment on first read, so a test touching any one
// variable has to satisfy the required ones too. Same defaults the other suites use.
process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

import { effectivePermissions, permissionsForRole } from '../src/lib/server/auth/permissions';
import { vehicleSnapshotText } from '../src/lib/server/vehicles';
import { nextForTrip } from '../src/lib/next-action';
import { readinessFor } from '../src/lib/server/trips';
import { LIVE_WITHIN_MS, RECENT_WITHIN_MS, TRACKING_LABEL, stateForAge } from '../src/lib/server/tracking/types';

/* ------------------------------------------------------------ snapshot ----- */

describe('the vehicle snapshot written onto a trip', () => {
	it('is a plain readable string, never JSON or an id', () => {
		const text = vehicleSnapshotText({
			name: 'Land Cruiser 3',
			registration: 'T 123 ABC',
			make: 'Toyota',
			model: 'Land Cruiser'
		});
		expect(text).toBe('Toyota Land Cruiser T 123 ABC');
		// A shipped Flutter client reads this column as `as String?`. An object here
		// throws inside build() and blanks the trip screen for every installed copy.
		expect(typeof text).toBe('string');
		expect(text).not.toContain('{');
	});

	it('falls back to the name when make and model are unknown', () => {
		expect(vehicleSnapshotText({ name: 'Old Hilux', registration: 'T 999 ZZZ' })).toBe('Old Hilux T 999 ZZZ');
		expect(vehicleSnapshotText({ name: 'Spare 4x4' })).toBe('Spare 4x4');
	});

	it('never returns an empty string, because empty means "not assigned" to readiness', () => {
		// readinessFor() reads Boolean(trip.vehicle?.trim()). A snapshot that trims to
		// nothing is indistinguishable from no vehicle at all.
		for (const v of [
			{ name: 'A', registration: '   ' },
			{ name: 'B', make: '  ', model: '  ' },
			{ name: 'C' }
		]) {
			expect(vehicleSnapshotText(v).trim().length).toBeGreaterThan(0);
		}
	});
});

/* --------------------------------------------------------------- state ----- */

describe('tracking state is derived from the fix, not from the device existing', () => {
	const now = Date.UTC(2026, 0, 1, 12, 0, 0);
	const ago = (ms: number) => new Date(now - ms);

	it('calls a fresh fix LIVE', () => {
		expect(stateForAge(ago(60_000), now)).toBe('LIVE');
	});

	it('refuses to call a stale fix LIVE', () => {
		expect(stateForAge(ago(LIVE_WITHIN_MS + 1), now)).toBe('RECENT');
		expect(stateForAge(ago(RECENT_WITHIN_MS + 1), now)).toBe('STALE');
		expect(stateForAge(ago(7 * 24 * 3600 * 1000), now)).toBe('STALE');
	});

	it('treats a missing fix as OFFLINE rather than inventing one', () => {
		expect(stateForAge(null, now)).toBe('OFFLINE');
		expect(stateForAge(undefined, now)).toBe('OFFLINE');
	});

	it('gives every state words an operator can read', () => {
		for (const state of ['NOT_CONFIGURED', 'LIVE', 'RECENT', 'STALE', 'OFFLINE', 'UNAVAILABLE'] as const) {
			expect(TRACKING_LABEL[state]).toBeTruthy();
		}
		// "Live" must not be the word for a state that is not live.
		expect(TRACKING_LABEL.STALE.toLowerCase()).not.toContain('live');
		expect(TRACKING_LABEL.UNAVAILABLE.toLowerCase()).not.toContain('live');
	});
});

/* ------------------------------------------------------------- adapter ----- */

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.unstubAllEnvs();
});

// env() caches the parsed environment on first read, so a test that changes a
// variable has to hand the module registry back before importing the adapter.
async function traccar(vars: Record<string, string> = {}) {
	vi.resetModules();
	vi.stubEnv('TRACCAR_BASE_URL', vars.TRACCAR_BASE_URL ?? 'https://gps.example.invalid');
	vi.stubEnv('TRACCAR_TOKEN', vars.TRACCAR_TOKEN ?? 'test-token');
	vi.stubEnv('TRACCAR_USERNAME', vars.TRACCAR_USERNAME ?? '');
	vi.stubEnv('TRACCAR_PASSWORD', vars.TRACCAR_PASSWORD ?? '');
	const { TraccarProvider } = await import('../src/lib/server/tracking/traccar');
	return new TraccarProvider();
}

const mockJson = (payloads: unknown[]) => {
	let call = 0;
	globalThis.fetch = vi.fn(async () => {
		const body = payloads[Math.min(call++, payloads.length - 1)];
		return new Response(JSON.stringify(body), { status: 200 });
	}) as unknown as typeof fetch;
};

describe('the Traccar adapter normalises rather than leaks', () => {
	it('converts knots to km/h and picks the fix time', async () => {
		const provider = await traccar();
		mockJson([
			[{ status: 'online' }],
			[{ latitude: -2.3333, longitude: 34.8333, speed: 10, course: 90, fixTime: new Date().toISOString() }]
		]);
		const snap = await provider.snapshot('dev-1');
		expect(snap.position?.latitude).toBeCloseTo(-2.3333, 4);
		// 10 knots is 18.52 km/h, and an operator reads km/h.
		expect(snap.position?.speedKph).toBe(19);
		expect(snap.state).toBe('LIVE');
		// Nothing Traccar-shaped survives the boundary.
		expect(Object.keys(snap.position ?? {})).not.toContain('fixTime');
		expect(Object.keys(snap.position ?? {})).not.toContain('deviceId');
	});

	it('drops a null-island fix instead of putting a safari in the Atlantic', async () => {
		const provider = await traccar();
		mockJson([[{ status: 'online' }], [{ latitude: 0, longitude: 0, fixTime: new Date().toISOString() }]]);
		const snap = await provider.snapshot('dev-1');
		expect(snap.position).toBeNull();
		expect(snap.state).toBe('OFFLINE');
	});

	it('reports UNAVAILABLE, not an exception, when the server is unreachable', async () => {
		const provider = await traccar();
		globalThis.fetch = vi.fn(async () => {
			throw new Error('ECONNREFUSED gps.example.invalid');
		}) as unknown as typeof fetch;
		const snap = await provider.snapshot('dev-1');
		expect(snap.state).toBe('UNAVAILABLE');
		expect(snap.position).toBeNull();
		// The operator is told it is unavailable; they are not shown a hostname.
		expect(snap.message).toBeTruthy();
		expect(snap.message).not.toContain('ECONNREFUSED');
		expect(snap.message).not.toContain('example.invalid');
	});

	it('keeps the configured secret out of the LOG, not just the message', async () => {
		// Found by probing, not by design: the operator-facing message was already
		// clean, but the logged reason echoed whatever the error said — and an error
		// from a request carrying an Authorization header can quote it back.
		const provider = await traccar({ TRACCAR_TOKEN: 'super-secret-token-value' });
		const logged: string[] = [];
		const spy = vi.spyOn(console, 'warn').mockImplementation((...a) => logged.push(a.join(' ')));
		globalThis.fetch = vi.fn(async () => {
			throw new Error('connect failed for token super-secret-token-value');
		}) as unknown as typeof fetch;
		const snap = await provider.snapshot('dev-1');
		spy.mockRestore();
		expect(snap.message).not.toContain('super-secret-token-value');
		expect(logged.join(' ')).not.toContain('super-secret-token-value');
	});

	it('returns an empty history rather than failing the page', async () => {
		const provider = await traccar();
		globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		const h = await provider.history('dev-1', new Date(0), new Date());
		expect(h.positions).toEqual([]);
		expect(h.truncated).toBe(false);
	});

	it('orders history oldest-first and keeps true coordinates', async () => {
		const provider = await traccar();
		const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 8, m)).toISOString();
		mockJson([
			[
				{ latitude: -2.4, longitude: 34.9, fixTime: t(30) },
				{ latitude: -2.3, longitude: 34.8, fixTime: t(0) }
			]
		]);
		const h = await provider.history('dev-1', new Date(0), new Date());
		expect(h.positions.map((p) => p.longitude)).toEqual([34.8, 34.9]);
		// A polyline is drawn from these verbatim. No bow, no smoothing, no
		// re-projection — the stylised leg curves used elsewhere would draw a path
		// the vehicle never took.
		expect(h.positions[0].latitude).toBe(-2.3);
		expect(h.positions[1].latitude).toBe(-2.4);
	});

	it('says NOT_CONFIGURED, not UNAVAILABLE, when there is no backend', async () => {
		// This assertion used to expect UNAVAILABLE and that was the bug: a
		// deployment without tracking has not failed at anything.
		const provider = await traccar({ TRACCAR_BASE_URL: '', TRACCAR_TOKEN: '' });
		expect(provider.isConfigured()).toBe(false);
		const snap = await provider.snapshot('dev-1');
		expect(snap.state).toBe('NOT_CONFIGURED');
	});
});

/* ----------------------------------------------------- state precedence ----- */

describe('NOT_CONFIGURED and UNAVAILABLE mean different things', () => {
	it('an unconfigured deployment is NOT an outage, even with a device mapped', async () => {
		// The bug this replaces: a vehicle with a tracker on a deployment with no
		// tracking backend reported "temporarily unavailable" AND "not configured",
		// sending an operator to look for a fault that did not exist.
		const provider = await traccar({ TRACCAR_BASE_URL: '', TRACCAR_TOKEN: '' });
		const snap = await provider.snapshot('a-real-device-ref');
		expect(snap.state).toBe('NOT_CONFIGURED');
		expect(snap.state).not.toBe('UNAVAILABLE');
		// Nothing that reads like an outage.
		expect(snap.message ?? '').not.toMatch(/unavailable|failed|error/i);
	});

	it('UNAVAILABLE is reserved for a request that really failed', async () => {
		const provider = await traccar();
		globalThis.fetch = vi.fn(async () => {
			throw new Error('ETIMEDOUT');
		}) as unknown as typeof fetch;
		const snap = await provider.snapshot('dev-1');
		expect(snap.state).toBe('UNAVAILABLE');
	});

	it('gives every state exactly one phrase, and no two share it', () => {
		const phrases = Object.values(TRACKING_LABEL);
		expect(new Set(phrases).size).toBe(phrases.length);
		expect(TRACKING_LABEL.NOT_CONFIGURED).toBe('Tracking not configured');
		expect(TRACKING_LABEL.UNAVAILABLE).toBe('Tracking temporarily unavailable');
		expect(TRACKING_LABEL.OFFLINE).toBe('Tracker offline');
		expect(TRACKING_LABEL.STALE).toBe('Last position is stale');
		expect(TRACKING_LABEL.RECENT).toBe('Recently updated');
		expect(TRACKING_LABEL.LIVE).toBe('Live');
		// The two that used to appear together must not contain each other.
		expect(TRACKING_LABEL.NOT_CONFIGURED).not.toContain('unavailable');
		expect(TRACKING_LABEL.UNAVAILABLE).not.toContain('not configured');
	});
});

/* ------------------------------------------------------- what to do next ----- */

describe('the trip page uses the shared next-action resolver', () => {
	const can = { trips: true, tripsWrite: true };

	it('says complete setup while something critical is missing', () => {
		const n = nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 1 }, can);
		expect(n?.key).toBe('complete_trip_setup');
		expect(n?.label).toBe('Complete setup');
		// The web button must not offer a departure this resolver has not agreed to.
		expect(n?.key).not.toBe('mark_trip_ready');
	});

	it('says mark ready once nothing critical is left', () => {
		const n = nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 0 }, can);
		expect(n?.key).toBe('mark_trip_ready');
		expect(n?.label).toBe('Mark ready');
	});

	it('offers departure only once it is due', () => {
		expect(nextForTrip({ id: 't1', status: 'READY', missingCritical: 0, daysToDeparture: 14 }, can)).toBeNull();
		const due = nextForTrip({ id: 't1', status: 'READY', missingCritical: 0, daysToDeparture: 0 }, can);
		expect(due?.label).toBe('Start trip');
	});

	it('says nothing once the trip is over', () => {
		expect(nextForTrip({ id: 't1', status: 'COMPLETED', missingCritical: 0 }, can)).toBeNull();
	});
});

/* --------------------------------------------------- blocker signposting ----- */

describe('every readiness blocker still says where it is fixed', () => {
	it('gives each check a destination', () => {
		const r = readinessFor(
			{
				bookingId: 'b1', adults: 2, children: 0, startDate: null, accommodation: null,
				vehicle: null, driver: null, guide: null, hotelConfirmed: false
			} as never,
			{ status: 'CONFIRMED', amountPaid: '0', balanceDue: '100' } as never,
			[]
		);
		const blockers = r.missing.filter((c) => c.critical);
		expect(blockers.length).toBeGreaterThan(0);
		// The point of the earlier fix: a named blocker always has somewhere to go.
		for (const b of blockers) {
			expect(b.fix, `${b.key} has no destination`).toBeTruthy();
			expect(Boolean(b.fix?.href || b.fix?.tab)).toBe(true);
		}
		// Dates live on the booking, which is why they were a dead end before.
		expect(r.missing.find((c) => c.key === 'dates')?.fix?.href).toContain('/app/bookings/');
	});
});

/* --------------------------------------------------------- permissions ----- */

describe('who may see and edit the fleet', () => {
	it('lets operations edit vehicles and everyone operational read them', () => {
		expect(permissionsForRole('OPERATIONS')).toContain('vehicles:write');
		expect(permissionsForRole('OPERATIONS')).toContain('vehicles:read');
		expect(permissionsForRole('VIEWER')).toContain('vehicles:read');
		expect(permissionsForRole('VIEWER')).not.toContain('vehicles:write');
	});

	it('gives an owner both, since they inherit everything a tenant may do', () => {
		expect(permissionsForRole('OWNER')).toContain('vehicles:write');
	});

	it('adds no tracking permission of its own', () => {
		// Where a vehicle is, is a property of the trip and the vehicle. A third key
		// would only be a third thing to forget to grant.
		expect(permissionsForRole('OWNER')).not.toContain('tracking:read');
	});

	it('still honours a per-member override', () => {
		const locked = effectivePermissions('OPERATIONS', { 'vehicles:write': false });
		expect(locked).not.toContain('vehicles:write');
		expect(locked).toContain('vehicles:read');
	});
});
