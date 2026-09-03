// Trips: the operational half of a sale.
//
// A booking is the commercial record — what was sold, what is owed. A trip is the
// operational one — can this depart. They are separate on purpose: the agent who
// closed the sale is rarely the person confirming the hotel, and overloading one
// record with both jobs is what forces operations staff to read money fields to
// find out whether a vehicle is assigned.
//
// A trip is CREATED FROM a booking, copying what operations needs, and then
// diverges. Operations may move a day, swap a hotel or add a transfer without
// touching what the customer was quoted. Nothing here writes to the booking.
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { resolveVehicle } from './vehicles';
import { nextReference } from './db/references';
import { emit } from './events';
import { assertAllowed } from './entitlements';
import { AppError } from './errors';
import { getTenantById } from './tenants';
// createTripFromBooking genuinely needs the booking's ITEMS to copy forward, so
// it keeps the full detail; getTripDetail does not, and uses bookingForTrip.
import { getBookingDetail } from './bookings';
import type { Pagination } from './http';

export type TripActor = { userId?: string | null; apiKeyId?: string | null };

const toDate = (v?: string | null): Date | null => (v ? new Date(v) : null);

/**
 * Hand a confirmed booking over to operations.
 *
 * Idempotent, like acceptQuotation before it: handing the same booking over twice
 * returns the trip that already exists rather than creating a second one. The
 * unique index on booking_id enforces that even under a race, but returning the
 * existing trip means the second caller gets a useful answer instead of an error.
 */
export async function createTripFromBooking(
	tenantId: string,
	bookingId: string,
	input: { operationsUserId?: string | null; title?: string | null; notes?: string | null } = {},
	actor: TripActor = {}
) {
	// Gated like every other creating domain. A trip is the operational half of a
	// booking, so it lives or dies with the bookings feature rather than needing a
	// plan key of its own that no existing plan would carry. assertAllowed also
	// refuses a suspended tenant, which is the part that matters most here.
	await assertAllowed(tenantId, { feature: 'bookings.enabled' });
	await assertAssignable(tenantId, input.operationsUserId);

	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	// Idempotent on LIVE trips only. A cancelled one is history, not the current
	// answer — returning it would tell the caller the sale is already in
	// operations when nobody is preparing anything.
	const existing = await db()
		.select()
		.from(schema.trips)
		.where(
			and(
				eq(schema.trips.tenantId, tenantId),
				eq(schema.trips.bookingId, bookingId),
				inArray(schema.trips.status, ['PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED'])
			)
		)
		.limit(1);
	if (existing[0]) return existing[0];

	const { booking, items, customer } = await getBookingDetail(tenantId, bookingId);

	// Operations cannot prepare a trip for a sale that is not agreed. This is the
	// one commercial rule the trip domain enforces, and it is a guard rail rather
	// than a workflow: everything after this point is operational.
	if (['DRAFT', 'CANCELLED', 'REFUNDED'].includes(booking.status)) {
		throw new AppError('CONFLICT', `A ${booking.status.toLowerCase()} booking cannot be handed over to operations.`);
	}

	const reference = await nextReference(db(), tenantId, 'TR', tenant.bookingReferencePrefix);
	const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim();
	const title = input.title?.trim() || items[0]?.title || (name ? `${name}'s trip` : booking.bookingReference);

	const [trip] = await db()
		.insert(schema.trips)
		.values({
			tenantId,
			tripReference: reference,
			bookingId: booking.id,
			customerId: booking.customerId,
			status: 'PREPARING',
			title,
			operationsUserId: input.operationsUserId ?? null,
			startDate: booking.startDate,
			endDate: booking.endDate,
			adults: booking.adults,
			children: booking.children,
			notes: input.notes ?? null,
			createdByUserId: actor.userId ?? null
		})
		.returning();

	// Copy the sold lines forward as the operational starting point — WITHOUT their
	// prices. The moment operations can change a number the customer was quoted,
	// the booking stops being the truth about what was sold.
	if (items.length) {
		await db()
			.insert(schema.tripItems)
			.values(
				items.map((item, i) => ({
					tenantId,
					tripId: trip.id,
					type: item.type,
					title: item.title,
					description: item.description ?? null,
					dayNumber: dayNumberFor(booking.startDate, item.startDate),
					sortOrder: i,
					startDate: item.startDate,
					endDate: item.endDate,
					confirmed: false
				}))
			);
	}

	await db().insert(schema.tripStatusHistory).values({
		tenantId,
		tripId: trip.id,
		fromStatus: null,
		toStatus: 'PREPARING',
		reason: 'Handed over to operations',
		changedByUserId: actor.userId ?? null,
		changedByApiKeyId: actor.apiKeyId ?? null
	});

	await emit(tenantId, 'trip.created', {
		id: trip.id,
		tripReference: trip.tripReference,
		bookingId: booking.id,
		bookingReference: booking.bookingReference,
		operationsUserId: trip.operationsUserId,
		startDate: trip.startDate?.toISOString() ?? null
	});

	return trip;
}

