// The payment-request ladder (§payment-workflow brief):
//
//   REQUESTED  — business asks the customer to pay
//   REPORTED   — customer says they paid (a claim, never money)
//   PAID / PARTIALLY_PAID — staff or a trusted provider verified actual receipt
//
// Four different things, never conflated. Money itself is only ever recorded through
// the existing createPayment path, which already drives booking/order balances, the
// PAYMENT_RECEIVED template and its idempotency.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { audit } from './audit';
import { db, schema } from './db';
import { assertAllowed } from './entitlements';
import { AppError } from './errors';
import { log } from './logger';
import { notify } from './notifications';
import { createPayment } from './payments';
import { availableProviders } from './payments/providers';
import { getTenantById } from './tenants';
import { queueMessage } from './whatsapp/messages';
import { sendEventTemplate, type TemplateContext } from './whatsapp/template-engine';

/* ------------------------------------------------ tenant payment methods ---- */

export type PaymentMethod = {
	key: string;
	kind: 'MOBILE' | 'BANK' | 'ONLINE';
	displayName: string; // "M-Pesa Lipa Namba", "CRDB Bank"
	provider?: string;
	bank?: string;
	accountName?: string;
	number?: string; // lipa namba / account number — the tenant chooses what to share
	accountNumber?: string;
	branch?: string;
	swift?: string;
	paymentUrl?: string;
	instructions?: string;
	enabled: boolean;
};

/** Tenant-configured ways to pay, stored in settings (no secrets — display data only). */
export function paymentMethods(settings: Record<string, unknown> | null | undefined): PaymentMethod[] {
	const raw = settings?.paymentMethods;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((value) => {
		if (!value || typeof value !== 'object') return [];
		const row = value as Record<string, unknown>;
		const key = clean(row.key, 40);
		const displayName = clean(row.displayName, 100);
		const kind = String(row.kind ?? 'MOBILE').toUpperCase();
		if (!key || !displayName || !['MOBILE', 'BANK', 'ONLINE'].includes(kind)) return [];
		return [
			{
				key,
				kind: kind as PaymentMethod['kind'],
				displayName,
				provider: optional(row.provider, 100),
				bank: optional(row.bank, 100),
				accountName: optional(row.accountName, 120),
				number: optional(row.number, 120),
				accountNumber: optional(row.accountNumber, 120),
				branch: optional(row.branch, 100),
				swift: optional(row.swift, 32),
				paymentUrl: optional(row.paymentUrl, 500),
				instructions: optional(row.instructions, 500),
				enabled: row.enabled !== false
			}
		];
	});
}

