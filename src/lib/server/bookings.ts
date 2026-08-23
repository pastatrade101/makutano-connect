// Bookings (§14). A booking is the confirmed commercial record; its money fields are
// derived from its items, never trusted from the caller, and every status change is
// written to booking_status_history so the lifecycle is auditable.
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { recordUsage } from './billing';
import { emit } from './events';
import { AppError } from './errors';
import { getTenantById } from './tenants';
import { sendEventTemplate } from './whatsapp/template-engine';
import type { Pagination } from './http';
import type { BookingRequestItemInput, TravelerInput } from './booking-requests';

const toDate = (v?: string | null): Date | null => (v ? new Date(v) : null);
const dec = (v: string | number | null | undefined): number => Number(v ?? 0);
const fixed = (n: number): string => n.toFixed(2);

export type BookingActor = { userId?: string | null; apiKeyId?: string | null };

export type CreateBookingInput = {
	customerId: string;
	bookingRequestId?: string | null;
	quotationId?: string | null;
	currency?: string;
	discount?: string;
	tax?: string;
	startDate?: string | null;
	endDate?: string | null;
	adults?: number;
	children?: number;
	source?: schema.Booking['source'];
	status?: schema.Booking['status'];
	externalReference?: string | null;
	externalSource?: string | null;
	metadata?: Record<string, unknown>;
	items: BookingRequestItemInput[];
	travelers?: TravelerInput[];
};

/** Totals are computed here, so a client cannot post a $0 total for a $5,000 trip. */
export function computeTotals(
	items: Array<{ quantity?: number; unitPrice?: string | null; total?: string | null }>,
	discount = '0',
	tax = '0'
) {
	const subtotal = items.reduce((sum, item) => {
		const explicit = item.total != null ? dec(item.total) : null;
		return sum + (explicit ?? dec(item.unitPrice) * (item.quantity ?? 1));
	}, 0);
	const total = Math.max(0, subtotal - dec(discount) + dec(tax));
	return { subtotal: fixed(subtotal), total: fixed(total) };
}

export async function createBooking(tenantId: string, input: CreateBookingInput, actor: BookingActor = {}) {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');
	if (!input.items?.length) throw new AppError('VALIDATION_ERROR', 'A booking needs at least one item.');

	const { subtotal, total } = computeTotals(input.items, input.discount, input.tax);
	const reference = await nextReference(db(), tenantId, 'BK', tenant.bookingReferencePrefix);
	const status = input.status ?? 'PENDING';

	const [booking] = await db()
		.insert(schema.bookings)
		.values({
			tenantId,
			bookingReference: reference,
			customerId: input.customerId,
			bookingRequestId: input.bookingRequestId ?? null,
			quotationId: input.quotationId ?? null,
			status,
			currency: input.currency ?? tenant.currency,
			subtotal,
			discount: input.discount ?? '0',
			tax: input.tax ?? '0',
			total,
			amountPaid: '0',
			balanceDue: total,
			startDate: toDate(input.startDate),
			endDate: toDate(input.endDate),
			adults: input.adults ?? 1,
			children: input.children ?? 0,
			source: input.source ?? 'ADMIN',
			createdByUserId: actor.userId ?? null,
			externalReference: input.externalReference ?? null,
			externalSource: input.externalSource ?? null,
			metadata: input.metadata ?? {}
		})
		.returning();

	await db()
		.insert(schema.bookingItems)
		.values(
			input.items.map((item) => ({
				tenantId,
				bookingId: booking.id,
				type: item.type ?? 'TOUR',
				title: item.title,
				description: item.description ?? null,
				quantity: item.quantity ?? 1,
				unitPrice: item.unitPrice ?? '0',
				total: item.total ?? fixed(dec(item.unitPrice) * (item.quantity ?? 1)),
				startDate: toDate(item.startDate),
				endDate: toDate(item.endDate),
				externalReference: item.externalReference ?? null,
				externalSource: item.externalSource ?? null,
				metadata: item.metadata ?? {}
			}))
		);

	if (input.travelers?.length) {
		await db()
			.insert(schema.bookingTravelers)
			.values(
				input.travelers.map((t) => ({
					tenantId,
					bookingId: booking.id,
					firstName: t.firstName ?? '',
					lastName: t.lastName ?? '',
					nationality: t.nationality ?? null,
					dateOfBirth: toDate(t.dateOfBirth),
					passportNumber: t.passportNumber ?? null,
					passportExpiry: toDate(t.passportExpiry),
					dietaryRequirements: t.dietaryRequirements ?? null,
					specialRequests: t.specialRequests ?? null,
					isLead: t.isLead ?? false
				}))
			);
	}

	await db()
		.insert(schema.bookingStatusHistory)
		.values({
			tenantId,
			bookingId: booking.id,
			fromStatus: null,
			toStatus: status,
			reason: 'Booking created',
			changedByUserId: actor.userId ?? null,
			changedByApiKeyId: actor.apiKeyId ?? null
		});

	// Close the loop on the originating request (§11).
	if (input.bookingRequestId) {
		await db()
			.update(schema.bookingRequests)
			.set({ status: 'CONVERTED', convertedBookingId: booking.id, updatedAt: new Date() })
			.where(and(eq(schema.bookingRequests.id, input.bookingRequestId), eq(schema.bookingRequests.tenantId, tenantId)));
	}

	void recordUsage(tenantId, 'bookings');
	await emit(tenantId, 'booking.created', {
		id: booking.id,
		bookingReference: booking.bookingReference,
		status: booking.status,
		total: booking.total,
		currency: booking.currency,
		customerId: booking.customerId
	});
	return booking;
}

