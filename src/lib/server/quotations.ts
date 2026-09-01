// Quotations (§16). A quotation may originate from a booking request, a lead, a
// WhatsApp conversation, a customer or nothing at all — so every origin is an optional
// link rather than a required parent.
//
// acceptQuotation() is the piece that matters commercially: accepting converts to a
// booking carrying the customer, trip dates and line items across, so nothing is
// retyped and the numbers cannot drift between the quote and the booking.
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { recordUsage } from './billing';
import { assertAllowed } from './entitlements';
import { changeBookingStatus, createBooking } from './bookings';
import { findOrCreateCustomer } from './customers';
import { emit } from './events';
import { sendEventTemplate } from './whatsapp/template-engine';
import { quotationEmail, sendEmail } from './email';
import { env } from './env';
import { AppError } from './errors';
import { log } from './logger';
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
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId), isNull(schema.quotations.deletedAt)))
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
	filters: { status?: schema.Quotation['status']; includeDeleted?: boolean; onlyDeleted?: boolean } = {}
) {
	const conditions: SQL[] = [eq(schema.quotations.tenantId, tenantId)];
	if (!filters.includeDeleted) conditions.push(isNull(schema.quotations.deletedAt));
	if (filters.onlyDeleted) conditions.push(sql`${schema.quotations.deletedAt} is not null`);
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
/**
 * What a quotation for this enquiry should probably say.
 *
 * A draft, not a record: nothing is written. It exists so that the phone and
 * the portal open the SAME quotation for the same enquiry — before this, the
 * web action invented a line called "Package" priced at the enquiry's estimate
 * (usually zero) while the phone used the tour's own title and published price.
 * Two surfaces quoting the same customer differently is the bug this closes.
 *
 * The "smart" part is only that the enquiry already knows almost all of it —
 * who is asking, when, how many, and for a marketplace enquiry exactly which
 * trip at what price. The pricing DECISION stays with the operator.
 */
export type QuotationDraft = {
	enquiry: {
		id: string;
		reference: string;
		source: string | null;
		notes: string | null;
		startDate: Date | null;
		endDate: Date | null;
		adults: number;
		children: number;
	};
	customer: { id: string; name: string; email: string | null; phone: string | null } | null;
	tour: { title: string; days: number | null; pricingType: string | null } | null;
	currency: string;
	travellers: number;
	items: { description: string; quantity: number; unitPrice: string; basis: 'per group' | 'per person' }[];
	suggestedTotal: string | null;
};

export async function draftQuotationFor(tenantId: string, bookingRequestId: string): Promise<QuotationDraft> {
	const [row] = await db()
		.select({
			request: schema.bookingRequests,
			customer: schema.customers,
			tourTitle: schema.tours.title,
			tourPrice: schema.tours.priceFrom,
			tourCurrency: schema.tours.currency,
			tourPricingType: schema.tours.pricingType,
			tourDays: schema.tours.durationDays
		})
		.from(schema.bookingRequests)
		.leftJoin(schema.customers, eq(schema.customers.id, schema.bookingRequests.customerId))
		.leftJoin(schema.tours, eq(schema.tours.id, schema.bookingRequests.tourId))
		.where(
			and(
				eq(schema.bookingRequests.id, bookingRequestId),
				eq(schema.bookingRequests.tenantId, tenantId),
				isNull(schema.bookingRequests.deletedAt)
			)
		)
		.limit(1);

	if (!row) throw new AppError('NOT_FOUND', 'That enquiry could not be found.');

	const adults = row.request.adults ?? 1;
	const children = row.request.children ?? 0;
	const travellers = Math.max(1, adults + children);

	/*
	 * One line, priced the way the tour is priced.
	 *
	 * PER_GROUP means the published figure is the whole trip, so the quantity
	 * is 1 — multiplying it by the party size would quote four times the real
	 * price. Anything else is per person.
	 */
	const perGroup = row.tourPricingType === 'PER_GROUP';
	const unitPrice = row.tourPrice ?? null;
	const quantity = perGroup ? 1 : travellers;

	return {
		enquiry: {
			id: row.request.id,
			reference: row.request.reference,
			source: row.request.source,
			notes: row.request.notes,
			startDate: row.request.startDate,
			endDate: row.request.endDate,
			adults,
			children
		},
		customer: row.customer
			? {
					id: row.customer.id,
					name: [row.customer.firstName, row.customer.lastName].filter(Boolean).join(' ').trim(),
					email: row.customer.email,
					phone: row.customer.phone ?? row.customer.whatsappPhone
				}
			: null,
		tour: row.tourTitle
			? { title: row.tourTitle, days: row.tourDays, pricingType: row.tourPricingType }
			: null,
		// The tour's own currency wins over the tenant default: quoting a USD
		// trip in shillings because that is the account setting is a real way to
		// send somebody a number that is wrong by a factor of two thousand.
		currency: row.tourCurrency ?? row.request.currency ?? 'USD',
		travellers,
		items: row.tourTitle
			? [
					{
						description: row.tourTitle,
						quantity,
						unitPrice: unitPrice ?? '0',
						// Stated so both surfaces can show WHY the quantity is what it is.
						basis: perGroup ? 'per group' : 'per person'
					}
				]
			: [],
		// Null when the tour has no published price, so the operator is asked
		// rather than presented with a confident zero.
		suggestedTotal: unitPrice ? (Number(unitPrice) * quantity).toFixed(2) : null
	};
}

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

	// Tell the customer, on every channel we can reach them on.
	//
	// Email is the one that always runs: an address is the one contact detail a
	// marketplace enquiry always carries, and it is the channel that can hold a
	// priced breakdown. WhatsApp goes out ALONGSIDE it — not instead of it —
	// whenever the tenant has a connection and the customer a WhatsApp number,
	// because a message on the app someone actually reads is what gets a quote
	// opened, and the two carry the same link to the same page.
	//
	// Both are fire-and-forget and independent: a Meta outage must not stop the
	// email, and an unconfigured mailer must not stop the WhatsApp.
	void deliverQuotation(tenantId, updated).catch(() => undefined);
	return updated;
}