function clean(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optional(value: unknown, max: number): string | undefined {
	return clean(value, max) || undefined;
}

export function paymentMethodIssue(method: PaymentMethod): string | null {
	if (!method.enabled) return 'This payment method is disabled.';
	if (method.kind === 'MOBILE' && !method.number) return 'Add the mobile payment or Lipa Namba number.';
	if (method.kind === 'BANK' && !(method.accountNumber || method.number)) return 'Add the bank account number.';
	if (method.kind === 'ONLINE') {
		const provider = availableProviders().find(
			(candidate) => candidate.code === method.provider?.trim().toUpperCase() && candidate.configured
		);
		if (!provider || provider.code === 'MANUAL' || provider.code === 'BANK_TRANSFER') {
			return 'Choose a connected online payment provider. Connect will generate the secure URL.';
		}
		if (method.paymentUrl) {
			try {
				if (new URL(method.paymentUrl).protocol !== 'https:') return 'Use a secure HTTPS payment URL.';
			} catch {
				return 'The provider generated an invalid payment URL.';
			}
		}
	}
	return null;
}

export function isUsablePaymentMethod(method: PaymentMethod): boolean {
	return paymentMethodIssue(method) === null && methodInstructions(method).length > 0;
}

export function methodInstructions(method: PaymentMethod | undefined): string {
	if (!method) return '';
	const parts =
		method.kind === 'BANK'
			? [
					method.bank ? `Bank: ${method.bank}` : method.displayName,
					method.accountName ? `Account name: ${method.accountName}` : null,
					method.accountNumber || method.number ? `Account number: ${method.accountNumber ?? method.number}` : null,
					method.branch ? `Branch: ${method.branch}` : null,
					method.swift ? `SWIFT: ${method.swift}` : null,
					method.instructions || null
				]
			: method.kind === 'ONLINE'
				? [
						method.provider ? `Provider: ${method.provider}` : method.displayName,
						method.paymentUrl ? `Pay securely: ${method.paymentUrl}` : null,
						method.instructions || null
					]
				: [
						method.provider ? `Provider: ${method.provider}` : method.displayName,
						method.accountName ? `Business name: ${method.accountName}` : null,
						method.number ? `Number: ${method.number}` : null,
						method.instructions || null
					];
	return parts.filter(Boolean).join(' · ');
}

const ACTIVE_REQUEST_STATUSES: schema.PaymentRequest['status'][] = ['REQUESTED', 'REPORTED', 'PARTIALLY_PAID'];
const PAYMENT_REPORT_PREFIX = 'connect:payment_report:';

export const paymentReportPayload = (requestId: string): string => `${PAYMENT_REPORT_PREFIX}${requestId}`;

export function paymentRequestIdFromPayload(payload: string | null | undefined): string | null {
	if (!payload?.startsWith(PAYMENT_REPORT_PREFIX)) return null;
	const id = payload.slice(PAYMENT_REPORT_PREFIX.length);
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/* -------------------------------------------------------------- helpers ---- */

type TransactionRef = { bookingId?: string | null; orderId?: string | null; quotationId?: string | null };

async function resolveTransaction(tenantId: string, ref: TransactionRef) {
	if ([ref.bookingId, ref.orderId, ref.quotationId].filter(Boolean).length !== 1) {
		throw new AppError('VALIDATION_ERROR', 'Choose exactly one booking, order or quotation for this payment request.');
	}
	if (ref.bookingId) {
		const [b] = await db()
			.select()
			.from(schema.bookings)
			.where(and(eq(schema.bookings.id, ref.bookingId), eq(schema.bookings.tenantId, tenantId)))
			.limit(1);
		if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking could not be found.');
		return {
			kind: 'booking' as const,
			typeLabel: 'booking',
			reference: b.bookingReference,
			customerId: b.customerId,
			currency: b.currency,
			outstanding: Number(b.balanceDue ?? b.total),
			conversationId: null as string | null
		};
	}
	if (ref.orderId) {
		const [o] = await db()
			.select()
			.from(schema.orders)
			.where(and(eq(schema.orders.id, ref.orderId), eq(schema.orders.tenantId, tenantId)))
			.limit(1);
		if (!o) throw new AppError('NOT_FOUND', 'Order could not be found.');
		return {
			kind: 'order' as const,
			typeLabel: 'order',
			reference: o.orderNumber,
			customerId: o.customerId,
			currency: o.currency,
			outstanding: Math.max(0, Number(o.total) - Number(o.amountPaid)),
			conversationId: o.conversationId
		};
	}
	if (ref.quotationId) {
		const [q] = await db()
			.select()
			.from(schema.quotations)
			.where(and(eq(schema.quotations.id, ref.quotationId), eq(schema.quotations.tenantId, tenantId)))
			.limit(1);
		if (!q) throw new AppError('QUOTATION_NOT_FOUND', 'Quotation could not be found.');
		return {
			kind: 'quotation' as const,
			typeLabel: 'quotation',
			reference: q.reference,
			customerId: q.customerId,
			currency: q.currency,
			outstanding: Number(q.total),
			conversationId: q.conversationId
		};
	}
	throw new AppError('VALIDATION_ERROR', 'A payment request needs a booking, order or quotation.');
}

async function customerFor(tenantId: string, customerId: string | null) {
	if (!customerId) return null;
	const [c] = await db()
		.select()
		.from(schema.customers)
		.where(and(eq(schema.customers.id, customerId), eq(schema.customers.tenantId, tenantId)))
		.limit(1);
	return c ?? null;
}

async function requestContext(
	tenantId: string,
	request: schema.PaymentRequest
): Promise<{ to: string | null; ctx: TemplateContext }> {
	const tenant = await getTenantById(tenantId);
	const customer = await customerFor(tenantId, request.customerId);
	const methods = paymentMethods(tenant?.settings as Record<string, unknown>);
	const snapshot = paymentMethods({ paymentMethods: [request.methodDetails] })[0];
	const method = snapshot ?? methods.find((m) => m.key === request.methodKey);
	const tx = await resolveTransaction(tenantId, request);
	const remaining = Math.max(0, Number(request.amountRequested) - Number(request.amountReceived));
	return {
		to: customer?.whatsappPhone ?? null,
		ctx: {
			customer: { firstName: customer?.firstName, lastName: customer?.lastName },
			business: { name: tenant?.name ?? '' },
			transaction: { typeLabel: tx.typeLabel, reference: tx.reference },
			booking: request.bookingId ? { reference: tx.reference } : null,
			payment: {
				amountDue: `${request.currency} ${remaining.toFixed(2)}`,
				method: request.methodLabel ?? method?.displayName ?? '',
				instructions: methodInstructions(method) || (request.methodLabel ?? ''),
				reference: request.paymentReference ?? tx.reference
			}
		}
	};
}

export async function paymentRequestTemplateReady(tenantId: string): Promise<boolean> {
	const [template] = await db()
		.select({ id: schema.whatsappTemplates.id })
		.from(schema.whatsappTemplates)
		.where(
			and(
				eq(schema.whatsappTemplates.tenantId, tenantId),
				eq(schema.whatsappTemplates.eventKey, 'PAYMENT_REQUESTED'),
				eq(schema.whatsappTemplates.status, 'APPROVED'),
				eq(schema.whatsappTemplates.enabled, true)
			)
		)
		.limit(1);
	return !!template;
}

async function queuePaymentRequestNotification(
	tenantId: string,
	request: schema.PaymentRequest
): Promise<{ request: schema.PaymentRequest; queued: boolean }> {
	if (request.requestMessageId) return { request, queued: true };
	const { to, ctx } = await requestContext(tenantId, request);
	const message = await sendEventTemplate(tenantId, 'PAYMENT_REQUESTED', to, ctx, `payreq:${request.id}`, {
		quickReplyPayloads: [paymentReportPayload(request.id), `connect:payment_help:${request.id}`]
	});
	if (!message) return { request, queued: false };
	const [updated] = await db()
		.update(schema.paymentRequests)
		.set({ conversationId: message.conversationId, requestMessageId: message.id, updatedAt: new Date() })
		.where(
			and(
				eq(schema.paymentRequests.id, request.id),
				eq(schema.paymentRequests.tenantId, tenantId),
				isNull(schema.paymentRequests.requestMessageId)
			)
		)
		.returning();
	const result = updated ?? request;
	if (updated) {
		await audit(
			tenantId,
			'payment.whatsapp_request_queued',
			{ type: 'system' },
			{ type: 'payment_request', id: request.id },
			{ messageId: message.id }
		);
	}
	return { request: result, queued: true };
}

/* --------------------------------------------------------------- request ---- */

export type CreateRequestInput = TransactionRef & {
	/** Omit to request the full outstanding balance; set for deposits. */
	amount?: string;
	methodKey?: string | null;
	note?: string | null;
	requestedByUserId?: string | null;
};

/**
 * Ask the customer to pay. Deduped: an identical OUTSTANDING request for the same
 * transaction is reused (double-click safe), while a new amount — the balance after a
 * deposit, say — creates a fresh, independently auditable request.
 */
export async function createPaymentRequest(
	tenantId: string,
	input: CreateRequestInput
): Promise<{ request: schema.PaymentRequest; reused: boolean; notificationQueued: boolean }> {
	await assertAllowed(tenantId, { feature: 'payments.enabled' });
	const tx = await resolveTransaction(tenantId, input);
	const amountNum = input.amount ? Number(String(input.amount).replace(/[, ]/g, '')) : tx.outstanding;
	if (!Number.isFinite(amountNum) || amountNum <= 0) {
		throw new AppError('VALIDATION_ERROR', 'The requested amount must be greater than zero.');
	}
	if (amountNum > tx.outstanding + 0.005) {
		throw new AppError(
			'VALIDATION_ERROR',
			`The request cannot exceed the outstanding balance of ${tx.currency} ${tx.outstanding.toFixed(2)}.`
		);
	}
	const amount = amountNum.toFixed(2);

	const tenant = await getTenantById(tenantId);
	const methods = paymentMethods(tenant?.settings as Record<string, unknown>).filter(isUsablePaymentMethod);
	const method = input.methodKey ? methods.find((m) => m.key === input.methodKey) : methods[0];
	if (!method) {
		throw new AppError(
			'VALIDATION_ERROR',
			input.methodKey
				? 'That payment method is unavailable or is missing the details the customer needs.'
				: 'Configure an enabled payment method with usable instructions before requesting payment.'
		);
	}
	const customer = await customerFor(tenantId, tx.customerId);
	if (!customer?.whatsappPhone) {
		throw new AppError('VALIDATION_ERROR', 'Add a valid WhatsApp number to this customer before requesting payment.');
	}
	if (!(await paymentRequestTemplateReady(tenantId))) {
		throw new AppError(
			'VALIDATION_ERROR',
			'The payment request WhatsApp template is not approved and enabled yet. Check the Template Center before sending.'
		);
	}

	// Dedupe against outstanding requests on the same transaction with the same amount.
	const txWhere = input.bookingId
		? eq(schema.paymentRequests.bookingId, input.bookingId)
		: input.orderId
			? eq(schema.paymentRequests.orderId, input.orderId)
			: eq(schema.paymentRequests.quotationId, input.quotationId!);
	const [existing] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(
			and(
				eq(schema.paymentRequests.tenantId, tenantId),
				txWhere,
				inArray(schema.paymentRequests.status, ACTIVE_REQUEST_STATUSES),
				eq(schema.paymentRequests.amountRequested, amount)
			)
		)
		.limit(1);
	if (existing) {
		const queued = await queuePaymentRequestNotification(tenantId, existing);
		return { request: queued.request, reused: true, notificationQueued: queued.queued };
	}

	const [inserted] = await db()
		.insert(schema.paymentRequests)
		.values({
			tenantId,
			customerId: tx.customerId,
			bookingId: input.bookingId ?? null,
			orderId: input.orderId ?? null,
			quotationId: input.quotationId ?? null,
			conversationId: tx.conversationId,
			amountRequested: amount,
			currency: tx.currency,
			methodKey: method.key,
			methodLabel: method.displayName,
			methodDetails: method,
			paymentReference: tx.reference,
			note: input.note ?? null,
			requestedByUserId: input.requestedByUserId ?? null
		})
		.onConflictDoNothing()
		.returning();
	if (!inserted) {
		const [raced] = await db()
			.select()
			.from(schema.paymentRequests)
			.where(
				and(
					eq(schema.paymentRequests.tenantId, tenantId),
					txWhere,
					inArray(schema.paymentRequests.status, ACTIVE_REQUEST_STATUSES),
					eq(schema.paymentRequests.amountRequested, amount)
				)
			)
			.limit(1);
		if (raced) {
			const queued = await queuePaymentRequestNotification(tenantId, raced);
			return { request: queued.request, reused: true, notificationQueued: queued.queued };
		}
		throw new AppError('CONFLICT', 'The payment request could not be created. Please try again.');
	}
	let request = inserted;
	if (method.kind === 'ONLINE') {
		try {
			if (request.quotationId) {
				throw new AppError('NOT_CONFIGURED', 'Online payment links are not yet available for quotations.');
			}
			const charge = await createPayment(
				tenantId,
				{
					bookingId: request.bookingId,
					orderId: request.orderId,
					customerId: request.customerId,
					provider: method.provider?.toUpperCase(),
					amount: request.amountRequested,
					currency: request.currency,
					description: `Payment request ${tx.reference}`,
					metadata: { paymentRequestId: request.id, verificationSource: 'PROVIDER' }
				},
				{ userId: input.requestedByUserId }
			);
			if (!charge.redirectUrl || new URL(charge.redirectUrl).protocol !== 'https:') {
				throw new AppError('CONFLICT', 'The payment provider did not return a secure payment URL.');
			}
			[request] = await db()
				.update(schema.paymentRequests)
				.set({
					methodDetails: { ...method, paymentUrl: charge.redirectUrl },
					paymentId: charge.payment.id,
					updatedAt: new Date()
				})
				.where(and(eq(schema.paymentRequests.id, request.id), eq(schema.paymentRequests.tenantId, tenantId)))
				.returning();
		} catch (err) {
			await db()
				.update(schema.paymentRequests)
				.set({ status: 'CANCELLED', updatedAt: new Date() })
				.where(and(eq(schema.paymentRequests.id, request.id), eq(schema.paymentRequests.tenantId, tenantId)));
			throw err;
		}
	}

	await audit(
		tenantId,
		'payment.requested',
		{ type: 'user', userId: input.requestedByUserId },
		{ type: 'payment_request', id: request.id },
		{ transaction: tx.reference, amount, currency: tx.currency, method: method.displayName }
	);

	// A request is never disguised as a reminder. The existing AWAITING_PAYMENT →
	// PAYMENT_REMINDER hook remains untouched for legacy/direct transitions, while this
	// explicit workflow dispatches only the semantically correct PAYMENT_REQUESTED event.
	const queued = await queuePaymentRequestNotification(tenantId, request);
	request = queued.request;
	return { request, reused: false, notificationQueued: queued.queued };
}

/* ---------------------------------------------------------------- report ---- */

/**
 * The customer pressed "I have paid". A claim, never money: status moves to REPORTED
 * and staff are alerted. Idempotent — Meta retries and repeated presses no-op.
 */
export async function reportPayment(
	tenantId: string,
	requestId: string,
	source: { customerId?: string | null; conversationId?: string | null; messageId?: string | null } = {}
): Promise<schema.PaymentRequest> {
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request) throw new AppError('NOT_FOUND', 'Payment request not found.');
	if (source.customerId && request.customerId !== source.customerId) {
		throw new AppError('NOT_FOUND', 'Payment request not found.');
	}
	if (request.status !== 'REQUESTED' && request.status !== 'PARTIALLY_PAID') return request;

	const [updated] = await db()
		.update(schema.paymentRequests)
		.set({
			status: 'REPORTED',
			reportedAt: new Date(),
			reportedMessageId: source.messageId ?? null,
			conversationId: source.conversationId ?? request.conversationId,
			verificationStartedAt: null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schema.paymentRequests.id, requestId),
				eq(schema.paymentRequests.tenantId, tenantId),
				inArray(schema.paymentRequests.status, ['REQUESTED', 'PARTIALLY_PAID'])
			)
		)
		.returning();
	if (!updated) return request; // raced with another callback — the first one won

	await audit(
		tenantId,
		'payment.reported',
		{ type: 'system' },
		{ type: 'payment_request', id: requestId },
		{
			amount: request.amountRequested,
			currency: request.currency,
			messageId: source.messageId ?? null
		}
	);
	await notify({
		tenantId,
		channel: 'IN_APP',
		event: 'payment.reported',
		title: `Payment reported — ${request.currency} ${request.amountRequested}`,
		body: 'A customer says they have paid. Verify to record it.',
		entityType: 'payment_request',
		entityId: requestId
	});
	return updated;
}