/** Which day of the trip a dated line falls on. Day 1 is the start date. */
function dayNumberFor(tripStart: Date | null, itemStart: Date | null): number | null {
	if (!tripStart || !itemStart) return null;
	const day = 24 * 60 * 60 * 1000;
	const from = Date.UTC(tripStart.getUTCFullYear(), tripStart.getUTCMonth(), tripStart.getUTCDate());
	const to = Date.UTC(itemStart.getUTCFullYear(), itemStart.getUTCMonth(), itemStart.getUTCDate());
	const n = Math.round((to - from) / day) + 1;
	return n >= 1 ? n : null;
}

/**
 * Just enough of the booking for a trip screen: the record, its travellers and
 * the customer.
 *
 * getBookingDetail fires seven queries — items, travellers, notes, status
 * history, payments, customer — and a trip renders three of them. Four tables
 * were being read and discarded on every trip open, on both platforms.
 */
async function bookingForTrip(tenantId: string, bookingId: string) {
	const [booking] = await db()
		.select()
		.from(schema.bookings)
		.where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, tenantId)))
		.limit(1);
	if (!booking) throw new AppError('NOT_FOUND', 'The booking behind this trip could not be found.');

	const [travelers, customer] = await Promise.all([
		db()
			.select()
			.from(schema.bookingTravelers)
			.where(
				and(eq(schema.bookingTravelers.tenantId, tenantId), eq(schema.bookingTravelers.bookingId, bookingId))
			),
		booking.customerId
			? db().select().from(schema.customers).where(eq(schema.customers.id, booking.customerId)).limit(1)
			: Promise.resolve([])
	]);
	return { booking, travelers, customer: customer[0] ?? null };
}

export async function getTrip(tenantId: string, id: string, scope?: SQL | null): Promise<schema.Trip> {
	// The scope belongs here as well as on the list. Without it a crew member who
	// knows any trip id could open it — the list would be honest and the detail
	// route would quietly not be.
	const clauses: SQL[] = [eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId)];
	if (scope) clauses.push(scope);
	const rows = await db()
		.select()
		.from(schema.trips)
		.where(and(...clauses))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Trip could not be found.');
	return rows[0];
}

export async function getTripDetail(tenantId: string, id: string, scope?: SQL | null) {
	const trip = await getTrip(tenantId, id, scope);
	const [items, history, bookingDetail] = await Promise.all([
		db()
			.select()
			.from(schema.tripItems)
			.where(and(eq(schema.tripItems.tenantId, tenantId), eq(schema.tripItems.tripId, id)))
			.orderBy(asc(schema.tripItems.dayNumber), asc(schema.tripItems.sortOrder)),
		db()
			.select()
			.from(schema.tripStatusHistory)
			.where(and(eq(schema.tripStatusHistory.tenantId, tenantId), eq(schema.tripStatusHistory.tripId, id)))
			.orderBy(desc(schema.tripStatusHistory.createdAt)),
		bookingForTrip(tenantId, trip.bookingId)
	]);

	return {
		trip,
		items,
		history,
		booking: bookingDetail.booking,
		customer: bookingDetail.customer,
		travelers: bookingDetail.travelers ?? [],
		readiness: readinessFor(trip, bookingDetail.booking, bookingDetail.travelers ?? [])
	};
}

// ── readiness ─────────────────────────────────────────────────────────────────
//
// One number and a list of what is missing, computed on the SERVER so the web
// portal and the phone can never disagree about whether a trip can depart.
//
// The checks are deliberately few and all operational. A trip is not "unready"
// because someone has not written notes; it is unready because it cannot leave.
//
// THE CHECKS ARE DECLARED ONCE, HERE. An earlier cut computed the critical count
// a second time in SQL for the mobile work feed, and two copies of a rule are
// two rules: add a check to one and the phone and the portal quietly disagree
// about whether a trip can leave. Everything that needs readiness — the portal,
// the API, the phone — derives it from this list.

/** The minimum a check needs to make its judgement. */
export type ReadinessInput = {
	trip: Pick<
		schema.Trip,
		'adults' | 'children' | 'startDate' | 'accommodation' | 'vehicle' | 'driver' | 'guide' | 'hotelConfirmed'
	>;
	booking: Pick<schema.Booking, 'status' | 'amountPaid' | 'balanceDue'>;
	/** How many travellers have a passport on file. */
	passportsHeld: number;
};

type CheckDef = {
	key: string;
	label: (i: ReadinessInput) => string;
	done: (i: ReadinessInput) => boolean;
	/** A trip must not depart without this. Drives the "blocked" verdict. */
	critical: boolean;
	/** Needs traveller rows, which the cheap critical-only path does not load. */
	needsTravelers?: boolean;
};