/**
 * The traveller's link.
 *
 * A quotation mirrored from a tenant's own website keeps that site's URL: the
 * customer may already hold it, and that page is the one the legacy system will
 * keep up to date. Anything raised HERE gets the marketplace page, because
 * there is no other site to send them to.
 */
function quotationLink(quotation: { publicToken: string | null; metadata: Record<string, unknown> | null }): string {
	const meta = quotation.metadata ?? {};
	const mirrored = String(meta.viewUrl ?? meta.publicUrl ?? meta.link ?? '');
	if (mirrored) return mirrored;
	if (!quotation.publicToken) return '';
	return `${env().MARKETPLACE_URL.replace(/\/+$/, '')}/quotes/${quotation.publicToken}`;
}

/**
 * Mint the token that the public quotation page accepts.
 *
 * On first send rather than at creation: a draft nobody has been shown should
 * not have a live public URL, and a token that exists is a token that can leak.
 */
async function ensurePublicToken(tenantId: string, id: string, existing: string | null): Promise<string> {
	if (existing) return existing;
	const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
	await db()
		.update(schema.quotations)
		.set({ publicToken: token })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)));
	return token;
}

async function deliverQuotation(tenantId: string, quotation: schema.Quotation) {
	const token = await ensurePublicToken(tenantId, quotation.id, quotation.publicToken);
	const link = quotationLink({ publicToken: token, metadata: quotation.metadata });

	const [customer] = quotation.customerId
		? await db().select().from(schema.customers).where(eq(schema.customers.id, quotation.customerId)).limit(1)
		: [];

	const items = await db()
		.select()
		.from(schema.quotationItems)
		.where(and(eq(schema.quotationItems.quotationId, quotation.id), eq(schema.quotationItems.tenantId, tenantId)))
		.orderBy(schema.quotationItems.sortOrder);

	// The operator's own name and crest, not Connect's: the traveller asked THEM.
	const operatorLogo = alias(schema.media, 'quote_operator_logo');
	const [operator] = await db()
		.select({
			name: schema.operatorProfiles.displayName,
			location: schema.operatorProfiles.location,
			verified: schema.operatorProfiles.isVerified,
			logoUrl: operatorLogo.url
		})
		.from(schema.operatorProfiles)
		.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
		.where(eq(schema.operatorProfiles.tenantId, tenantId))
		.limit(1);

	const tenant = operator ? null : await getTenantById(tenantId);
	const brand = {
		name: operator?.name ?? tenant?.name ?? 'Your operator',
		logoUrl: operator?.logoUrl ?? null,
		location: operator?.location ?? null,
		verified: operator?.verified ?? false
	};

	await Promise.allSettled([
		// Email.
		(async () => {
			if (!customer?.email || !link) return;
			const message = quotationEmail({
				operator: brand,
				customerFirstName: customer.firstName,
				reference: quotation.reference,
				currency: quotation.currency,
				total: quotation.total,
				items: items.map((line) => ({
					title: line.title,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					total: line.total
				})),
				notes: quotation.notes,
				validUntil: quotation.validUntil,
				url: link
			});
			await sendEmail({ ...message, to: customer.email });
		})(),
		// WhatsApp, through the Template Center. Skipped by its own empty-variable
		// guard when there is no number, no connection or no mapped template.
		sendEventTemplate(
			tenantId,
			'QUOTATION_READY',
			customer?.whatsappPhone,
			{
				customer: { firstName: customer?.firstName, lastName: customer?.lastName },
				quotation: { reference: quotation.reference, total: `${quotation.currency} ${quotation.total}`, link }
			},
			`quotation-QUOTATION_READY:${quotation.id}:${quotation.version}`
		)
	]);
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

	/*
	 * Accepted means confirmed.
	 *
	 * The traveller has said yes to a priced quotation, so what comes out of it is
	 * a confirmed sale rather than one waiting to be confirmed a second time by
	 * hand. Money is chased ON a confirmed booking: the outstanding balance and
	 * the commercial status are two different facts, and the payment next-action
	 * reads the balance, not the status.
	 *
	 * Routed through changeBookingStatus rather than created as CONFIRMED
	 * outright, because that function is where the status-history row, the
	 * `booking.confirmed` event and the traveller's BOOKING_CONFIRMED message
	 * happen. Creating it confirmed would have been a silent confirmation —
	 * right in the column and invisible everywhere else.
	 *
	 * Done AFTER the quotation and enquiry are linked to the booking: if this
	 * step fails, the acceptance still stands and the booking is one press of
	 * "Confirm booking" away, rather than an orphan nothing points at.
	 */
	let confirmed = booking;
	try {
		confirmed = await changeBookingStatus(
			tenantId,
			booking.id,
			'CONFIRMED',
			actor,
			`Quotation ${quotation.reference} accepted`
		);
	} catch (err) {
		// Not swallowed silently: the booking exists and is visibly unconfirmed,
		// and this says why.
		log.warn('booking_confirm_after_accept_failed', {
			bookingId: booking.id,
			quotationId: updated.id,
			error: (err as Error)?.message
		});
	}

	await emit(tenantId, 'quotation.accepted', {
		id: updated.id,
		reference: updated.reference,
		bookingId: booking.id,
		bookingReference: booking.bookingReference
	});

	// The traveller said yes: acknowledge it. Best effort — a messaging failure must
	// never undo a booking that has already been created.
	void (async () => {
		const [customer] = updated.customerId
			? await db().select().from(schema.customers).where(eq(schema.customers.id, updated.customerId)).limit(1)
			: [];
		await sendEventTemplate(
			tenantId,
			'QUOTATION_ACCEPTED',
			customer?.whatsappPhone,
			{
				customer: { firstName: customer?.firstName, lastName: customer?.lastName },
				quotation: { reference: updated.reference, total: `${updated.currency} ${updated.total}` }
			},
			`quotation-QUOTATION_ACCEPTED:${updated.id}:${updated.version}`
		);
	})().catch(() => undefined);

	return { quotation: updated, booking: confirmed };
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
	customer?: {
		firstName?: string;
		lastName?: string;
		email?: string | null;
		phone?: string | null;
		whatsappPhone?: string | null;
	} | null;
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
	if (
		input.customer &&
		(input.customer.email || input.customer.phone || input.customer.whatsappPhone || input.customer.firstName)
	) {
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
		const reference = await nextReference(
			db(),
			tenantId,
			'QT',
			tenant.quotationPrefix || tenant.bookingReferencePrefix
		);
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



/**
 * Hide a quotation. Never destroy one.
 *
 * quotation_versions and payment_requests cascade from this row, and an
 * accepted quotation is the provenance of a booking — the record of what was
 * agreed and at what price. So this hides it and nothing more.
 */
export async function softDeleteQuotation(tenantId: string, id: string): Promise<schema.Quotation> {
	await getQuotation(tenantId, id);
	const [row] = await db()
		.update(schema.quotations)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.returning();
	return row;
}

export async function restoreQuotation(tenantId: string, id: string): Promise<schema.Quotation> {
	const [row] = await db()
		.update(schema.quotations)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(and(eq(schema.quotations.id, id), eq(schema.quotations.tenantId, tenantId)))
		.returning();
	if (!row) throw new AppError('NOT_FOUND', 'Quotation could not be found.');
	return row;
}

/**
 * The source system says one of its quotations is gone.
 *
 * Keyed on the SOURCE's id, because that is the only identifier Goldfinch
 * holds — it has never seen Connect's uuid. Idempotent and quiet about a
 * reference it does not know: a delete notification replayed twice, or sent for
 * something that was never mirrored, is not an error worth failing a webhook
 * over.
 */
export async function deleteMirroredQuotation(
	tenantId: string,
	externalReference: string
): Promise<{ deleted: boolean; reference: string | null }> {
	const existing = await findQuotationByExternalReference(tenantId, externalReference);
	if (!existing || existing.deletedAt) return { deleted: false, reference: existing?.reference ?? null };
	const row = await softDeleteQuotation(tenantId, existing.id);
	return { deleted: true, reference: row.reference };
}
