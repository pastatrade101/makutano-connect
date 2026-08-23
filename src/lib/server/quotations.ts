// Quotations (§16). A quotation may originate from a booking request, a lead, a
// WhatsApp conversation, a customer or nothing at all — so every origin is an optional
// link rather than a required parent.
//
// acceptQuotation() is the piece that matters commercially: accepting converts to a
// booking carrying the customer, trip dates and line items across, so nothing is
// retyped and the numbers cannot drift between the quote and the booking.
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { recordUsage } from './billing';
import { assertAllowed } from './entitlements';
import { createBooking } from './bookings';
import { findOrCreateCustomer } from './customers';
import { emit } from './events';
import { sendEventTemplate } from './whatsapp/template-engine';
import { AppError } from './errors';
import { getTenantById } from './tenants';
import type { Pagination } from './http';
import type { BookingRequestItemInput } from './booking-requests';
import { computeTotals } from './bookings';

const toDate = (v?: string | null): Date | null => (v ? new Date(v) : null);

export type CreateQuotationInput = {
	customerId?: string | null;
	/** Legacy/API callers pass raw customer details; matched or created like §10. */
	customer?: {
		firstName?: string;
		lastName?: string;
		email?: string | null;
		phone?: string | null;
		whatsappPhone?: string | null;
		country?: string | null;
	} | null;
	externalReference?: string | null;
	externalSource?: string | null;
	leadId?: string | null;
	bookingRequestId?: string | null;
	conversationId?: string | null;
	currency?: string;
	discount?: string;
	tax?: string;
	validUntil?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	adults?: number;
	children?: number;
	notes?: string | null;
	terms?: string | null;
	items: BookingRequestItemInput[];
	metadata?: Record<string, unknown>;
};

export async function createQuotation(
	tenantId: string,
	input: CreateQuotationInput,
	createdByUserId: string | null = null
) {
	await assertAllowed(tenantId, { feature: 'quotations.enabled', limit: 'quotations.maxPerMonth' });
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');
	if (!input.items?.length) throw new AppError('VALIDATION_ERROR', 'A quotation needs at least one item.');

	// A quotation with no customer cannot become a booking later; derive one from the
	// inline customer details or the originating request when no id was supplied.
	let customerId = input.customerId ?? null;
	if (!customerId && input.customer) {
		const matched = await findOrCreateCustomer(tenantId, { ...input.customer, source: 'API' }, tenant.country);
		customerId = matched.id;
	}
	if (!customerId && input.bookingRequestId) {
		const rows = await db()
			.select({ customerId: schema.bookingRequests.customerId })
			.from(schema.bookingRequests)
			.where(and(eq(schema.bookingRequests.id, input.bookingRequestId), eq(schema.bookingRequests.tenantId, tenantId)))
			.limit(1);
		customerId = rows[0]?.customerId ?? null;
	}

	const { subtotal, total } = computeTotals(input.items, input.discount, input.tax);
	const reference = await nextReference(db(), tenantId, 'QT', tenant.quotationPrefix || tenant.bookingReferencePrefix);

	const [quotation] = await db()
		.insert(schema.quotations)
		.values({
			tenantId,
			reference,
			customerId,
			leadId: input.leadId ?? null,
			bookingRequestId: input.bookingRequestId ?? null,
			conversationId: input.conversationId ?? null,
			status: 'DRAFT',
			currency: input.currency ?? tenant.currency,
			subtotal,
			discount: input.discount ?? '0',
			tax: input.tax ?? '0',
			total,
			validUntil: toDate(input.validUntil),
			startDate: toDate(input.startDate),
			endDate: toDate(input.endDate),
			adults: input.adults ?? 1,
			children: input.children ?? 0,
			notes: input.notes ?? null,
			terms: input.terms ?? null,
			createdByUserId,
			metadata: {
				...(input.metadata ?? {}),
				...(input.externalReference ? { external_reference: input.externalReference } : {}),
				...(input.externalSource ? { external_source: input.externalSource } : {})
			}
		})
		.returning();

	await db()
		.insert(schema.quotationItems)
		.values(
			input.items.map((item, index) => ({
				tenantId,
				quotationId: quotation.id,
				type: item.type ?? 'TOUR',
				title: item.title,
				description: item.description ?? null,
				quantity: item.quantity ?? 1,
				unitPrice: item.unitPrice ?? '0',
				total: item.total ?? (Number(item.unitPrice ?? 0) * (item.quantity ?? 1)).toFixed(2),
				startDate: toDate(item.startDate),
				endDate: toDate(item.endDate),
				externalReference: item.externalReference ?? null,
				externalSource: item.externalSource ?? null,
				sortOrder: index
			}))
		);

	return quotation;
}