const CHECKS: CheckDef[] = [
	{
		key: 'booking_confirmed',
		label: () => 'Booking confirmed',
		done: (i) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(i.booking.status),
		critical: true
	},
	{ key: 'deposit', label: () => 'Deposit received', done: (i) => Number(i.booking.amountPaid ?? 0) > 0, critical: true },
	{ key: 'dates', label: () => 'Travel dates set', done: (i) => Boolean(i.trip.startDate), critical: true },
	{
		key: 'accommodation',
		label: () => 'Accommodation booked',
		done: (i) => Boolean(i.trip.accommodation?.trim()),
		critical: true
	},
	{ key: 'hotel_confirmed', label: () => 'Hotel confirmed', done: (i) => i.trip.hotelConfirmed, critical: false },
	{ key: 'vehicle', label: () => 'Vehicle assigned', done: (i) => Boolean(i.trip.vehicle?.trim()), critical: true },
	{ key: 'driver', label: () => 'Driver assigned', done: (i) => Boolean(i.trip.driver?.trim()), critical: true },
	{ key: 'guide', label: () => 'Guide assigned', done: (i) => Boolean(i.trip.guide?.trim()), critical: false },
	{
		key: 'passports',
		label: (i) => {
			const expected = i.trip.adults + i.trip.children;
			return expected > 0 ? `Passports (${i.passportsHeld}/${expected})` : 'Passports';
		},
		done: (i) => {
			const expected = i.trip.adults + i.trip.children;
			return expected > 0 && i.passportsHeld >= expected;
		},
		critical: false,
		needsTravelers: true
	},
	// Money still owed does not stop a trip departing — plenty of operators run
	// the trip and collect on arrival — so this is visible but not blocking.
	{
		key: 'balance',
		label: () => 'Balance settled',
		done: (i) => Number(i.booking.balanceDue ?? 0) <= 0,
		critical: false
	}
];

// The cheap path below answers "can this leave?" without loading traveller rows,
// which is only sound while no CRITICAL check needs them. Fail loudly at import
// rather than silently under-reporting blockers in production.
const TRAVELER_DEPENDENT_CRITICAL = CHECKS.filter((c) => c.critical && c.needsTravelers);
if (TRAVELER_DEPENDENT_CRITICAL.length) {
	throw new Error(
		`Critical readiness checks cannot depend on traveller rows: ${TRAVELER_DEPENDENT_CRITICAL.map((c) => c.key).join(', ')}. ` +
			'Either make the check non-critical, or change criticalMissing() to load travellers.'
	);
}

export type ReadinessCheck = { key: string; label: string; done: boolean; critical: boolean };

export type Readiness = {
	percent: number;
	checks: ReadinessCheck[];
	missing: ReadinessCheck[];
	/** True when every critical check passes — the trip may be marked READY. */
	canBeReady: boolean;
};

export function readinessFor(
	trip: ReadinessInput['trip'],
	booking: ReadinessInput['booking'],
	travelers: Array<{ passportNumber?: string | null }>
): Readiness {
	const input: ReadinessInput = {
		trip,
		booking,
		passportsHeld: travelers.filter((t) => Boolean(t.passportNumber)).length
	};
	const checks = CHECKS.map((c) => ({
		key: c.key,
		label: c.label(input),
		done: c.done(input),
		critical: c.critical
	}));
	const done = checks.filter((c) => c.done).length;
	return {
		percent: Math.round((done / checks.length) * 100),
		checks,
		missing: checks.filter((c) => !c.done),
		canBeReady: checks.every((c) => c.done || !c.critical)
	};
}

/**
 * How many things still stop this trip leaving — without loading travellers.
 *
 * For list surfaces (the work feed, the trips list) that need the blocker count
 * for many trips at once and must not pay a traveller query per row.
 */
export function criticalMissing(trip: ReadinessInput['trip'], booking: ReadinessInput['booking']): number {
	const input: ReadinessInput = { trip, booking, passportsHeld: 0 };
	return CHECKS.filter((c) => c.critical && !c.done(input)).length;
}

/**
 * Trips with the booking behind them, in ONE query.
 *
 * The list surfaces need a readiness verdict per row, and the naive version —
 * getBookingDetail() per trip — costs six queries a row, so a page of 25 trips
 * was ~150 round trips, most of them fetching payments and notes no list ever
 * renders. This selects only the columns the readiness CHECKS actually read.
 */
