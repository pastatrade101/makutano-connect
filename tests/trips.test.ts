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
import { criticalMissing, readinessFor } from '../src/lib/server/trips';
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

describe('readiness has exactly one definition', () => {
	// The whole point of the refactor: the mobile work feed used to recompute the
	// critical count in SQL. Two copies of a rule are two rules, and the failure is
	// silent — the phone says a trip can leave and the portal says it cannot.
	// These tests fail the moment the cheap path and the full one disagree.
	const cases: Array<[string, Partial<Trip>, Partial<Booking>]> = [
		['everything present', {}, {}],
		['no driver', { driver: null }, {}],
		['no vehicle or driver', { vehicle: null, driver: null }, {}],
		['no accommodation', { accommodation: null }, {}],
		['no dates', { startDate: null }, {}],
		['unconfirmed booking', {}, { status: 'AWAITING_PAYMENT' }],
		['no deposit', {}, { amountPaid: '0.00' }],
		['balance owing only', {}, { balanceDue: '900.00' }],
		['guide missing only', { guide: null }, {}],
		['hotel unconfirmed only', { hotelConfirmed: false }, {}],
		['nothing at all', { vehicle: null, driver: null, guide: null, accommodation: null, startDate: null, hotelConfirmed: false }, { status: 'DRAFT', amountPaid: '0.00', balanceDue: '5000.00' }]
	];

	for (const [name, overTrip, overBooking] of cases) {
		it(`agrees with the full check: ${name}`, () => {
			const tr = trip(overTrip);
			const bk = booking(overBooking);
			const full = readinessFor(tr, bk, passports(2));
			const cheap = criticalMissing(tr, bk);
			expect(cheap).toBe(full.missing.filter((c) => c.critical).length);
			expect(cheap === 0).toBe(full.canBeReady);
		});
	}

	it('never lets a traveller-dependent check become critical', () => {
		// criticalMissing answers without loading traveller rows, which is only
		// sound while no critical check needs them. trips.ts throws at import if
		// that stops being true; this asserts the property it protects.
		const withPassports = readinessFor(trip(), booking(), passports(2));
		const without = readinessFor(trip(), booking(), []);
		expect(withPassports.canBeReady).toBe(without.canBeReady);
		expect(criticalMissing(trip(), booking())).toBe(0);
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

describe('the Operations role is actually usable', () => {
	// The role was added to the enum, given permissions and offered in the team UI,
	// but both server write paths gate on a separate list that nobody updated — so
	// it could be selected and never assigned. This guards the whole class: a role
	// the UI offers must be a role the server accepts.
	it('offers no role the server will refuse', async () => {
		const { ROLE_OPTIONS, assignableRoles } = await import('../src/lib/server/team');
		for (const option of ROLE_OPTIONS) {
			expect(assignableRoles()).toContain(option.value);
		}
	});

	it('gives Operations trips but never money', async () => {
		const { permissionsForRole } = await import('../src/lib/server/auth/permissions');
		const ops = permissionsForRole('OPERATIONS');
		expect(ops).toEqual(expect.arrayContaining(['trips:read', 'trips:write', 'travelers:read_sensitive']));
		for (const forbidden of ['payments:write', 'payments:verify', 'payments:refund', 'bookings:write']) {
			expect(ops).not.toContain(forbidden);
		}
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

	it('stands the trip down when the booking is cancelled', async () => {
		// Without this a cancelled sale leaves a trip in Upcoming, still telling
		// operations to confirm a hotel for travellers who are not coming.
		const { createBooking, changeBookingStatus } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, getTrip } = await import('../src/lib/server/trips');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const t = await createTripFromBooking(tenantId, b.id, {});
		expect((await getTrip(tenantId, t.id)).status).toBe('PREPARING');

		await changeBookingStatus(tenantId, b.id, 'CANCELLED', {}, 'Traveller pulled out');
		expect((await getTrip(tenantId, t.id)).status).toBe('CANCELLED');
	}, 90_000);

	it('leaves a trip already under way alone when the booking is cancelled', async () => {
		// People are on the ground. That is a conversation, not a status flip.
		const { createBooking, changeBookingStatus } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, getTrip, updateTrip, changeTripStatus } = await import('../src/lib/server/trips');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			startDate: '2026-10-12T00:00:00.000Z',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		await changeBookingStatus(tenantId, b.id, 'CONFIRMED');
		const t = await createTripFromBooking(tenantId, b.id, {});
		await updateTrip(tenantId, t.id, {
			accommodation: 'Serena',
			vehicle: 'T 123 ABC',
			driver: 'Michael'
		});
		// Deposit is the last critical gap. Set it directly rather than driving the
		// whole payment pipeline — this test is about the trip, not about money.
		const { db, schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		await db().update(schema.bookings).set({ amountPaid: '100.00', balanceDue: '0.00' }).where(eq(schema.bookings.id, b.id));
		await changeTripStatus(tenantId, t.id, 'READY');
		await changeTripStatus(tenantId, t.id, 'IN_PROGRESS');

		await changeBookingStatus(tenantId, b.id, 'CANCELLED', {}, 'Cancelled mid-trip');
		expect((await getTrip(tenantId, t.id)).status).toBe('IN_PROGRESS');
	}, 120_000);

	it('lets a booking be handed over again after its trip was cancelled', async () => {
		// The first cut made booking_id unique outright, which meant one cancelled
		// trip locked the sale out of operations forever.
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, changeTripStatus } = await import('../src/lib/server/trips');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const first = await createTripFromBooking(tenantId, b.id, {});
		await changeTripStatus(tenantId, first.id, 'CANCELLED', {}, 'Hotel fell through');

		const second = await createTripFromBooking(tenantId, b.id, {});
		expect(second.id).not.toBe(first.id);
		expect(second.status).toBe('PREPARING');
	}, 90_000);

	it('refuses to hand a trip to somebody who is not a member here', async () => {
		// Any user id that is not an active membership of THIS tenant must be
		// rejected — that covers a stale id, a deactivated colleague, and a user
		// belonging to another business.
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip } = await import('../src/lib/server/trips');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const trip = await createTripFromBooking(tenantId, b.id, {});
		await expect(
			updateTrip(tenantId, trip.id, { operationsUserId: '00000000-0000-4000-8000-000000000000' })
		).rejects.toThrow(/not an active member/i);
	}, 90_000);

	it('demotes a READY trip when the thing that made it ready is taken away', async () => {
		// READY is a claim about the world, and the world moves. A driver quitting
		// the morning before departure must not leave the trip still saying it can go.
		const { createBooking, changeBookingStatus } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip, changeTripStatus, getTrip } = await import('../src/lib/server/trips');
		const { db, schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');

		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			startDate: '2026-11-01T00:00:00.000Z',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		await changeBookingStatus(tenantId, b.id, 'CONFIRMED');
		await db().update(schema.bookings).set({ amountPaid: '100.00', balanceDue: '0.00' }).where(eq(schema.bookings.id, b.id));

		const trip = await createTripFromBooking(tenantId, b.id, {});
		await updateTrip(tenantId, trip.id, { accommodation: 'Serena', vehicle: 'T 1 ABC', driver: 'Michael' });
		await changeTripStatus(tenantId, trip.id, 'READY');
		expect((await getTrip(tenantId, trip.id)).status).toBe('READY');

		await updateTrip(tenantId, trip.id, { driver: null });
		expect((await getTrip(tenantId, trip.id)).status).toBe('PREPARING');
	}, 120_000);

	it('will not let a trip depart if it could not have been marked ready', async () => {
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, changeTripStatus } = await import('../src/lib/server/trips');
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const trip = await createTripFromBooking(tenantId, b.id, {});
		// PREPARING -> IN_PROGRESS is not a legal transition, and even the legal
		// route through READY is gated, so there is no path to departure.
		await expect(changeTripStatus(tenantId, trip.id, 'IN_PROGRESS')).rejects.toThrow(/cannot move from PREPARING/i);
		await expect(changeTripStatus(tenantId, trip.id, 'READY')).rejects.toThrow(/not ready yet/i);
	}, 90_000);

	it('assigns a driver from the registry, keeping the name as a snapshot', async () => {
		// Both columns on purpose: the link says who is registered, the name keeps
		// saying who drove even after that person leaves.
		const { createCrew } = await import('../src/lib/server/crew');
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip, getTrip } = await import('../src/lib/server/trips');

		const driver = await createCrew(tenantId, { type: 'DRIVER', name: 'Michael Mwakalinga', phone: '255700000222' });
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const trip = await createTripFromBooking(tenantId, b.id, {});
		await updateTrip(tenantId, trip.id, { driverCrewId: driver.id });

		const after = await getTrip(tenantId, trip.id);
		expect(after.driverCrewId).toBe(driver.id);
		expect(after.driver).toBe('Michael Mwakalinga');
	}, 90_000);

	it('refuses a guide in the driver slot, and an inactive person anywhere', async () => {
		const { createCrew, updateCrew } = await import('../src/lib/server/crew');
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip } = await import('../src/lib/server/trips');

		const guide = await createCrew(tenantId, { type: 'GUIDE', name: 'Neema K.' });
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const trip = await createTripFromBooking(tenantId, b.id, {});

		await expect(updateTrip(tenantId, trip.id, { driverCrewId: guide.id })).rejects.toThrow(/not registered as a driver/i);

		await updateCrew(tenantId, guide.id, { isActive: false });
		await expect(updateTrip(tenantId, trip.id, { guideCrewId: guide.id })).rejects.toThrow(/no longer active/i);
	}, 90_000);

	it('clears the registry link when a name is typed in instead', async () => {
		// Otherwise the trip would keep claiming a registered driver it does not
		// have — the link would point at somebody the name no longer names.
		const { createCrew } = await import('../src/lib/server/crew');
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip, getTrip } = await import('../src/lib/server/trips');

		const driver = await createCrew(tenantId, { type: 'DRIVER', name: 'Registered Driver' });
		const b = await createBooking(tenantId, {
			customerId,
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
		});
		const trip = await createTripFromBooking(tenantId, b.id, {});
		await updateTrip(tenantId, trip.id, { driverCrewId: driver.id });
		await updateTrip(tenantId, trip.id, { driver: 'A stand-in nobody registered' });

		const after = await getTrip(tenantId, trip.id);
		expect(after.driver).toBe('A stand-in nobody registered');
		expect(after.driverCrewId).toBeNull();
	}, 90_000);

	it('shows a crew member only the trips they are on', async () => {
		// The one row-limited read in the product. Everyone else sees the tenant;
		// a driver sees their own departures and nothing else.
		const { createCrew } = await import('../src/lib/server/crew');
		const { createBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, updateTrip, listTrips, getTrip, tripScope } = await import(
			'../src/lib/server/trips'
		);

		const mine = await createCrew(tenantId, { type: 'DRIVER', name: 'Scoped Driver' });
		const theirs = await createCrew(tenantId, { type: 'DRIVER', name: 'Other Driver' });

		const mk = async () => {
			const b = await createBooking(tenantId, {
				customerId,
				status: 'AWAITING_PAYMENT',
				items: [{ title: 'Day trip', type: 'TOUR', quantity: 1, unitPrice: '100.00' }]
			});
			return createTripFromBooking(tenantId, b.id, {});
		};
		const a = await mk();
		const b = await mk();
		await updateTrip(tenantId, a.id, { driverCrewId: mine.id });
		await updateTrip(tenantId, b.id, { driverCrewId: theirs.id });

		const scope = tripScope({ role: 'CREW', crewId: mine.id });
		const visible = await listTrips(tenantId, { scope });
		expect(visible.items.map((t) => t.id)).toContain(a.id);
		expect(visible.items.map((t) => t.id)).not.toContain(b.id);

		// And the DETAIL route must agree — otherwise the list is honest and a
		// direct id lookup quietly is not.
		await expect(getTrip(tenantId, b.id, scope)).rejects.toThrow(/could not be found/i);
		expect((await getTrip(tenantId, a.id, scope)).id).toBe(a.id);
	}, 120_000);

	it('shows a crew account with no crew record nothing at all', async () => {
		// Fails CLOSED. An unlinked driver seeing everything is the failure mode
		// that matters, and it is the one a null check would produce.
		const { listTrips, tripScope } = await import('../src/lib/server/trips');
		const scope = tripScope({ role: 'CREW', crewId: null });
		const visible = await listTrips(tenantId, { scope });
		expect(visible.items).toHaveLength(0);
	}, 60_000);

	it('gives crew trips but never money or passports', async () => {
		const { permissionsForRole } = await import('../src/lib/server/auth/permissions');
		const crew = permissionsForRole('CREW');
		expect(crew).toEqual(expect.arrayContaining(['trips:read', 'trips:write']));
		for (const forbidden of [
			'bookings:read',
			'payments:read',
			'quotations:read',
			'customers:read',
			'travelers:read_sensitive',
			'conversations:read'
		]) {
			expect(crew).not.toContain(forbidden);
		}
	});

	it('keeps trips invisible across tenants', async () => {
		const other = await provisionTestTenant({ name: 'Other Safari', slug: `test-trips-b-${Date.now()}` });
		const { createTripFromBooking, getTrip, listTrips } = await import('../src/lib/server/trips');
		const mine = await createTripFromBooking(tenantId, bookingId, {});
		await expect(getTrip(other.id, mine.id)).rejects.toThrow(/could not be found/i);
		const theirs = await listTrips(other.id);
		expect(theirs.items).toHaveLength(0);
	}, 120_000);
});