/** Latest outstanding request for explicit, trusted correlation (for example a button payload). */
export async function latestRequestForCustomer(
	tenantId: string,
	customerId: string
): Promise<schema.PaymentRequest | null> {
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(
			and(
				eq(schema.paymentRequests.tenantId, tenantId),
				eq(schema.paymentRequests.customerId, customerId),
				inArray(schema.paymentRequests.status, ['REQUESTED', 'PARTIALLY_PAID'])
			)
		)
		.orderBy(desc(schema.paymentRequests.createdAt))
		.limit(1);
	return request ?? null;
}

/**
 * Legacy text-only buttons carry no request id. They are safe only when the customer
 * has exactly one payable request; ambiguity is left in the conversation for staff.
 */
export async function unambiguousRequestForCustomer(
	tenantId: string,
	customerId: string
): Promise<schema.PaymentRequest | null> {
	const rows = await db()
		.select()
		.from(schema.paymentRequests)
		.where(
			and(
				eq(schema.paymentRequests.tenantId, tenantId),
				eq(schema.paymentRequests.customerId, customerId),
				inArray(schema.paymentRequests.status, ['REQUESTED', 'PARTIALLY_PAID'])
			)
		)
		.orderBy(desc(schema.paymentRequests.createdAt))
		.limit(2);
	return rows.length === 1 ? rows[0] : null;
}