async function tripsWithBooking(tenantId: string, where: SQL, page?: { limit: number }) {
	const q = db()
		.select({
			trip: schema.trips,
			booking: {
				id: schema.bookings.id,
				bookingReference: schema.bookings.bookingReference,
				status: schema.bookings.status,
				amountPaid: schema.bookings.amountPaid,
				balanceDue: schema.bookings.balanceDue,
				total: schema.bookings.total,
				currency: schema.bookings.currency
			},
			customerFirstName: schema.customers.firstName,
			customerLastName: schema.customers.lastName
		})
		.from(schema.trips)
		.innerJoin(schema.bookings, eq(schema.bookings.id, schema.trips.bookingId))
		.leftJoin(schema.customers, eq(schema.customers.id, schema.trips.customerId))
		.where(where);
	// Bounded in SQL, not in Node. Live trips accumulate — nothing leaves
	// PREPARING on its own — so fetching them all to return forty would grow
	// without limit against a pool the WhatsApp webhook shares.
	//
	// Ordered by DEPARTURE, not by when the row was last touched. Two reasons and
	// they point the same way: soonest-leaving is the right forty for an
	// operations feed, and it is the only ordering the (tenant, status,
	// start_date) index can serve — sorting by updated_at would filter on the
	// index and then sort every live trip in the tenant to take forty.
	return page ? q.orderBy(asc(schema.trips.startDate)).limit(page.limit) : q;
}

/** Live trips for the mobile work feed, already joined to what readiness needs. */
export async function listTripsForWork(tenantId: string, limit = 40) {
	const rows = await tripsWithBooking(
		tenantId,
		and(
			eq(schema.trips.tenantId, tenantId),
			inArray(schema.trips.status, ['PREPARING', 'READY', 'IN_PROGRESS'])
		)!,
		{ limit }
	);
	const day = 24 * 60 * 60 * 1000;
	const today = new Date();
	const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	return rows.map((r) => ({
			trip: r.trip,
			booking: r.booking,
			customerName: [r.customerFirstName, r.customerLastName].filter(Boolean).join(' ').trim() || null,
			daysToDeparture: r.trip.startDate
				? Math.round(
						(Date.UTC(
							r.trip.startDate.getUTCFullYear(),
							r.trip.startDate.getUTCMonth(),
							r.trip.startDate.getUTCDate()
						) -
							midnight) /
							day
					)
				: null
		}));
}

/**
 * Which trips a viewer may see AT ALL.
 *
 * Everyone else sees their tenant's trips; a CREW member sees the ones they are
 * personally driving or guiding. Enforced as a WHERE clause rather than by
 * hiding rows after the fact, because filtering in the UI is not authorization —
 * and this predicate is applied by every read path, so there is one answer to
 * the question rather than one per screen.
 *
 * Returns null when the viewer is unrestricted.
 */
export function tripScope(viewer: { role?: string | null; crewId?: string | null }): SQL | null {
	if (viewer.role !== 'CREW') return null;
	// A crew account with no crew record is a misconfiguration, and it must fail
	// CLOSED — an unlinked driver sees nothing, never everything.
	if (!viewer.crewId) return sql`false`;
	// All three seats, or a specialist would log in and be told they are on
	// nothing. Each column is indexed (0020) because this OR runs on every list
	// a crew member loads.
	return sql`(${schema.trips.driverCrewId} = ${viewer.crewId}::uuid or ${schema.trips.guideCrewId} = ${viewer.crewId}::uuid or ${schema.trips.specialistCrewId} = ${viewer.crewId}::uuid)`;
}

/**
 * The scope for whoever is making this request. One call, used by every trip
 * read on both platforms — the alternative is each route deciding for itself,
 * and one of them eventually deciding wrong.
 */
export async function scopeFor(
	tenantId: string,
	viewer: { userId?: string | null; role?: string | null }
): Promise<SQL | null> {
	if (viewer.role !== 'CREW') return null;
	const crewId = viewer.userId ? await crewIdForUser(tenantId, viewer.userId) : null;
	return tripScope({ role: 'CREW', crewId });
}

/** The crew record behind a user, if they are one. */
export async function crewIdForUser(tenantId: string, userId: string): Promise<string | null> {
	const [row] = await db()
		.select({ id: schema.crew.id })
		.from(schema.crew)
		.where(and(eq(schema.crew.tenantId, tenantId), eq(schema.crew.userId, userId), eq(schema.crew.isActive, true)))
		.limit(1);
	return row?.id ?? null;
}

export async function listTrips(
	tenantId: string,
	filters: {
		status?: schema.Trip['status'][];
		operationsUserId?: string;
		bookingId?: string;
		customerId?: string;
		/** From tripScope(). Applied to every read so scoping cannot be skipped. */
		scope?: SQL | null;
	} = {},
	page: Pagination = { limit: 25, page: 1, order: 'asc' }
) {
	const clauses: SQL[] = [eq(schema.trips.tenantId, tenantId)];
	if (filters.status?.length) clauses.push(inArray(schema.trips.status, filters.status));
	if (filters.operationsUserId) clauses.push(eq(schema.trips.operationsUserId, filters.operationsUserId));
	if (filters.bookingId) clauses.push(eq(schema.trips.bookingId, filters.bookingId));
	if (filters.customerId) clauses.push(eq(schema.trips.customerId, filters.customerId));
	if (filters.scope) clauses.push(filters.scope);
	const where = and(...clauses);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select()
			.from(schema.trips)
			.where(where)
			// Soonest departure first: an operations screen is a queue by date, not a
			// log by creation time.
			.orderBy(asc(schema.trips.startDate), desc(schema.trips.createdAt))
			.limit(page.limit)
			.offset((page.page - 1) * page.limit),
		db().select({ value: count() }).from(schema.trips).where(where)
	]);
	return { items, total: Number(total) };
}