/** Find a quotation previously mirrored from a legacy system (metadata anchor). */
export async function findQuotationByExternalReference(
	tenantId: string,
	externalReference: string
): Promise<schema.Quotation | null> {
	const rows = await db()
		.select()
		.from(schema.quotations)
		.where(
			and(
				eq(schema.quotations.tenantId, tenantId),
				sql`${schema.quotations.metadata}->>'external_reference' = ${externalReference}`
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function getQuotation(tenantId: string, id: string): Promise<schema.Quotation> {
	const rows = await db()
		.select()
		.from(schema.quotations)
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('QUOTATION_NOT_FOUND', 'Quotation could not be found.');
	return rows[0];
}

export async function getQuotationDetail(tenantId: string, id: string) {
	const quotation = await getQuotation(tenantId, id);
	const [items, versions, customer] = await Promise.all([
		db()
			.select()
			.from(schema.quotationItems)
			.where(eq(schema.quotationItems.quotationId, id))
			.orderBy(schema.quotationItems.sortOrder),
		db()
			.select()
			.from(schema.quotationVersions)
			.where(eq(schema.quotationVersions.quotationId, id))
			.orderBy(desc(schema.quotationVersions.version)),
		quotation.customerId
			? db().select().from(schema.customers).where(eq(schema.customers.id, quotation.customerId)).limit(1)
			: Promise.resolve([])
	]);
	return { quotation, items, versions, customer: customer[0] ?? null };
}

export async function listQuotations(
	tenantId: string,
	p: Pagination,
	filters: { status?: schema.Quotation['status'] } = {}
) {
	const conditions: SQL[] = [eq(schema.quotations.tenantId, tenantId)];
	if (filters.status) conditions.push(eq(schema.quotations.status, filters.status));
	if (p.q) conditions.push(sql`${schema.quotations.reference} ilike ${`%${p.q}%`}`);
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({ quotation: schema.quotations, customer: schema.customers })
			.from(schema.quotations)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.quotations.customerId))
			.where(where)
			.orderBy(desc(schema.quotations.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.quotations).where(where)
	]);
	return { items, total: Number(total) };
}

/** Snapshot the quotation, mark it SENT, and flag the originating request as QUOTED. */
export async function sendQuotation(tenantId: string, id: string, sentByUserId: string | null = null) {
	const { quotation, items } = await getQuotationDetail(tenantId, id);
	if (quotation.status === 'ACCEPTED' || quotation.status === 'CONVERTED') {
		throw new AppError('CONFLICT', 'This quotation has already been accepted.');
	}

	await db()
		.insert(schema.quotationVersions)
		.values({
			tenantId,
			quotationId: id,
			version: quotation.version,
			snapshot: { quotation, items } as unknown as Record<string, unknown>,
			createdByUserId: sentByUserId
		})
		.onConflictDoNothing();

	const [updated] = await db()
		.update(schema.quotations)
		.set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.returning();

	if (quotation.bookingRequestId) {
		await db()
			.update(schema.bookingRequests)
			.set({ status: 'QUOTED', updatedAt: new Date() })
			.where(
				and(eq(schema.bookingRequests.id, quotation.bookingRequestId), eq(schema.bookingRequests.tenantId, tenantId))
			);
	}

	await emit(tenantId, 'quotation.sent', {
		id: updated.id,
		reference: updated.reference,
		total: updated.total,
		currency: updated.currency,
		customerId: updated.customerId
	});

	// Notify the customer through the Template Center. The view link comes from the
	// quotation's own metadata (set by the tenant's site/integration); if it is absent
	// the engine's empty-variable guard skips the send rather than breaking at Meta.
	void (async () => {
		const [customer] = updated.customerId
			? await db().select().from(schema.customers).where(eq(schema.customers.id, updated.customerId)).limit(1)
			: [];
		const meta = (updated.metadata ?? {}) as Record<string, unknown>;
		const link = String(meta.viewUrl ?? meta.publicUrl ?? meta.link ?? '');
		await sendEventTemplate(
			tenantId,
			'QUOTATION_READY',
			customer?.whatsappPhone,
			{
				customer: { firstName: customer?.firstName, lastName: customer?.lastName },
				quotation: { reference: updated.reference, total: `${updated.currency} ${updated.total}`, link }
			},
			`quotation-QUOTATION_READY:${updated.id}:${updated.version}`
		);
	})().catch(() => undefined);
	return updated;
}