/* ---------------------------------------------------------------- verify ---- */

/**
 * Staff confirms money arrived. The actual payment is recorded through the existing
 * createPayment path (MANUAL succeeds immediately), which already updates the
 * booking/order balance, advances the transaction per its own domain rules, and sends
 * the PAYMENT_RECEIVED template. Partial receipts stay honest: PARTIALLY_PAID.
 */
export async function verifyPaymentRequest(
	tenantId: string,
	requestId: string,
	input: { amountReceived?: string; paymentReference?: string | null; note?: string | null; userId: string }
): Promise<schema.PaymentRequest> {
	await assertAllowed(tenantId, { feature: 'payments.enabled' });
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request) throw new AppError('NOT_FOUND', 'Payment request not found.');
	if (request.status === 'PAID') return request; // double-confirm is a no-op
	if (request.status !== 'REPORTED') {
		throw new AppError('CONFLICT', 'Only a customer-reported payment can be manually verified here.');
	}
	const requestedMethod = paymentMethods({ paymentMethods: [request.methodDetails] })[0];
	if (requestedMethod?.kind === 'ONLINE') {
		throw new AppError(
			'CONFLICT',
			'Online payments must be confirmed by the authenticated provider callback, not manually.'
		);
	}

	const remaining = Math.max(0, Number(request.amountRequested) - Number(request.amountReceived));
	const receivedNum = input.amountReceived
		? Number(String(input.amountReceived).replace(/[, ]/g, ''))
		: remaining;
	if (!Number.isFinite(receivedNum) || receivedNum <= 0) {
		throw new AppError('VALIDATION_ERROR', 'Enter the amount actually received.');
	}
	const received = receivedNum.toFixed(2);
	if (receivedNum > remaining + 0.005) {
		throw new AppError(
			'VALIDATION_ERROR',
			`The remaining requested amount is ${request.currency} ${remaining.toFixed(2)}.`
		);
	}

	// Compare-and-set claim: two staff taps cannot both get past this point. A provider
	// payment already in flight also keeps manual verification out of the race.
	const [providerPayment] = (await db().execute<{ id: string }>(sql`
		select id from payments
		where tenant_id = ${tenantId}::uuid
		  and metadata->>'paymentRequestId' = ${requestId}
		  and provider <> 'MANUAL'
		  and status in ('PENDING','PROCESSING','SUCCEEDED')
		limit 1
	`)) as unknown as Array<{ id: string }>;
	if (providerPayment) {
		throw new AppError(
			'CONFLICT',
			'This payment is being verified by its payment provider. Refresh before confirming manually.'
		);
	}

	const startedAt = new Date();
	const [claimed] = await db()
		.update(schema.paymentRequests)
		.set({ verificationStartedAt: startedAt, updatedAt: startedAt })
		.where(
			and(
				eq(schema.paymentRequests.id, requestId),
				eq(schema.paymentRequests.tenantId, tenantId),
				eq(schema.paymentRequests.status, 'REPORTED'),
				isNull(schema.paymentRequests.verificationStartedAt)
			)
		)
		.returning();
	if (!claimed) {
		const [current] = await db()
			.select()
			.from(schema.paymentRequests)
			.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
			.limit(1);
		if (current?.status === 'PAID' || current?.status === 'PARTIALLY_PAID') return current;
		throw new AppError('CONFLICT', 'Another staff member is already verifying this payment.');
	}

	let payment: schema.Payment;
	try {
		({ payment } = await createPayment(
			tenantId,
			{
				bookingId: request.bookingId,
				orderId: request.orderId,
				customerId: request.customerId,
				provider: 'MANUAL',
				amount: received,
				currency: request.currency,
				description: input.note || `Verified payment request (${request.methodLabel ?? 'manual'})`,
				metadata: {
					paymentRequestId: request.id,
					verificationSource: 'STAFF',
					methodKey: request.methodKey,
					methodLabel: request.methodLabel,
					externalReference: clean(input.paymentReference, 160) || null
				}
			},
			{ userId: input.userId }
		));
	} catch (err) {
		await db()
			.update(schema.paymentRequests)
			.set({ verificationStartedAt: null, updatedAt: new Date() })
			.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)));
		throw err;
	}

	const fullyPaid = receivedNum + Number(request.amountReceived) >= Number(request.amountRequested);
	const [updated] = await db()
		.update(schema.paymentRequests)
		.set({
			status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
			amountReceived: (Number(request.amountReceived) + receivedNum).toFixed(2),
			verifiedByUserId: input.userId,
			verifiedAt: new Date(),
			verificationStartedAt: null,
			paymentId: payment.id,
			updatedAt: new Date()
		})
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.returning();

	await audit(
		tenantId,
		'payment.verified',
		{ type: 'user', userId: input.userId },
		{ type: 'payment_request', id: requestId },
		{
			requested: request.amountRequested,
			received,
			result: updated.status,
			paymentReference: payment.reference,
			externalReference: clean(input.paymentReference, 160) || null
		}
	);
	if (updated.status === 'PARTIALLY_PAID') {
		await audit(
			tenantId,
			'payment.partial_recorded',
			{ type: 'user', userId: input.userId },
			{ type: 'payment_request', id: requestId },
			{ requested: request.amountRequested, totalReceived: updated.amountReceived }
		);
	}
	return updated;
}

