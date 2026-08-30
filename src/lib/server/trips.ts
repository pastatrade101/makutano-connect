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
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { emit } from './events';
import { AppError } from './errors';
import { getTenantById } from './tenants';
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
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	const existing = await db()
		.select()
		.from(schema.trips)
		.where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.bookingId, bookingId)))
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

export async function getTrip(tenantId: string, id: string): Promise<schema.Trip> {
	const rows = await db()
		.select()
		.from(schema.trips)
		.where(and(eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Trip could not be found.');
	return rows[0];
}

export async function getTripDetail(tenantId: string, id: string) {
	const trip = await getTrip(tenantId, id);
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
		getBookingDetail(tenantId, trip.bookingId)
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

export type ReadinessCheck = {
	key: string;
	label: string;
	done: boolean;
	/** A trip must not depart without this. Drives the "blocked" verdict. */
	critical: boolean;
};

export type Readiness = {
	percent: number;
	checks: ReadinessCheck[];
	missing: ReadinessCheck[];
	/** True when every critical check passes — the trip may be marked READY. */
	canBeReady: boolean;
};

export function readinessFor(
	trip: schema.Trip,
	booking: schema.Booking,
	travelers: Array<{ passportNumber?: string | null }>
): Readiness {
	const paid = Number(booking.amountPaid ?? 0);
	const outstanding = Number(booking.balanceDue ?? 0);
	const expected = trip.adults + trip.children;
	const withPassport = travelers.filter((t) => Boolean(t.passportNumber)).length;

	const checks: ReadinessCheck[] = [
		{
			key: 'booking_confirmed',
			label: 'Booking confirmed',
			done: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status),
			critical: true
		},
		{ key: 'deposit', label: 'Deposit received', done: paid > 0, critical: true },
		{ key: 'dates', label: 'Travel dates set', done: Boolean(trip.startDate), critical: true },
		{ key: 'accommodation', label: 'Accommodation booked', done: Boolean(trip.accommodation), critical: true },
		{ key: 'hotel_confirmed', label: 'Hotel confirmed', done: trip.hotelConfirmed, critical: false },
		{ key: 'vehicle', label: 'Vehicle assigned', done: Boolean(trip.vehicle), critical: true },
		{ key: 'driver', label: 'Driver assigned', done: Boolean(trip.driver), critical: true },
		{ key: 'guide', label: 'Guide assigned', done: Boolean(trip.guide), critical: false },
		{
			key: 'passports',
			label: expected > 0 ? `Passports (${withPassport}/${expected})` : 'Passports',
			done: expected > 0 && withPassport >= expected,
			critical: false
		},
		// Money still owed does not stop a trip departing — plenty of operators run
		// the trip and collect on arrival — so this is visible but not blocking.
		{ key: 'balance', label: 'Balance settled', done: outstanding <= 0, critical: false }
	];

	const done = checks.filter((c) => c.done).length;
	return {
		percent: Math.round((done / checks.length) * 100),
		checks,
		missing: checks.filter((c) => !c.done),
		canBeReady: checks.every((c) => c.done || !c.critical)
	};
}

export async function listTrips(
	tenantId: string,
	filters: {
		status?: schema.Trip['status'][];
		operationsUserId?: string;
		bookingId?: string;
		customerId?: string;
	} = {},
	page: Pagination = { limit: 25, page: 1, order: 'asc' }
) {
	const clauses: SQL[] = [eq(schema.trips.tenantId, tenantId)];
	if (filters.status?.length) clauses.push(inArray(schema.trips.status, filters.status));
	if (filters.operationsUserId) clauses.push(eq(schema.trips.operationsUserId, filters.operationsUserId));
	if (filters.bookingId) clauses.push(eq(schema.trips.bookingId, filters.bookingId));
	if (filters.customerId) clauses.push(eq(schema.trips.customerId, filters.customerId));
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
	reason?: string
): Promise<schema.Trip> {
	const trip = await getTrip(tenantId, id);
	if (trip.status === toStatus) return trip;
	if (!TRANSITIONS[trip.status].includes(toStatus)) {
		throw new AppError('VALIDATION_ERROR', `A trip cannot move from ${trip.status} to ${toStatus}.`);
	}

	// READY is a promise that the trip can leave. Let the readiness model decide
	// that rather than the person clicking, or the number on the screen becomes
	// decoration.
	if (toStatus === 'READY') {
		const { readiness } = await getTripDetail(tenantId, id);
		if (!readiness.canBeReady) {
			const missing = readiness.missing
				.filter((c) => c.critical)
				.map((c) => c.label.toLowerCase())
				.join(', ');
			throw new AppError('CONFLICT', `This trip is not ready yet — still missing: ${missing}.`);
		}
	}

	const now = new Date();
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
		.where(and(eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId)))
		.returning();

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
export type UpdateTripInput = {
	title?: string;
	operationsUserId?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	vehicle?: string | null;
	driver?: string | null;
	guide?: string | null;
	accommodation?: string | null;
	hotelConfirmed?: boolean;
	notes?: string | null;
};

export async function updateTrip(
	tenantId: string,
	id: string,
	input: UpdateTripInput,
	actor: TripActor = {}
): Promise<schema.Trip> {
	const trip = await getTrip(tenantId, id);
	if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
		throw new AppError('CONFLICT', `A ${trip.status.toLowerCase()} trip can no longer be edited.`);
	}

	const patch: Partial<typeof schema.trips.$inferInsert> = { updatedAt: new Date() };
	if (input.title !== undefined) patch.title = input.title;
	if (input.operationsUserId !== undefined) patch.operationsUserId = input.operationsUserId;
	if (input.startDate !== undefined) patch.startDate = toDate(input.startDate);
	if (input.endDate !== undefined) patch.endDate = toDate(input.endDate);
	if (input.vehicle !== undefined) patch.vehicle = input.vehicle;
	if (input.driver !== undefined) patch.driver = input.driver;
	if (input.guide !== undefined) patch.guide = input.guide;
	if (input.accommodation !== undefined) patch.accommodation = input.accommodation;
	if (input.hotelConfirmed !== undefined) patch.hotelConfirmed = input.hotelConfirmed;
	if (input.notes !== undefined) patch.notes = input.notes;

	const [updated] = await db()
		.update(schema.trips)
		.set(patch)
		.where(and(eq(schema.trips.id, id), eq(schema.trips.tenantId, tenantId)))
		.returning();

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

/** Counts for the operations dashboard, in one round trip. */
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
