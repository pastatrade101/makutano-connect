// Trips — the operational half of a sale.
//
// What matters here is not that a row can be written; it is that the separation
// between commercial and operational actually holds. Every test below is a way
// that separation could quietly leak: a second trip for one booking, a price
// copied where operations could edit it, a trip declared ready without a driver,
// or a passport visible to somebody who should not see one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liftLimits, provisionTestTenant } from './support';
import { nextForTrip, handoverForBooking } from '../src/lib/next-action';
import { readinessFor } from '../src/lib/server/trips';
import type { Booking, Trip } from '../src/lib/server/db/schema';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

// ── readiness is pure, so it can be tested without a database ─────────────────

const trip = (over: Partial<Trip> = {}): Trip =>
	({
		adults: 2,
		children: 0,
		accommodation: 'Serena Lodge',
		vehicle: 'T 123 ABC',
		driver: 'Michael',
		guide: 'Joseph',
		hotelConfirmed: true,
		startDate: new Date('2026-10-12'),
		status: 'PREPARING',
		...over
	}) as Trip;

const booking = (over: Partial<Booking> = {}): Booking =>
	({ status: 'CONFIRMED', amountPaid: '500.00', balanceDue: '0.00', ...over }) as Booking;

const passports = (n: number) => Array.from({ length: n }, () => ({ passportNumber: 'A1234567' }));

describe('trip readiness', () => {
	it('is complete when everything operational is in place', () => {
		const r = readinessFor(trip(), booking(), passports(2));
		expect(r.percent).toBe(100);
		expect(r.canBeReady).toBe(true);
		expect(r.missing).toHaveLength(0);
	});

	it('blocks departure on a missing driver, however high the percentage', () => {
		const r = readinessFor(trip({ driver: null }), booking(), passports(2));
		// This is the whole point of the critical flag: nine of ten checks passing
		// still cannot put a trip on the road without somebody to drive it.
		expect(r.percent).toBeGreaterThan(80);
		expect(r.canBeReady).toBe(false);
		expect(r.missing.map((c) => c.key)).toContain('driver');
	});

	it('does not block departure on an outstanding balance', () => {
		// Plenty of operators run the trip and collect on arrival. Money is the
		// booking's problem; blocking here would put operations in charge of it.
		const r = readinessFor(trip(), booking({ balanceDue: '800.00' }), passports(2));
		expect(r.canBeReady).toBe(true);
		expect(r.missing.map((c) => c.key)).toContain('balance');
		expect(r.missing.find((c) => c.key === 'balance')?.critical).toBe(false);
	});

	it('does not block departure on missing passports, but does report them', () => {
		const r = readinessFor(trip(), booking(), passports(1));
		expect(r.canBeReady).toBe(true);
		expect(r.missing.map((c) => c.key)).toContain('passports');
	});

	it('counts passports against the real guest count, not the traveller rows present', () => {
		// Two rows for a four-guest trip is the common case — the lead traveller
		// filled in for themselves and a partner. It must not read as complete.
		const r = readinessFor(trip({ adults: 4 }), booking(), passports(2));
		expect(r.checks.find((c) => c.key === 'passports')?.done).toBe(false);
		expect(r.checks.find((c) => c.key === 'passports')?.label).toContain('2/4');
	});

	it('treats an unconfirmed booking as blocking', () => {
		const r = readinessFor(trip(), booking({ status: 'AWAITING_PAYMENT', amountPaid: '0.00' }), passports(2));
		expect(r.canBeReady).toBe(false);
		expect(r.missing.map((c) => c.key)).toEqual(expect.arrayContaining(['booking_confirmed', 'deposit']));
	});
});

describe('what operations should do next', () => {
	const can = { tripsWrite: true, trips: true };

	it('asks for setup while anything critical is outstanding', () => {
		const action = nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 2 }, can);
		expect(action?.key).toBe('complete_trip_setup');
		expect(action?.hint).toContain('2 things');
	});

	it('asks to mark ready once nothing critical is left', () => {
		expect(nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 0 }, can)?.key).toBe('mark_trip_ready');
	});

	it('offers departure only when the trip is actually due', () => {
		// "Start trip" on a departure three weeks out is an invitation to a mistake
		// nobody can undo cleanly.
		expect(nextForTrip({ id: 't1', status: 'READY', missingCritical: 0, daysToDeparture: 21 }, can)).toBeNull();
		expect(nextForTrip({ id: 't1', status: 'READY', missingCritical: 0, daysToDeparture: 0 }, can)?.key).toBe(
			'depart_trip'
		);
	});

	it('never points operations at money', () => {
		for (const status of ['PREPARING', 'READY', 'IN_PROGRESS'] as const) {
			const action = nextForTrip({ id: 't1', status, missingCritical: 0, daysToDeparture: 0 }, can);
			expect(action?.href ?? '').not.toContain('/payments');
		}
	});

	it('has nothing to say about a finished trip', () => {
		expect(nextForTrip({ id: 't1', status: 'COMPLETED', missingCritical: 3 }, can)).toBeNull();
		expect(nextForTrip({ id: 't1', status: 'CANCELLED', missingCritical: 3 }, can)).toBeNull();
	});

	it('degrades to read-only rather than offering an action a viewer cannot take', () => {
		const action = nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 1 }, { trips: true });
		expect(action?.label).toBe('Open trip');
		expect(nextForTrip({ id: 't1', status: 'PREPARING', missingCritical: 1 }, {})).toBeNull();
	});
});