/** "Payment not found": back to outstanding, customer politely told. Never punitive. */
export async function paymentNotFound(
	tenantId: string,
	requestId: string,
	actor: { userId: string }
): Promise<schema.PaymentRequest> {
	await assertAllowed(tenantId, { feature: 'payments.enabled' });
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request) throw new AppError('NOT_FOUND', 'Payment request not found.');
	if (request.status !== 'REPORTED') return request;

	const backToStatus: schema.PaymentRequest['status'] =
		Number(request.amountReceived) > 0 ? 'PARTIALLY_PAID' : 'REQUESTED';
	const [updated] = await db()
		.update(schema.paymentRequests)
		.set({ status: backToStatus, verificationStartedAt: null, updatedAt: new Date() })
		.where(
			and(
				eq(schema.paymentRequests.id, requestId),
				eq(schema.paymentRequests.tenantId, tenantId),
				eq(schema.paymentRequests.status, 'REPORTED')
			)
		)
		.returning();
	if (!updated) {
		const [current] = await db()
			.select()
			.from(schema.paymentRequests)
			.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
			.limit(1);
		return current ?? request;
	}

	await audit(
		tenantId,
		'payment.not_found',
		{ type: 'user', userId: actor.userId },
		{ type: 'payment_request', id: requestId }
	);

	// Session message (inside the 24h window after their button press this is allowed;
	// the compliance gate — not this code — makes that call and fails quietly if not).
	void (async () => {
		const customer = await customerFor(tenantId, request.customerId);
		if (!customer?.whatsappPhone) return;
		await queueMessage({
			tenantId,
			to: customer.whatsappPhone,
			conversationId: request.conversationId,
			customerId: customer.id,
			dedupeKey: `payreq-notfound:${requestId}:${request.reportedMessageId ?? request.reportedAt?.toISOString() ?? 'claim'}`,
			content: {
				type: 'text',
				text: `We haven't been able to confirm your payment yet. Please double-check the payment reference or reply here and we'll help.`
			}
		});
	})().catch(() => undefined);
	return updated;
}