/**
 * A page of trips, each already scored. Two queries, whatever the page size.
 *
 * Passport counts come from one grouped query rather than a traveller fetch per
 * trip, which is the difference between two round trips and fifty.
 */
export async function listTripsWithReadiness(
	tenantId: string,
	filters: Parameters<typeof listTrips>[1] = {},
	page: Pagination = { limit: 25, page: 1, order: 'asc' }
) {
	// The scope is already applied by listTrips, and the join below is keyed on
	// the ids it returned — so a scoped viewer cannot widen the result by way of
	// the second query.
	const { items, total } = await listTrips(tenantId, filters, page);
	if (!items.length) return { rows: [], total };

	const bookingIds = items.map((t) => t.bookingId);
	const [joined, passportRows] = await Promise.all([
		tripsWithBooking(
			tenantId,
			and(
				eq(schema.trips.tenantId, tenantId),
				inArray(
					schema.trips.id,
					items.map((t) => t.id)
				)
			)!
		),
		db()
			.select({
				bookingId: schema.bookingTravelers.bookingId,
				held: sql<number>`count(*) filter (where ${schema.bookingTravelers.passportNumber} is not null)::int`
			})
			.from(schema.bookingTravelers)
			.where(
				and(
					eq(schema.bookingTravelers.tenantId, tenantId),
					inArray(schema.bookingTravelers.bookingId, bookingIds)
				)
			)
			.groupBy(schema.bookingTravelers.bookingId)
	]);

	const byTrip = new Map(joined.map((j) => [j.trip.id, j]));
	const passports = new Map(passportRows.map((r) => [r.bookingId, Number(r.held)]));

	// listTrips already ordered these; preserve it rather than the join's order.
	const rows = items.map((trip) => {
		const j = byTrip.get(trip.id);
		if (!j) return { trip, readiness: null, bookingReference: null, customerName: null, money: null };
		const held = passports.get(trip.bookingId) ?? 0;
		return {
			trip,
			readiness: readinessFor(trip, j.booking, Array.from({ length: held }, () => ({ passportNumber: 'x' }))),
			bookingReference: j.booking.bookingReference,
			customerName: [j.customerFirstName, j.customerLastName].filter(Boolean).join(' ').trim() || null,
			// ONE rule about money on a trip, applied by every surface: whoever can
			// see trips learns the balance still owed, because an unpaid balance
			// before a departure is operational. Pricing — total, subtotal, discount,
			// tax, what has been paid — stays with the booking. Returning the whole
			// booking row here would ship all of it to the browser, since a load's
			// return value is serialised to the client.
			money: { currency: j.booking.currency, balanceDue: j.booking.balanceDue }
		};
	});
	return { rows, total };
}

/**
 * How many live trips cannot currently leave — across the WHOLE tenant, not the
 * page on screen.
 *
 * The header says "4 cannot leave yet". Counting only the visible rows makes
 * that a lie the moment there is a second page, and it is a lie in the
 * reassuring direction. One aggregate, and it must stay in step with the
 * CRITICAL checks in CHECKS above — the same four columns.
 */
export async function blockedTripCount(
	tenantId: string,
	filters: { status?: schema.Trip['status'][]; operationsUserId?: string } = {}
): Promise<{ blocked: number; leavingSoon: number }> {
	const clauses: SQL[] = [eq(schema.trips.tenantId, tenantId)];
	if (filters.status?.length) clauses.push(inArray(schema.trips.status, filters.status));
	if (filters.operationsUserId) clauses.push(eq(schema.trips.operationsUserId, filters.operationsUserId));

	const [row] = await db()
		.select({
			blocked: sql<number>`count(*) filter (where
				${schema.bookings.status} not in ('CONFIRMED','IN_PROGRESS','COMPLETED')
				or coalesce(${schema.bookings.amountPaid}, 0) <= 0
				or ${schema.trips.startDate} is null
				or nullif(btrim(coalesce(${schema.trips.accommodation}, '')), '') is null
				or nullif(btrim(coalesce(${schema.trips.vehicle}, '')), '') is null
				or nullif(btrim(coalesce(${schema.trips.driver}, '')), '') is null
			)::int`,
			leavingSoon: sql<number>`count(*) filter (
				where ${schema.trips.startDate} between current_date and current_date + 7
			)::int`
		})
		.from(schema.trips)
		.innerJoin(schema.bookings, eq(schema.bookings.id, schema.trips.bookingId))
		.where(and(...clauses));

	return { blocked: Number(row?.blocked ?? 0), leavingSoon: Number(row?.leavingSoon ?? 0) };
}