export async function markQuotationViewed(tenantId: string, id: string) {
	const [row] = await db()
		.update(schema.quotations)
		.set({ status: 'VIEWED', viewedAt: new Date(), updatedAt: new Date() })
		.where(
			and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId), eq(schema.quotations.status, 'SENT'))
		)
		.returning();
	return row ?? null;
}

export async function declineQuotation(tenantId: string, id: string, reason?: string) {
	await getQuotation(tenantId, id);
	const [row] = await db()
		.update(schema.quotations)
		.set({ status: 'DECLINED', declinedAt: new Date(), updatedAt: new Date(), notes: reason ?? undefined })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.returning();
	return row;
}

/**
 * Accept and convert (§16): the accepted quotation becomes a booking with the same
 * customer, dates and line items. Idempotent — a second accept returns the booking
 * already created rather than making a duplicate.
 */
export async function acceptQuotation(
	tenantId: string,
	id: string,
	actor: { userId?: string | null; apiKeyId?: string | null } = {}
) {
	const { quotation, items } = await getQuotationDetail(tenantId, id);
	if (quotation.status === 'CONVERTED' && quotation.convertedBookingId) {
		const existing = await db()
			.select()
			.from(schema.bookings)
			.where(and(eq(schema.bookings.id, quotation.convertedBookingId), eq(schema.bookings.tenantId, tenantId)))
			.limit(1);
		if (existing[0]) return { quotation, booking: existing[0] };
	}
	if (quotation.status === 'EXPIRED') throw new AppError('CONFLICT', 'This quotation has expired.');
	if (quotation.validUntil && quotation.validUntil.getTime() < Date.now()) {
		await db().update(schema.quotations).set({ status: 'EXPIRED' }).where(eq(schema.quotations.id, id));
		throw new AppError('CONFLICT', 'This quotation has expired.');
	}
	if (!quotation.customerId) throw new AppError('VALIDATION_ERROR', 'This quotation has no customer to book for.');

	const booking = await createBooking(
		tenantId,
		{
			customerId: quotation.customerId,
			bookingRequestId: quotation.bookingRequestId,
			quotationId: quotation.id,
			currency: quotation.currency,
			discount: quotation.discount,
			tax: quotation.tax,
			startDate: quotation.startDate?.toISOString() ?? null,
			endDate: quotation.endDate?.toISOString() ?? null,
			adults: quotation.adults,
			children: quotation.children,
			source: 'ADMIN',
			status: 'AWAITING_PAYMENT',
			items: items.map((i) => ({
				type: i.type,
				title: i.title,
				description: i.description,
				quantity: i.quantity,
				unitPrice: i.unitPrice,
				total: i.total,
				startDate: i.startDate?.toISOString() ?? null,
				endDate: i.endDate?.toISOString() ?? null,
				externalReference: i.externalReference,
				externalSource: i.externalSource
			}))
		},
		actor
	);

	const [updated] = await db()
		.update(schema.quotations)
		.set({ status: 'CONVERTED', acceptedAt: new Date(), convertedBookingId: booking.id, updatedAt: new Date() })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.returning();

	if (quotation.bookingRequestId) {
		await db()
			.update(schema.bookingRequests)
			.set({ status: 'CONVERTED', convertedBookingId: booking.id, updatedAt: new Date() })
			.where(
				and(eq(schema.bookingRequests.id, quotation.bookingRequestId), eq(schema.bookingRequests.tenantId, tenantId))
			);
	}

	await emit(tenantId, 'quotation.accepted', {
		id: updated.id,
		reference: updated.reference,
		bookingId: booking.id,
		bookingReference: booking.bookingReference
	});
	return { quotation: updated, booking };
}

/** Scheduled sweep: expire quotations whose validity has passed. */
export async function expireStaleQuotations(): Promise<number> {
	const rows = await db()
		.update(schema.quotations)
		.set({ status: 'EXPIRED', updatedAt: new Date() })
		.where(
			and(
				sql`${schema.quotations.status} in ('SENT','VIEWED')`,
				sql`${schema.quotations.validUntil} is not null and ${schema.quotations.validUntil} < now()`
			)
		)
		.returning({ id: schema.quotations.id });
	return rows.length;
}

/* ------------------------------------------- legacy quotation mirroring ---- */

export type QuotationMirrorInput = {
	externalReference: string; // the legacy system's code, e.g. GFQ-BCAE65 — the upsert anchor
	externalSource: string;
	customer?: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; whatsappPhone?: string | null } | null;
	/** The legacy system's booking/enquiry id, resolved to our mirrored request when present. */
	legacyBookingRequestId?: string | null;
	title?: string | null;
	status: 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
	currency: string;
	total: string;
	items?: Array<{ label?: string; title?: string; amount?: number | string }> | null;
	adults?: number;
	children?: number;
	travelDate?: string | null;
	validUntil?: string | null;
	notes?: string | null;
	sentAt?: string | null;
	viewedAt?: string | null;
	acceptedAt?: string | null;
	declinedAt?: string | null;
	declineReason?: string | null;
	createdAt?: string | null;
};