/* --------------------------------------------------------------- remind ---- */

/** A reminder about an EXISTING outstanding request — never a new request. */
export async function remindPaymentRequest(
	tenantId: string,
	requestId: string,
	actor: { userId: string }
): Promise<boolean> {
	await assertAllowed(tenantId, { feature: 'payments.enabled' });
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request) throw new AppError('NOT_FOUND', 'Payment request not found.');
	if (request.status !== 'REQUESTED' && request.status !== 'PARTIALLY_PAID') {
		throw new AppError('VALIDATION_ERROR', 'This request is settled — nothing to remind about.');
	}

	const { to, ctx } = await requestContext(tenantId, request);
	// Dedupe per calendar day so an eager operator cannot accidentally spam.
	const day = new Date().toISOString().slice(0, 10);
	const message = await sendEventTemplate(tenantId, 'PAYMENT_REMINDER', to, ctx, `payreq-remind:${requestId}:${day}`, {
		quickReplyPayloads: [paymentReportPayload(request.id), `connect:payment_help:${request.id}`]
	});
	if (message) {
		await db()
			.update(schema.paymentRequests)
			.set({ lastReminderAt: new Date(), updatedAt: new Date() })
			.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)));
		await audit(
			tenantId,
			'payment.reminder_sent',
			{ type: 'user', userId: actor.userId },
			{ type: 'payment_request', id: requestId }
		);
	}
	log.info('payment_reminder', { tenantId, requestId, queued: !!message });
	return !!message;
}

