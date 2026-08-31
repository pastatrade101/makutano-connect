// Booking requests (§11–§13).
//
// The spec's core distinction: a web form submission is an INQUIRY, not a confirmed
// booking. A booking request is therefore its own record with its own lifecycle, and
// only an explicit conversion produces a booking.
//
// createBookingRequest() implements the whole §17 chain in one transaction-shaped
// operation: match/create the customer, create the request, optionally open a lead,
// link the WhatsApp conversation, send the acknowledgement and emit the event — so a
// later inbound reply lands on the same customer + request + conversation.
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { nextReference } from './db/references';
import { recordUsage } from './billing';
import { assertAllowed } from './entitlements';
import { findOrCreateConversation } from './conversations';
import { findOrCreateCustomer } from './customers';
import { emit } from './events';
import { AppError } from './errors';
import { createLead } from './leads';
import { log } from './logger';
import { notify } from './notifications';
import { normalizePhone } from './phone';
import { getTenantById } from './tenants';
import type { Pagination } from './http';
import { resolveCredentials } from './whatsapp/connections';
import { queueMessage } from './whatsapp/messages';
import { templateForEvent } from './whatsapp/templates';
import { resolveVariables } from './whatsapp/template-engine';

export type BookingRequestItemInput = {
	type?: schema.BookingRequest extends never ? never : (typeof schema.bookingItemTypeEnum.enumValues)[number];
	title: string;
	description?: string | null;
	quantity?: number;
	unitPrice?: string | null;
	total?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	externalReference?: string | null;
	externalSource?: string | null;
	metadata?: Record<string, unknown>;
};

export type TravelerInput = {
	firstName?: string;
	lastName?: string;
	nationality?: string | null;
	dateOfBirth?: string | null;
	passportNumber?: string | null;
	passportExpiry?: string | null;
	dietaryRequirements?: string | null;
	specialRequests?: string | null;
	isLead?: boolean;
};

export type CreateBookingRequestInput = {
	customer: {
		firstName?: string;
		lastName?: string;
		email?: string | null;
		phone?: string | null;
		whatsappPhone?: string | null;
		country?: string | null;
		language?: string | null;
	};
	source?: schema.BookingRequest['source'];
	currency?: string;
	startDate?: string | null;
	endDate?: string | null;
	adults?: number;
	children?: number;
	estimatedTotal?: string | null;
	notes?: string | null;
	externalReference?: string | null;
	externalSource?: string | null;
	/**
	 * The marketplace listing this enquiry came from, when it came from one.
	 *
	 * A marketplace enquiry is an ORDINARY booking request — no new lead type —
	 * so the Flutter app and every existing report keep working untouched. This
	 * is the only structural addition; acquisition context (utm, referrer,
	 * session) belongs in `metadata`, not in lifecycle columns.
	 */
	tourId?: string | null;
	metadata?: Record<string, unknown>;
	items?: BookingRequestItemInput[];
	travelers?: TravelerInput[];
	/** Open a pipeline lead alongside the request. Defaults to true. */
	createLead?: boolean;
	/** Send the WhatsApp acknowledgement. Defaults to true. */
	sendAcknowledgement?: boolean;
};

const toDate = (value?: string | null): Date | null => (value ? new Date(value) : null);