export async function getBooking(tenantId: string, id: string): Promise<schema.Booking> {
	const rows = await db()
		.select()
		.from(schema.bookings)
		.where(and(eq(schema.bookings.id, id), eq(schema.bookings.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('BOOKING_NOT_FOUND', 'Booking could not be found.');
	return rows[0];
}

export async function getBookingDetail(tenantId: string, id: string) {
	const booking = await getBooking(tenantId, id);
	const [items, travelers, notes, history, paymentRows, customer] = await Promise.all([
		db().select().from(schema.bookingItems).where(eq(schema.bookingItems.bookingId, id)),
		db().select().from(schema.bookingTravelers).where(eq(schema.bookingTravelers.bookingId, id)),
		db()
			.select()
			.from(schema.bookingNotes)
			.where(eq(schema.bookingNotes.bookingId, id))
			.orderBy(desc(schema.bookingNotes.createdAt)),
		db()
			.select()
			.from(schema.bookingStatusHistory)
			.where(eq(schema.bookingStatusHistory.bookingId, id))
			.orderBy(desc(schema.bookingStatusHistory.createdAt)),
		db()
			.select()
			.from(schema.payments)
			.where(eq(schema.payments.bookingId, id))
			.orderBy(desc(schema.payments.createdAt)),
		booking.customerId
			? db().select().from(schema.customers).where(eq(schema.customers.id, booking.customerId)).limit(1)
			: Promise.resolve([])
	]);
	return { booking, items, travelers, notes, history, payments: paymentRows, customer: customer[0] ?? null };
}

export async function listBookings(
	tenantId: string,
	p: Pagination,
	filters: {
		status?: schema.Booking['status'] | schema.Booking['status'][];
		customerId?: string;
		unpaid?: boolean;
	} = {}
) {
	const conditions: SQL[] = [eq(schema.bookings.tenantId, tenantId)];
	if (filters.status) {
		conditions.push(
			Array.isArray(filters.status)
				? inArray(schema.bookings.status, filters.status)
				: eq(schema.bookings.status, filters.status)
		);
	}
	if (filters.customerId) conditions.push(eq(schema.bookings.customerId, filters.customerId));
	if (filters.unpaid) conditions.push(sql`${schema.bookings.balanceDue} > 0`);
	if (p.q) {
		const term = `%${p.q}%`;
		conditions.push(sql`${schema.bookings.bookingReference} ilike ${term}`);
	}
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({ booking: schema.bookings, customer: schema.customers })
			.from(schema.bookings)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
			.where(where)
			.orderBy(desc(schema.bookings.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.bookings).where(where)
	]);
	return { items, total: Number(total) };
}

/** Legal transitions (§14). Enforced server-side, not by hiding buttons. */
const TRANSITIONS: Record<schema.Booking['status'], schema.Booking['status'][]> = {
	DRAFT: ['PENDING', 'AWAITING_PAYMENT', 'CANCELLED'],
	PENDING: ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'CONFIRMED', 'CANCELLED'],
	AWAITING_PAYMENT: ['PARTIALLY_PAID', 'CONFIRMED', 'CANCELLED'],
	PARTIALLY_PAID: ['CONFIRMED', 'CANCELLED', 'REFUNDED'],
	CONFIRMED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'],
	IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
	COMPLETED: ['REFUNDED'],
	CANCELLED: ['REFUNDED'],
	REFUNDED: []
};

export async function changeBookingStatus(
	tenantId: string,
	id: string,
	toStatus: schema.Booking['status'],
	actor: BookingActor = {},
	reason?: string
): Promise<schema.Booking> {
	const booking = await getBooking(tenantId, id);
	if (booking.status === toStatus) return booking;
	if (!TRANSITIONS[booking.status].includes(toStatus)) {
		throw new AppError('VALIDATION_ERROR', `A booking cannot move from ${booking.status} to ${toStatus}.`);
	}

	const [updated] = await db()
		.update(schema.bookings)
		.set({
			status: toStatus,
			...(toStatus === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
			...(toStatus === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.bookings.id, id), eq(schema.bookings.tenantId, tenantId)))
		.returning();

	await db()
		.insert(schema.bookingStatusHistory)
		.values({
			tenantId,
			bookingId: id,
			fromStatus: booking.status,
			toStatus,
			reason: reason ?? null,
			changedByUserId: actor.userId ?? null,
			changedByApiKeyId: actor.apiKeyId ?? null
		});

	if (toStatus === 'CONFIRMED') {
		await emit(tenantId, 'booking.confirmed', { id, bookingReference: updated.bookingReference, total: updated.total });
	}
	if (toStatus === 'CANCELLED') {
		await emit(tenantId, 'booking.cancelled', {
			id,
			bookingReference: updated.bookingReference,
			reason: reason ?? null
		});
	}
	
	// "Request payment" means REQUEST it: moving to AWAITING_PAYMENT sends the mapped
	// payment reminder with the outstanding amount. Fire-and-forget, compliance-gated.
	if (toStatus === 'AWAITING_PAYMENT') {
		void (async () => {
			const [customer] = updated.customerId
				? await db().select().from(schema.customers).where(eq(schema.customers.id, updated.customerId)).limit(1)
				: [];
			const tenant = await getTenantById(tenantId);
			await sendEventTemplate(
				tenantId,
				'PAYMENT_REMINDER',
				customer?.whatsappPhone,
				{
					customer: { firstName: customer?.firstName, lastName: customer?.lastName },
					business: { name: tenant?.name ?? '' },
					booking: { reference: updated.bookingReference, total: updated.total },
					payment: { amountDue: `${updated.currency} ${updated.balanceDue ?? updated.total}` }
				},
				`booking-PAYMENT_REMINDER:${updated.id}`
			);
		})().catch(() => undefined);
	}

	// Customer notification through the Template Center — only when the tenant mapped
	// an approved template to BOOKING_CONFIRMED. Fire-and-forget: fulfilment never blocks.
	if (toStatus === 'CONFIRMED') {
		void (async () => {
			const [customer] = updated.customerId
				? await db().select().from(schema.customers).where(eq(schema.customers.id, updated.customerId)).limit(1)
				: [];
			const tenant = await getTenantById(tenantId);
			await sendEventTemplate(
				tenantId,
				'BOOKING_CONFIRMED',
				customer?.whatsappPhone,
				{
					customer: { firstName: customer?.firstName, lastName: customer?.lastName },
					business: { name: tenant?.name ?? '' },
					booking: { reference: updated.bookingReference, startDate: updated.startDate ? String(updated.startDate).slice(0, 10) : null, total: updated.total }
				},
				`booking-BOOKING_CONFIRMED:${updated.id}`
			);
		})().catch(() => undefined);
	}
	return updated;
}

/**
 * Recompute amount_paid / balance_due from SUCCEEDED payments and move the booking to
 * the status those numbers imply (§19). Payment rows are the source of truth.
 */
export async function applyPaymentTotals(
	tenantId: string,
	bookingId: string,
	actor: BookingActor = {}
): Promise<schema.Booking> {
	const booking = await getBooking(tenantId, bookingId);
	const rows = (await db().execute<{ paid: string }>(sql`
		select coalesce(sum(amount - amount_refunded), 0)::numeric(14,2) as paid
		from payments
		where tenant_id = ${tenantId}::uuid and booking_id = ${bookingId}::uuid
		  and status in ('SUCCEEDED','PARTIALLY_REFUNDED')
	`)) as unknown as Array<{ paid: string }>;

	const paid = dec(rows[0]?.paid);
	const total = dec(booking.total);
	const balance = Math.max(0, total - paid);

	const [updated] = await db()
		.update(schema.bookings)
		.set({ amountPaid: fixed(paid), balanceDue: fixed(balance), updatedAt: new Date() })
		.where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, tenantId)))
		.returning();

	// Only advance from states where payment is what is being waited on; never override
	// a manual CANCELLED/COMPLETED.
	const advanceable: schema.Booking['status'][] = ['PENDING', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'];
	if (advanceable.includes(updated.status) && paid > 0) {
		const target: schema.Booking['status'] = balance <= 0 ? 'CONFIRMED' : 'PARTIALLY_PAID';
		if (target !== updated.status) {
			return changeBookingStatus(tenantId, bookingId, target, actor, 'Updated automatically from payment');
		}
	}
	return updated;
}

export async function bookingStats(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			count(*)::int as total,
			count(*) filter (where status in ('PENDING','AWAITING_PAYMENT','PARTIALLY_PAID'))::int as pending,
			count(*) filter (where status = 'CONFIRMED')::int as confirmed,
			count(*) filter (where status = 'COMPLETED')::int as completed,
			count(*) filter (where status = 'CANCELLED')::int as cancelled,
			count(*) filter (where balance_due > 0 and status not in ('CANCELLED','REFUNDED'))::int as unpaid,
			coalesce(sum(total) filter (where status in ('CONFIRMED','IN_PROGRESS','COMPLETED')), 0)::float as confirmed_value
		from bookings where tenant_id = ${tenantId}::uuid
	`)) as unknown as Array<Record<string, number>>;
	const r = rows[0] ?? {};
	return {
		total: Number(r.total ?? 0),
		pending: Number(r.pending ?? 0),
		confirmed: Number(r.confirmed ?? 0),
		completed: Number(r.completed ?? 0),
		cancelled: Number(r.cancelled ?? 0),
		unpaid: Number(r.unpaid ?? 0),
		confirmedValue: Number(r.confirmed_value ?? 0)
	};
}
