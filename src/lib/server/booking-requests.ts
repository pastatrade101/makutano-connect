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
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
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
	await queueMessage({
		tenantId,
		to: waPhone,
		dedupeKey: `br-ack:${request.id}`,
		content: template
			? {
					type: 'template',
					templateName: template.name,
					language: template.language,
					components: [
						{
							type: 'body',
							parameters: [
								{ type: 'text', text: name },
								{ type: 'text', text: request.reference }
							]
						}
					]
				}
			: {
					type: 'text',
					text: `Hi ${name}, thanks for your enquiry. We have received it (reference ${request.reference}) and will reply here shortly.`
				}
	});
}

/* ------------------------------------------------------------- queries ---- */

export async function getBookingRequest(tenantId: string, id: string) {
	const rows = await db()
		.select()
		.from(schema.bookingRequests)
		.where(and(eq(schema.bookingRequests.id, id), eq(schema.bookingRequests.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('BOOKING_REQUEST_NOT_FOUND', 'Booking request could not be found.');
	return rows[0];
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
};

export async function listBookingRequests(tenantId: string, p: Pagination, filters: BookingRequestFilters = {}) {
	const conditions: SQL[] = [eq(schema.bookingRequests.tenantId, tenantId)];
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
		from booking_requests where tenant_id = ${tenantId}::uuid
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