describe('the handover', () => {
	const can = { tripsWrite: true };

	it('is offered on an agreed booking that has no trip yet', () => {
		expect(handoverForBooking({ id: 'b1', status: 'CONFIRMED' }, can)?.key).toBe('hand_over_to_operations');
	});

	it('disappears once the booking has been handed over', () => {
		expect(handoverForBooking({ id: 'b1', status: 'CONFIRMED', hasTrip: true }, can)).toBeNull();
	});

	it('is not offered on a draft or a dead booking', () => {
		for (const status of ['DRAFT', 'CANCELLED', 'REFUNDED', 'COMPLETED']) {
			expect(handoverForBooking({ id: 'b1', status }, can)).toBeNull();
		}
	});

	it('is not offered to somebody who cannot prepare trips', () => {
		expect(handoverForBooking({ id: 'b1', status: 'CONFIRMED' }, {})).toBeNull();
	});
});

suite('trips against the database', () => {
	let tenantId: string;
	let bookingId: string;
	let customerId: string;

	beforeAll(async () => {
		const stamp = Date.now();
		tenantId = (await provisionTestTenant({ name: 'Safari Co', slug: `test-trips-${stamp}` })).id;
		await liftLimits(tenantId);

		const { findOrCreateCustomer } = await import('../src/lib/server/customers');
		const customer = await findOrCreateCustomer(tenantId, {
			firstName: 'Smith',
			lastName: 'Family',
			phone: '255700000111'
		});
		customerId = customer.id;

		const { createBooking } = await import('../src/lib/server/bookings');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			startDate: '2026-10-12T00:00:00.000Z',
			endDate: '2026-10-18T00:00:00.000Z',
			adults: 4,
			items: [
				{ title: '6-Day Serengeti Safari', type: 'TOUR', quantity: 4, unitPrice: '2000.00', startDate: '2026-10-12T00:00:00.000Z' },
				{ title: 'Serena Lodge', type: 'HOTEL', quantity: 1, unitPrice: '400.00', startDate: '2026-10-14T00:00:00.000Z' }
			]
		});
		bookingId = b.id;
	}, 120_000);

	afterAll(async () => {
		const { closeDb } = await import('../src/lib/server/db');
		await closeDb();
	});

	it('copies the booking forward without its prices', async () => {
		const { createTripFromBooking, getTripDetail } = await import('../src/lib/server/trips');
		const created = await createTripFromBooking(tenantId, bookingId, {});
		const { trip, items } = await getTripDetail(tenantId, created.id);

		expect(trip.adults).toBe(4);
		expect(trip.startDate?.toISOString().slice(0, 10)).toBe('2026-10-12');
		expect(items).toHaveLength(2);
		// The line came across, but no price did — operations cannot change what the
		// customer was quoted, because there is nowhere here to change it.
		expect(items[0].title).toBe('6-Day Serengeti Safari');
		expect(Object.keys(items[0])).not.toContain('unitPrice');
		// Dated lines land on the right day: the lodge starts on day 3.
		expect(items.find((i) => i.type === 'HOTEL')?.dayNumber).toBe(3);
	}, 60_000);

	it('is idempotent — a second handover returns the same trip', async () => {
		const { createTripFromBooking } = await import('../src/lib/server/trips');
		const first = await createTripFromBooking(tenantId, bookingId, {});
		const second = await createTripFromBooking(tenantId, bookingId, {});
		expect(second.id).toBe(first.id);
	}, 60_000);

	it('refuses to mark a trip ready while critical setup is missing', async () => {
		const { createTripFromBooking, changeTripStatus } = await import('../src/lib/server/trips');
		const t = await createTripFromBooking(tenantId, bookingId, {});
		// Nothing has been set up, so this must fail — and the message must name what
		// is missing, because "not ready" alone sends staff hunting.
		await expect(changeTripStatus(tenantId, t.id, 'READY')).rejects.toThrow(/not ready yet/i);
	}, 60_000);

	it('refuses an illegal transition outright', async () => {
		const { createTripFromBooking, changeTripStatus } = await import('../src/lib/server/trips');
		const t = await createTripFromBooking(tenantId, bookingId, {});
		await expect(changeTripStatus(tenantId, t.id, 'COMPLETED')).rejects.toThrow(/cannot move from PREPARING/i);
	}, 60_000);

	it('will not hand over a draft booking', async () => {
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking } = await import('../src/lib/server/trips');
		const draft = await createBooking(tenantId, {
			customerId,
			status: 'DRAFT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		await expect(createTripFromBooking(tenantId, draft.id, {})).rejects.toThrow(/cannot be handed over/i);
	}, 60_000);

	it('keeps trips invisible across tenants', async () => {
		const other = await provisionTestTenant({ name: 'Other Safari', slug: `test-trips-b-${Date.now()}` });
		const { createTripFromBooking, getTrip, listTrips } = await import('../src/lib/server/trips');
		const mine = await createTripFromBooking(tenantId, bookingId, {});
		await expect(getTrip(other.id, mine.id)).rejects.toThrow(/could not be found/i);
		const theirs = await listTrips(other.id);
		expect(theirs.items).toHaveLength(0);
	}, 120_000);
});