/** Legal transitions, enforced server-side rather than by hiding buttons. */
const TRANSITIONS: Record<schema.Trip['status'], schema.Trip['status'][]> = {
	PREPARING: ['READY', 'CANCELLED'],
	// Back to PREPARING on purpose: a hotel falls through the day before departure
	// more often than anyone would like, and the alternative is staff cancelling a
	// real trip to correct its state.
	READY: ['PREPARING', 'IN_PROGRESS', 'CANCELLED'],
	IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
	COMPLETED: [],
	CANCELLED: []
};

export async function changeTripStatus(
	tenantId: string,
	id: string,
	toStatus: schema.Trip['status'],
	actor: TripActor = {},
	reason?: string,
	scope?: SQL | null
): Promise<schema.Trip> {
	await assertAllowed(tenantId);
	const trip = await getTrip(tenantId, id, scope);
	if (trip.status === toStatus) return trip;
	if (!TRANSITIONS[trip.status].includes(toStatus)) {
		throw new AppError('VALIDATION_ERROR', `A trip cannot move from ${trip.status} to ${toStatus}.`);
	}

	// READY is a promise that the trip can leave. Let the readiness model decide
	// that rather than the person clicking, or the number on the screen becomes
	// decoration.
	// Departure is a stronger claim than readiness, not a weaker one — a trip that
	// could not be marked ready must not be able to leave by skipping past it.
	if (toStatus === 'READY' || toStatus === 'IN_PROGRESS') {
		const { readiness } = await getTripDetail(tenantId, id);
		if (!readiness.canBeReady) {
			const missing = readiness.missing
				.filter((c) => c.critical)
				.map((c) => c.label.toLowerCase())
				.join(', ');
			const verb = toStatus === 'READY' ? 'is not ready yet' : 'cannot depart yet';
			throw new AppError('CONFLICT', `This trip ${verb} — still missing: ${missing}.`);
		}
	}

	const now = new Date();
	// Compare-and-set on the status we validated against. Two people clicking
	// "Mark ready" at once would otherwise both pass the gate and both write, and
	// the second would overwrite a transition it never actually checked.
	const [updated] = await db()
		.update(schema.trips)
		.set({
			status: toStatus,
			...(toStatus === 'READY' ? { readyAt: now } : {}),
			...(toStatus === 'IN_PROGRESS' ? { startedAt: now } : {}),
			...(toStatus === 'COMPLETED' ? { completedAt: now } : {}),
			...(toStatus === 'CANCELLED' ? { cancelledAt: now } : {}),
			updatedAt: now
		})
		.where(
			and(eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId), eq(schema.trips.status, trip.status))
		)
		.returning();
	if (!updated) {
		throw new AppError('CONFLICT', 'Somebody else moved this trip while you were working on it. Reload and try again.');
	}

	await db().insert(schema.tripStatusHistory).values({
		tenantId,
		tripId: id,
		fromStatus: trip.status,
		toStatus,
		reason: reason ?? null,
		changedByUserId: actor.userId ?? null,
		changedByApiKeyId: actor.apiKeyId ?? null
	});

	const event = {
		PREPARING: 'trip.preparing',
		READY: 'trip.ready',
		IN_PROGRESS: 'trip.in_progress',
		COMPLETED: 'trip.completed',
		CANCELLED: 'trip.cancelled'
	} as const;
	await emit(tenantId, event[toStatus], {
		id,
		tripReference: updated.tripReference,
		bookingId: updated.bookingId
	});

	return updated;
}

/** Set-up fields operations owns. Money and customer identity are not among them. */
/**
 * A trip can only be handed to somebody who actually works here.
 *
 * Without this an operationsUserId from another tenant — or a deactivated
 * account — can be written straight in, which is both a quiet cross-tenant
 * reference and a good way to lose a trip to a mailbox nobody reads.
 */
async function assertAssignable(tenantId: string, userId: string | null | undefined): Promise<void> {
	if (!userId) return;
	const [member] = await db()
		.select({ id: schema.tenantMemberships.id })
		.from(schema.tenantMemberships)
		.where(
			and(
				eq(schema.tenantMemberships.tenantId, tenantId),
				eq(schema.tenantMemberships.userId, userId),
				isNull(schema.tenantMemberships.disabledAt)
			)
		)
		.limit(1);
	if (!member) throw new AppError('VALIDATION_ERROR', 'That person is not an active member of this business.');
}

export type UpdateTripInput = {
	title?: string;
	operationsUserId?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	vehicle?: string | null;
	/** Free text, still accepted — not every driver is in the registry yet. */
	driver?: string | null;
	guide?: string | null;
	specialist?: string | null;
	accommodation?: string | null;
	hotelConfirmed?: boolean;
	notes?: string | null;
	/** Assign from the registry. Sets the link AND the name in one go. */
	driverCrewId?: string | null;
	vehicleId?: string | null;
	guideCrewId?: string | null;
	specialistCrewId?: string | null;
	accommodationItemId?: string | null;
};