export async function createBookingRequest(tenantId: string, input: CreateBookingRequestInput) {
	await assertAllowed(tenantId, { feature: 'bookings.enabled', limit: 'bookings.maxRequestsPerMonth' });
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	// 1. Customer — matched, not blindly duplicated (§10).
	const customer = await findOrCreateCustomer(
		tenantId,
		{ ...input.customer, source: input.source ?? 'WEBSITE' },
		input.customer.country ?? tenant.country
	);

	// 2. The request itself, with a race-free reference (§14).
	const reference = await nextReference(db(), tenantId, 'RQ', tenant.bookingReferencePrefix);
	const [request] = await db()
		.insert(schema.bookingRequests)
		.values({
			tenantId,
			reference,
			customerId: customer.id,
			source: input.source ?? 'WEBSITE',
			status: 'NEW',
			currency: input.currency ?? tenant.currency,
			startDate: toDate(input.startDate),
			endDate: toDate(input.endDate),
			adults: input.adults ?? 1,
			children: input.children ?? 0,
			estimatedTotal: input.estimatedTotal ?? null,
			notes: input.notes ?? null,
			externalReference: input.externalReference ?? null,
			externalSource: input.externalSource ?? null,
			tourId: input.tourId ?? null,
			metadata: input.metadata ?? {}
		})
		.returning();

	// 3. Items and travellers.
	if (input.items?.length) {
		await db()
			.insert(schema.bookingRequestItems)
			.values(
				input.items.map((item) => ({
					tenantId,
					bookingRequestId: request.id,
					type: item.type ?? 'TOUR',
					title: item.title,
					description: item.description ?? null,
					quantity: item.quantity ?? 1,
					unitPrice: item.unitPrice ?? null,
					total: item.total ?? null,
					startDate: toDate(item.startDate),
					endDate: toDate(item.endDate),
					externalReference: item.externalReference ?? null,
					externalSource: item.externalSource ?? null,
					metadata: item.metadata ?? {}
				}))
			);
	}
	if (input.travelers?.length) {
		await db()
			.insert(schema.bookingRequestTravelers)
			.values(
				input.travelers.map((t) => ({
					tenantId,
					bookingRequestId: request.id,
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

	// 4. Optional pipeline lead.
	let leadId: string | null = null;
	if (input.createLead !== false) {
		const lead = await createLead(tenantId, {
			customerId: customer.id,
			source: input.source ?? 'WEBSITE',
			title: input.items?.[0]?.title ?? `Booking request ${reference}`,
			value: input.estimatedTotal ?? null,
			currency: input.currency ?? tenant.currency
		});
		leadId = lead.id;
	}

	// 5. Link the WhatsApp conversation NOW, so the customer's later reply threads onto
	//    this request instead of arriving as an orphan chat (§17).
	const waPhone = normalizePhone(
		input.customer.whatsappPhone ?? input.customer.phone,
		input.customer.country ?? tenant.country
	);
	let conversationId: string | null = null;
	if (waPhone) {
		const conversation = await findOrCreateConversation({
			tenantId,
			channel: 'WHATSAPP',
			externalId: waPhone,
			customerId: customer.id,
			leadId,
			bookingRequestId: request.id,
			subject: `Booking request ${reference}`
		});
		conversationId = conversation.id;
	}

	const [linked] = await db()
		.update(schema.bookingRequests)
		.set({ leadId, conversationId, updatedAt: new Date() })
		.where(eq(schema.bookingRequests.id, request.id))
		.returning();

	// 6. Acknowledge on WhatsApp — best effort; a messaging failure must never fail the
	//    request the traveller just submitted.
	if (input.sendAcknowledgement !== false && waPhone) {
		void sendAcknowledgement(tenantId, linked, waPhone, customer).catch((err) =>
			log.warn('booking_request_ack_failed', { tenantId, requestId: request.id, error: (err as Error)?.message })
		);
	}

	void recordUsage(tenantId, 'booking_requests');
	await emit(tenantId, 'booking_request.created', {
		id: linked.id,
		reference: linked.reference,
		status: linked.status,
		customerId: customer.id,
		conversationId,
		leadId
	});
	await notify({
		tenantId,
		channel: 'IN_APP',
		event: 'booking_request.created',
		title: `New booking request ${reference}`,
		body: `${customer.firstName} ${customer.lastName}`.trim() || 'A new traveller inquiry has arrived.',
		entityType: 'booking_request',
		entityId: linked.id
	});

	return { request: linked, customer, leadId, conversationId };
}

async function sendAcknowledgement(
	tenantId: string,
	request: schema.BookingRequest,
	waPhone: string,
	customer: schema.Customer
): Promise<void> {
	const credentials = await resolveCredentials(tenantId);
	if (!credentials) return; // tenant has no WhatsApp — silently skip

	const template = await templateForEvent(tenantId, 'BOOKING_REQUEST_RECEIVED');
	const name = customer.firstName || 'there';
	// Resolve the template's OWN variable list — approved templates differ in how many
	// parameters they take, and Meta rejects any mismatch outright.
	const tenant = template ? await getTenantById(tenantId) : null;
	const values = template
		? resolveVariables((template.variables ?? []) as string[], {
				customer: { firstName: customer.firstName, lastName: customer.lastName },
				business: { name: tenant?.name ?? '' },
				booking: { reference: request.reference }
			})
		: [];
	await queueMessage({
		tenantId,
		to: waPhone,
		dedupeKey: `br-ack:${request.id}`,
		content: template && values.length && values.every((v) => v && v.trim())
			? {
					type: 'template',
					templateName: template.name,
					language: template.language,
					components: [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
				}
			: {
					type: 'text',
					text: `Hi ${name}, thanks for your enquiry. We have received it (reference ${request.reference}) and will reply here shortly.`
				}
	});
}

/* ------------------------------------------------------------- queries ---- */

export async function getBookingRequest(
	tenantId: string,
	id: string,
	{ includeDeleted = false }: { includeDeleted?: boolean } = {}
) {
	const rows = await db()
		.select()
		.from(schema.bookingRequests)
		.where(
			and(
				eq(schema.bookingRequests.id, id),
				eq(schema.bookingRequests.tenantId, tenantId),
				...(includeDeleted ? [] : [isNull(schema.bookingRequests.deletedAt)])
			)
		)
		.limit(1);
	if (!rows[0]) throw new AppError('BOOKING_REQUEST_NOT_FOUND', 'Booking request could not be found.');
	return rows[0];
}

/**
 * Hide an enquiry. The conversation it came from is untouched — the customer
 * still exists and their WhatsApp thread still reads the same; this is about
 * one row on a work list, not about forgetting a person.
 */
export async function softDeleteBookingRequest(tenantId: string, id: string) {
	await getBookingRequest(tenantId, id);
	const [row] = await db()
		.update(schema.bookingRequests)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.bookingRequests.id, id), eq(schema.bookingRequests.tenantId, tenantId)))
		.returning();
	return row;
}

export async function restoreBookingRequest(tenantId: string, id: string) {
	await getBookingRequest(tenantId, id, { includeDeleted: true });
	const [row] = await db()
		.update(schema.bookingRequests)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(and(eq(schema.bookingRequests.id, id), eq(schema.bookingRequests.tenantId, tenantId)))
		.returning();
	return row;
}

export async function getBookingRequestDetail(tenantId: string, id: string) {
	const request = await getBookingRequest(tenantId, id);
	const [items, travelers, notes, customer] = await Promise.all([
		db().select().from(schema.bookingRequestItems).where(eq(schema.bookingRequestItems.bookingRequestId, id)),
		db().select().from(schema.bookingRequestTravelers).where(eq(schema.bookingRequestTravelers.bookingRequestId, id)),
		db()
			.select()
			.from(schema.bookingRequestNotes)
			.where(eq(schema.bookingRequestNotes.bookingRequestId, id))
			.orderBy(desc(schema.bookingRequestNotes.createdAt)),
		request.customerId
			? db().select().from(schema.customers).where(eq(schema.customers.id, request.customerId)).limit(1)
			: Promise.resolve([])
	]);
	return { request, items, travelers, notes, customer: customer[0] ?? null };
}

export type BookingRequestFilters = {
	status?: schema.BookingRequest['status'] | schema.BookingRequest['status'][];
	source?: schema.BookingRequest['source'];
	assigneeUserId?: string;
	customerId?: string;
	/** The recently-deleted view, and nothing else. */
	includeDeleted?: boolean;
	onlyDeleted?: boolean;
};

export async function listBookingRequests(tenantId: string, p: Pagination, filters: BookingRequestFilters = {}) {
	const conditions: SQL[] = [eq(schema.bookingRequests.tenantId, tenantId)];
	if (!filters.includeDeleted) conditions.push(isNull(schema.bookingRequests.deletedAt));
	if (filters.onlyDeleted) conditions.push(sql`${schema.bookingRequests.deletedAt} is not null`);
	if (filters.status) {
		conditions.push(
			Array.isArray(filters.status)
				? inArray(schema.bookingRequests.status, filters.status)
				: eq(schema.bookingRequests.status, filters.status)
		);
	}
	if (filters.source) conditions.push(eq(schema.bookingRequests.source, filters.source));
	if (filters.assigneeUserId) conditions.push(eq(schema.bookingRequests.assigneeUserId, filters.assigneeUserId));
	if (filters.customerId) conditions.push(eq(schema.bookingRequests.customerId, filters.customerId));
	if (p.q) {
		const term = `%${p.q}%`;
		conditions.push(
			sql`(${schema.bookingRequests.reference} ilike ${term}
				or ${schema.bookingRequests.notes} ilike ${term}
				or exists (
					select 1 from customers c
					where c.id = ${schema.bookingRequests.customerId}
					  and (c.first_name ilike ${term} or c.last_name ilike ${term} or c.email ilike ${term} or c.whatsapp_phone ilike ${term})
				))`
		);
	}
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({ request: schema.bookingRequests, customer: schema.customers })
			.from(schema.bookingRequests)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.bookingRequests.customerId))
			.where(where)
			.orderBy(desc(schema.bookingRequests.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.bookingRequests).where(where)
	]);
	return { items, total: Number(total) };
}