/**
 * Upsert a quotation mirrored from a legacy integration (§34 transition).
 *
 * Unlike the native lifecycle, a mirror sets status and timestamps DIRECTLY and never
 * converts an accepted quotation into a booking — the legacy system's semantics (a
 * human confirms after acceptance) are preserved rather than reinterpreted. Idempotent
 * on (tenant, externalReference); each call replaces the previous mirror state.
 */
export async function upsertQuotationMirror(tenantId: string, input: QuotationMirrorInput): Promise<schema.Quotation> {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	let customerId: string | null = null;
	if (input.customer && (input.customer.email || input.customer.phone || input.customer.whatsappPhone || input.customer.firstName)) {
		const matched = await findOrCreateCustomer(tenantId, { ...input.customer, source: 'API' }, tenant.country);
		customerId = matched.id;
	}

	// Link to our mirror of the legacy enquiry when we hold one (dual-written rows carry
	// the legacy id in metadata). Absence is fine — older enquiries were never mirrored.
	let bookingRequestId: string | null = null;
	if (input.legacyBookingRequestId) {
		const rows = await db()
			.select({ id: schema.bookingRequests.id })
			.from(schema.bookingRequests)
			.where(
				and(
					eq(schema.bookingRequests.tenantId, tenantId),
					sql`${schema.bookingRequests.metadata}->>'goldfinch_booking_id' = ${input.legacyBookingRequestId}`
				)
			)
			.limit(1);
		bookingRequestId = rows[0]?.id ?? null;
	}

	const toDateOrNull = (v?: string | null): Date | null => (v ? new Date(v) : null);
	const existing = await findQuotationByExternalReference(tenantId, input.externalReference);

	const values = {
		customerId,
		bookingRequestId,
		status: input.status,
		currency: input.currency,
		subtotal: input.total,
		discount: '0',
		tax: '0',
		total: input.total,
		validUntil: toDateOrNull(input.validUntil),
		startDate: toDateOrNull(input.travelDate),
		adults: input.adults ?? 1,
		children: input.children ?? 0,
		notes: [input.title, input.notes].filter(Boolean).join('\n\n') || null,
		sentAt: toDateOrNull(input.sentAt),
		viewedAt: toDateOrNull(input.viewedAt),
		acceptedAt: toDateOrNull(input.acceptedAt),
		declinedAt: toDateOrNull(input.declinedAt),
		metadata: {
			external_reference: input.externalReference,
			external_source: input.externalSource,
			mirror: true,
			...(input.declineReason ? { decline_reason: input.declineReason } : {})
		} as Record<string, unknown>,
		updatedAt: new Date()
	};

	let quotation: schema.Quotation;
	if (existing) {
		[quotation] = await db()
			.update(schema.quotations)
			.set(values)
			.where(and(eq(schema.quotations.id, existing.id), eq(schema.quotations.tenantId, tenantId)))
			.returning();
		await db().delete(schema.quotationItems).where(eq(schema.quotationItems.quotationId, existing.id));
	} else {
		const reference = await nextReference(db(), tenantId, 'QT', tenant.quotationPrefix || tenant.bookingReferencePrefix);
		[quotation] = await db()
			.insert(schema.quotations)
			.values({
				tenantId,
				reference,
				...values,
				createdAt: input.createdAt ? new Date(input.createdAt) : undefined
			})
			.returning();
	}

	// Legacy items are display-only [{label, amount}]; the total is authoritative.
	// An empty array becomes one synthetic line so the document never renders bare.
	const items = (input.items ?? []).filter((i) => i && (i.label || i.title));
	const rows = items.length
		? items.map((item, index) => ({
				tenantId,
				quotationId: quotation.id,
				type: 'CUSTOM' as const,
				title: String(item.label ?? item.title ?? 'Item'),
				quantity: 1,
				unitPrice: String(Number(item.amount ?? 0).toFixed(2)),
				total: String(Number(item.amount ?? 0).toFixed(2)),
				sortOrder: index
			}))
		: [
				{
					tenantId,
					quotationId: quotation.id,
					type: 'CUSTOM' as const,
					title: input.title || 'Quotation total',
					quantity: 1,
					unitPrice: input.total,
					total: input.total,
					sortOrder: 0
				}
			];
	await db().insert(schema.quotationItems).values(rows);

	return quotation;
}