/**
 * Resolve a registry pick into the link and the name it should snapshot.
 *
 * The name is copied onto the trip deliberately. A trip that ran last year must
 * still say who drove it after that person leaves the company, and every
 * readiness check reads the text column — so the registry is adopted without
 * changing what "ready" means.
 */
async function resolveCrew(
	tenantId: string,
	id: string | null | undefined,
	expect: schema.Crew['type'][]
): Promise<{ id: string | null; name: string | null }> {
	if (!id) return { id: null, name: null };
	const [row] = await db()
		.select({ id: schema.crew.id, name: schema.crew.name, type: schema.crew.type, isActive: schema.crew.isActive })
		.from(schema.crew)
		.where(and(eq(schema.crew.id, id), eq(schema.crew.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('VALIDATION_ERROR', 'That person is not on your crew list.');
	if (!row.isActive) throw new AppError('VALIDATION_ERROR', `${row.name} is no longer active.`);
	if (!expect.includes(row.type)) {
		throw new AppError('VALIDATION_ERROR', `${row.name} is not registered as a ${expect[0].toLowerCase()}.`);
	}
	return { id: row.id, name: row.name };
}

export async function updateTrip(
	tenantId: string,
	id: string,
	input: UpdateTripInput,
	actor: TripActor = {},
	scope?: SQL | null
): Promise<schema.Trip> {
	await assertAllowed(tenantId);
	if (input.operationsUserId !== undefined) await assertAssignable(tenantId, input.operationsUserId);
	// Scoped read first: a crew member must not be able to edit a trip they
	// cannot see, and the guard belongs on the write, not only on the list.
	const trip = await getTrip(tenantId, id, scope);
	if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
		throw new AppError('CONFLICT', `A ${trip.status.toLowerCase()} trip can no longer be edited.`);
	}

	const patch: Partial<typeof schema.trips.$inferInsert> = { updatedAt: new Date() };
	if (input.title !== undefined) patch.title = input.title;
	if (input.operationsUserId !== undefined) patch.operationsUserId = input.operationsUserId;
	if (input.startDate !== undefined) patch.startDate = toDate(input.startDate);
	if (input.endDate !== undefined) patch.endDate = toDate(input.endDate);
	/*
	 * Picking from the fleet registry writes BOTH columns; typing a name clears
	 * the link. Exactly the driver/driverCrewId rule below, and for a sharper
	 * reason: trips.vehicle is what the readiness check and the blocked-trip SQL
	 * aggregate both read, and what a shipped Flutter client renders as a plain
	 * String. Writing only vehicleId would mark every trip in the tenant as
	 * unable to depart while looking, in the database, like an assignment.
	 */
	if (input.vehicleId !== undefined) {
		const resolved = await resolveVehicle(tenantId, input.vehicleId);
		patch.vehicleId = resolved.id;
		// Clearing the registry link deliberately clears the snapshot with it: a
		// name left behind would claim a vehicle the trip no longer has. A caller
		// that wants to keep the text sends `vehicle` in the same update.
		patch.vehicle = resolved.snapshot;
	}
	if (input.vehicle !== undefined) {
		patch.vehicle = input.vehicle;
		// A typed-in vehicle is explicitly NOT the registered one, so the link goes.
		// Unless the same update also picked from the registry, in which case that
		// choice above is the one that stands.
		if (input.vehicleId === undefined) patch.vehicleId = null;
	}

	// A registry pick wins over free text and sets both columns; free text alone
	// clears the link, because a typed-in name is explicitly NOT the registered
	// person and leaving a stale id would make the trip claim otherwise.
	if (input.driverCrewId !== undefined) {
		const resolved = await resolveCrew(tenantId, input.driverCrewId, ['DRIVER']);
		patch.driverCrewId = resolved.id;
		patch.driver = resolved.name;
	} else if (input.driver !== undefined) {
		patch.driver = input.driver;
		patch.driverCrewId = null;
	}

	// Strictly a GUIDE now that specialists have a seat of their own. Before
	// 0020 this also accepted a SPECIALIST, because there was nowhere else to
	// put one; accepting it still would mean the same person could occupy both
	// seats and the trip would claim two people it has one of.
	if (input.guideCrewId !== undefined) {
		const resolved = await resolveCrew(tenantId, input.guideCrewId, ['GUIDE']);
		patch.guideCrewId = resolved.id;
		patch.guide = resolved.name;
	} else if (input.guide !== undefined) {
		patch.guide = input.guide;
		patch.guideCrewId = null;
	}

	if (input.specialistCrewId !== undefined) {
		const resolved = await resolveCrew(tenantId, input.specialistCrewId, ['SPECIALIST']);
		patch.specialistCrewId = resolved.id;
		patch.specialist = resolved.name;
	} else if (input.specialist !== undefined) {
		patch.specialist = input.specialist;
		patch.specialistCrewId = null;
	}

	if (input.accommodationItemId !== undefined) {
		if (input.accommodationItemId) {
			// The platform directory, not a per-tenant list: the same lodge is the
			// same lodge whoever is sending guests to it.
			const [item] = await db()
				.select({ id: schema.accommodations.id, name: schema.accommodations.name })
				.from(schema.accommodations)
				.where(
					and(
						eq(schema.accommodations.id, input.accommodationItemId),
						eq(schema.accommodations.isActive, true),
						isNull(schema.accommodations.deletedAt)
					)
				)
				.limit(1);
			if (!item) throw new AppError('VALIDATION_ERROR', 'That place is no longer listed.');
			patch.accommodationItemId = item.id;
			patch.accommodation = item.name;
		} else {
			patch.accommodationItemId = null;
			patch.accommodation = null;
		}
	} else if (input.accommodation !== undefined) {
		patch.accommodation = input.accommodation;
		patch.accommodationItemId = null;
	}
	if (input.hotelConfirmed !== undefined) patch.hotelConfirmed = input.hotelConfirmed;
	if (input.notes !== undefined) patch.notes = input.notes;

	const [updated] = await db()
		.update(schema.trips)
		.set(patch)
		.where(and(eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId)))
		.returning();

	// Editing a READY trip can take away the very thing that made it ready.
	// System re-check: unscoped on purpose, it acts on behalf of nobody.
	if (trip.status === 'READY') await revalidateTrip(tenantId, id);

	// A handover is worth telling someone about; changing a vehicle is not.
	if (input.operationsUserId !== undefined && input.operationsUserId !== trip.operationsUserId) {
		await emit(tenantId, 'trip.assigned', {
			id,
			tripReference: updated.tripReference,
			operationsUserId: updated.operationsUserId,
			assignedByUserId: actor.userId ?? null
		});
	}

	return updated;
}

/**
 * A booking has been cancelled or refunded — take its trip off the road.
 *
 * Without this, cancelling a sale leaves a trip sitting in Upcoming, still
 * telling an operations person to book a hotel for travellers who are not
 * coming. The booking is the commercial truth; when it dies the departure dies
 * with it. A trip already IN_PROGRESS is left alone: people are on the ground,
 * and that is a conversation, not a status flip.
 */
export async function cancelTripForBooking(
	tenantId: string,
	bookingId: string,
	reason: string,
	actor: TripActor = {}
): Promise<void> {
	const [trip] = await db()
		.select()
		.from(schema.trips)
		.where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.bookingId, bookingId)))
		.limit(1);
	if (!trip) return;
	if (!['PREPARING', 'READY'].includes(trip.status)) return;
	await changeTripStatus(tenantId, trip.id, 'CANCELLED', actor, reason);
}