/* ---------------------------------------------------------------- queries ---- */

/** Requests awaiting staff verification, newest first — the Home attention list. */
export async function reportedRequests(tenantId: string) {
	return db()
		.select({
			request: schema.paymentRequests,
			customer: schema.customers,
			booking: schema.bookings,
			order: schema.orders,
			quotation: schema.quotations
		})
		.from(schema.paymentRequests)
		.leftJoin(
			schema.customers,
			and(eq(schema.customers.id, schema.paymentRequests.customerId), eq(schema.customers.tenantId, tenantId))
		)
		.leftJoin(
			schema.bookings,
			and(eq(schema.bookings.id, schema.paymentRequests.bookingId), eq(schema.bookings.tenantId, tenantId))
		)
		.leftJoin(
			schema.orders,
			and(eq(schema.orders.id, schema.paymentRequests.orderId), eq(schema.orders.tenantId, tenantId))
		)
		.leftJoin(
			schema.quotations,
			and(eq(schema.quotations.id, schema.paymentRequests.quotationId), eq(schema.quotations.tenantId, tenantId))
		)
		.where(and(eq(schema.paymentRequests.tenantId, tenantId), eq(schema.paymentRequests.status, 'REPORTED')))
		.orderBy(desc(schema.paymentRequests.reportedAt));
}

export async function requestsForTransaction(tenantId: string, ref: TransactionRef) {
	const txWhere = ref.bookingId
		? eq(schema.paymentRequests.bookingId, ref.bookingId)
		: ref.orderId
			? eq(schema.paymentRequests.orderId, ref.orderId)
			: eq(schema.paymentRequests.quotationId, ref.quotationId!);
	return db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.tenantId, tenantId), txWhere))
		.orderBy(desc(schema.paymentRequests.createdAt));
}

/** Outstanding request linked to a conversation's customer — the chat-side chip. */
export async function requestForConversationCustomer(tenantId: string, customerId: string | null) {
	if (!customerId) return null;
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(
			and(
				eq(schema.paymentRequests.tenantId, tenantId),
				eq(schema.paymentRequests.customerId, customerId),
				inArray(schema.paymentRequests.status, ACTIVE_REQUEST_STATUSES)
			)
		)
		.orderBy(desc(schema.paymentRequests.createdAt))
		.limit(1);
	return request ?? null;
}