export type UpdateBookingRequestInput = {
	status?: schema.BookingRequest['status'];
	assigneeUserId?: string | null;
	notes?: string | null;
	estimatedTotal?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	adults?: number;
	children?: number;
	metadata?: Record<string, unknown>;
};

export async function updateBookingRequest(tenantId: string, id: string, input: UpdateBookingRequestInput) {
	const existing = await getBookingRequest(tenantId, id);
	const patch: Partial<typeof schema.bookingRequests.$inferInsert> = { updatedAt: new Date() };
	if (input.status !== undefined) patch.status = input.status;
	if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
	if (input.notes !== undefined) patch.notes = input.notes;
	if (input.estimatedTotal !== undefined) patch.estimatedTotal = input.estimatedTotal;
	if (input.startDate !== undefined) patch.startDate = toDate(input.startDate);
	if (input.endDate !== undefined) patch.endDate = toDate(input.endDate);
	if (input.adults !== undefined) patch.adults = input.adults;
	if (input.children !== undefined) patch.children = input.children;
	if (input.metadata !== undefined) patch.metadata = input.metadata;

	const [row] = await db()
		.update(schema.bookingRequests)
		.set(patch)
		.where(and(eq(schema.bookingRequests.id, id), eq(schema.bookingRequests.tenantId, tenantId)))
		.returning();

	await emit(tenantId, 'booking_request.updated', {
		id: row.id,
		reference: row.reference,
		status: row.status,
		previousStatus: existing.status
	});
	return row;
}