/**
 * Something changed on the booking that a READY trip was relying on.
 *
 * Readiness is evaluated at the moment READY is claimed, so a refund that takes
 * amountPaid back to zero, or dates being cleared, would otherwise leave a trip
 * asserting it can depart when it no longer can. Re-check and quietly drop it
 * back to PREPARING, which is recoverable, rather than letting it lie.
 */
export async function revalidateTripForBooking(tenantId: string, bookingId: string): Promise<void> {
	const [trip] = await db()
		.select({ id: schema.trips.id, status: schema.trips.status })
		.from(schema.trips)
		.where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.bookingId, bookingId)))
		.limit(1);
	if (!trip) return;
	await revalidateTrip(tenantId, trip.id);
}

/**
 * READY is a claim about the world, and the world moves.
 *
 * The gate runs when READY is asserted, so anything that removes a critical fact
 * afterwards — a driver quitting, a refund clearing the deposit, dates cleared —
 * would otherwise leave the trip still saying it can depart. Demote it, with the
 * reason written to history so the change is legible rather than mysterious.
 */
export async function revalidateTrip(tenantId: string, tripId: string): Promise<void> {
	const trip = await getTrip(tenantId, tripId);
	if (trip.status !== 'READY') return;
	const { readiness } = await getTripDetail(tenantId, tripId);
	if (readiness.canBeReady) return;
	await changeTripStatus(
		tenantId,
		tripId,
		'PREPARING',
		{},
		`No longer ready: ${readiness.missing
			.filter((c) => c.critical)
			.map((c) => c.label.toLowerCase())
			.join(', ')}`
	);
}

/**
 * Counts by status. NOT called by the trips list — that page renders "N cannot
 * leave yet", not a row of totals — and deliberately kept for a dashboard that
 * may want it. It is the one trips query whose cost grows with history, so it
 * should stay off the hot path.
 */
export async function tripStats(tenantId: string) {
	const rows = await db()
		.select({ status: schema.trips.status, value: count() })
		.from(schema.trips)
		.where(eq(schema.trips.tenantId, tenantId))
		.groupBy(schema.trips.status);
	const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.value)]));
	return {
		preparing: by.PREPARING ?? 0,
		ready: by.READY ?? 0,
		inProgress: by.IN_PROGRESS ?? 0,
		completed: by.COMPLETED ?? 0,
		cancelled: by.CANCELLED ?? 0
	};
}