export async function addBookingRequestNote(
	tenantId: string,
	bookingRequestId: string,
	body: string,
	authorUserId: string | null,
	isInternal = true
) {
	await getBookingRequest(tenantId, bookingRequestId);
	const [row] = await db()
		.insert(schema.bookingRequestNotes)
		.values({ tenantId, bookingRequestId, body, authorUserId, isInternal })
		.returning();
	return row;
}

/** Dashboard counters (§22). One query, not six round trips. */
export async function bookingRequestStats(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			count(*)::int as total,
			count(*) filter (where status in ('NEW','UNDER_REVIEW','CONTACTED'))::int as pending,
			count(*) filter (where status = 'QUOTED')::int as quoted,
			count(*) filter (where status = 'ACCEPTED')::int as accepted,
			count(*) filter (where status = 'CONVERTED')::int as converted,
			count(*) filter (where status in ('DECLINED','CANCELLED'))::int as closed,
			count(*) filter (where created_at > now() - interval '7 days')::int as last_7_days
		from booking_requests where tenant_id = ${tenantId}::uuid and deleted_at is null
	`)) as unknown as Array<Record<string, number>>;
	const r = rows[0] ?? {};
	return {
		total: Number(r.total ?? 0),
		pending: Number(r.pending ?? 0),
		quoted: Number(r.quoted ?? 0),
		accepted: Number(r.accepted ?? 0),
		converted: Number(r.converted ?? 0),
		closed: Number(r.closed ?? 0),
		last7Days: Number(r.last_7_days ?? 0)
	};
}


/**
 * The source system says one of its enquiries is gone.
 *
 * Keyed on the SOURCE's own reference — the only identifier it holds; it has
 * never seen Connect's uuid. Idempotent, and quiet about a reference it does
 * not know: a delete replayed twice, or sent for something never mirrored, is
 * not worth failing a webhook over.
 *
 * Deliberately does NOT touch a booking this enquiry was converted into. The
 * source deleting its enquiry says nothing about the sale that came out of it,
 * and Connect owns everything after acceptance.
 */
export async function deleteMirroredBookingRequest(
	tenantId: string,
	externalReference: string
): Promise<{ deleted: boolean; reference: string | null }> {
	const [existing] = await db()
		.select({ id: schema.bookingRequests.id, reference: schema.bookingRequests.reference, deletedAt: schema.bookingRequests.deletedAt })
		.from(schema.bookingRequests)
		.where(
			and(
				eq(schema.bookingRequests.tenantId, tenantId),
				eq(schema.bookingRequests.externalReference, externalReference)
			)
		)
		.limit(1);
	if (!existing || existing.deletedAt) return { deleted: false, reference: existing?.reference ?? null };
	const row = await softDeleteBookingRequest(tenantId, existing.id);
	return { deleted: true, reference: row.reference };
}


/* ------------------------------------------------- the enquiry mirror ------ */

/**
 * Goldfinch's booking status, in Connect's vocabulary.
 *
 * `confirmed` maps to CONVERTED because acceptance PROMOTES the enquiry over
 * there rather than creating a second record — the enquiry becomes the booking.
 * `completed` stays CONVERTED: a request has no later life than having become
 * one, and inventing a status Connect does not otherwise use would put a word
 * on the board that means nothing to anybody reading it.
 */
const SOURCE_STATUS: Record<string, schema.BookingRequest['status']> = {
	pending: 'NEW',
	confirmed: 'CONVERTED',
	completed: 'CONVERTED',
	cancelled: 'CANCELLED'
};

export type BookingRequestMirrorInput = {
	externalReference: string;
	externalSource?: string;
	/** Goldfinch's own booking status, lowercase. */
	status?: string | null;
	/** unpaid | partially_paid | paid | refunded | failed — no column here, so it lives in metadata. */
	paymentStatus?: string | null;
	/** The revised figure after an amendment, if the booking carries one at all. */
	estimatedTotal?: string | null;
	currency?: string | null;
	notes?: string | null;
	/** What changed, in the words the traveller was given. */
	amendment?: { summary?: string | null; priceEffect?: string | null; state?: string | null } | null;
};

/**
 * Update Connect's copy of an enquiry from the source system.
 *
 * Only ever an UPDATE: the enquiry itself arrives through POST /booking-requests
 * when it is created, and inventing one here would turn a status change for a
 * record Connect never saw into a brand new lead in somebody's inbox.
 * Idempotent, and quiet about a reference it does not know — a replayed status
 * change is not worth failing a webhook over.
 */
export async function upsertBookingRequestMirror(
	tenantId: string,
	input: BookingRequestMirrorInput
): Promise<{ updated: boolean; reference: string | null; bookingId?: string | null }> {
	const [existing] = await db()
		.select()
		.from(schema.bookingRequests)
		.where(
			and(
				eq(schema.bookingRequests.tenantId, tenantId),
				eq(schema.bookingRequests.externalReference, input.externalReference)
			)
		)
		.limit(1);
	if (!existing || existing.deletedAt) return { updated: false, reference: existing?.reference ?? null, bookingId: null };

	const patch: Partial<typeof schema.bookingRequests.$inferInsert> = { updatedAt: new Date() };
	const mapped = input.status ? SOURCE_STATUS[input.status.toLowerCase()] : undefined;
	if (mapped) patch.status = mapped;
	if (input.estimatedTotal !== undefined && input.estimatedTotal !== null) patch.estimatedTotal = input.estimatedTotal;
	if (input.currency) patch.currency = input.currency;
	if (input.notes !== undefined) patch.notes = input.notes;

	// Payment state and the amendment trail have no columns here, so they live in
	// metadata — MERGED, because goldfinch_booking_id and the original lead
	// context are already in there and must survive a status change.
	const meta = { ...((existing.metadata ?? {}) as Record<string, unknown>) };
	if (input.paymentStatus) meta.goldfinch_payment_status = input.paymentStatus;
	if (input.status) meta.goldfinch_booking_status = input.status;
	if (input.amendment) {
		const history = Array.isArray(meta.goldfinch_amendments) ? (meta.goldfinch_amendments as unknown[]) : [];
		meta.goldfinch_amendments = [
			...history,
			{
				summary: input.amendment.summary ?? null,
				priceEffect: input.amendment.priceEffect ?? null,
				state: input.amendment.state ?? null,
				at: new Date().toISOString()
			}
		];
	}
	patch.metadata = meta;

	const [row] = await db()
		.update(schema.bookingRequests)
		.set(patch)
		.where(and(eq(schema.bookingRequests.id, existing.id), eq(schema.bookingRequests.tenantId, tenantId)))
		.returning();

	// The handover itself. `confirmed` is the moment the source stops owning this
	// and Connect starts: money, trip and crew all hang off a BOOKING, and none
	// of them can reach an enquiry — payment_requests has no booking_request_id
	// and never should, or payments would attach to a lead.
	let bookingId: string | null = null;
	if (mapped === 'CONVERTED') {
		bookingId = await ensureBookingForMirroredEnquiry(tenantId, row, input);
	}

	return { updated: true, reference: row.reference, bookingId };
}

/**
 * The Connect booking behind a confirmed source enquiry, made once.
 *
 * Idempotent on the SOURCE's reference, not on anything Connect generates:
 * confirming twice, a replayed webhook and a retry after a timeout all have to
 * land on the same booking. The source's code goes on the booking as its
 * external reference so payment events can carry it home again — the receiver
 * knows this trip by that code and by nothing else.
 */
async function ensureBookingForMirroredEnquiry(
	tenantId: string,
	request: schema.BookingRequest,
	input: BookingRequestMirrorInput
): Promise<string | null> {
	const reference = input.externalReference;
	const [already] = await db()
		.select({ id: schema.bookings.id })
		.from(schema.bookings)
		.where(
			and(
				eq(schema.bookings.tenantId, tenantId),
				eq(schema.bookings.externalReference, reference),
				isNull(schema.bookings.deletedAt)
			)
		)
		.limit(1);
	if (already) return already.id;
	if (!request.customerId) return null;

	const { createBooking } = await import('./bookings');
	const total = input.estimatedTotal ?? request.estimatedTotal;
	try {
		const booking = await createBooking(tenantId, {
			customerId: request.customerId,
			bookingRequestId: request.id,
			currency: input.currency ?? request.currency ?? 'USD',
			startDate: request.startDate ? request.startDate.toISOString() : null,
			endDate: request.endDate ? request.endDate.toISOString() : null,
			adults: request.adults ?? 1,
			children: request.children ?? 0,
			status: 'CONFIRMED',
			source: 'WEBSITE',
			externalReference: reference,
			externalSource: input.externalSource ?? 'goldfinch',
			metadata: { goldfinch_booking_code: reference, promoted_from_request: request.reference },
			// One line, from the enquiry. The source owns what was sold and its
			// price; itemising it here would be a second copy free to drift from
			// the quotation the traveller actually agreed to.
			items: [
				{
					title: `Trip ${reference}`,
					type: 'TOUR',
					quantity: 1,
					unitPrice: total && Number(total) > 0 ? String(total) : '0.00'
				}
			]
		});
		log.info('mirrored_enquiry_promoted', { tenantId, reference, bookingId: booking.id });
		return booking.id;
	} catch (error) {
		// A failed promotion must not fail the status update: the enquiry is still
		// correctly marked converted, and this is retried on the next event.
		log.error('mirrored_enquiry_promotion_failed', {
			tenantId,
			reference,
			error: (error as Error)?.message
		});
		return null;
	}
}
