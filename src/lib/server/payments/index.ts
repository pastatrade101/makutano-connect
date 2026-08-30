// Traveller booking payments (§19) — deliberately separate from Makutano's own SaaS
// subscription billing, which lives in billing.ts and the subscriptions tables.
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';
import { nextReference } from '../db/references';
import { applyPaymentTotals, getBooking } from '../bookings';
import { applyOrderPaymentTotals, getOrder } from '../orders';
import { sendEventTemplate } from '../whatsapp/template-engine';
import { db as dbh, schema as sch } from '../db';
import { eq as eqh } from 'drizzle-orm';
import { emit } from '../events';
import { AppError } from '../errors';
import { getTenantById } from '../tenants';
import type { Pagination } from '../http';
import { providerFor } from './providers';
import { audit } from '../audit';

const dec = (v: string | number | null | undefined) => Number(v ?? 0);

export type CreatePaymentInput = {
	bookingId?: string | null;
	orderId?: string | null;
	customerId?: string | null;
	provider?: string;
	amount: string;
	currency?: string;
	description?: string | null;
	returnUrl?: string | null;
	metadata?: Record<string, unknown>;
};

export async function createPayment(
	tenantId: string,
	input: CreatePaymentInput,
	actor: { userId?: string | null } = {}
) {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');
	if (dec(input.amount) <= 0) throw new AppError('VALIDATION_ERROR', 'Payment amount must be greater than zero.');

	// Scoped reads: a payment can only ever attach to a booking or order of this tenant.
	const booking = input.bookingId ? await getBooking(tenantId, input.bookingId) : null;
	const order = input.orderId ? await getOrder(tenantId, input.orderId) : null;
	const currency = input.currency ?? booking?.currency ?? order?.currency ?? tenant.currency;
	const provider = providerFor(input.provider ?? 'MANUAL');
	const reference = await nextReference(db(), tenantId, 'PY', tenant.bookingReferencePrefix);

	const [payment] = await db()
		.insert(schema.payments)
		.values({
			tenantId,
			bookingId: booking?.id ?? null,
			orderId: order?.id ?? null,
			customerId: input.customerId ?? booking?.customerId ?? order?.customerId ?? null,
			reference,
			provider: provider.code,
			status: 'PENDING',
			currency,
			amount: input.amount,
			description: input.description ?? null,
			metadata: input.metadata ?? {},
			createdByUserId: actor.userId ?? null
		})
		.returning();

	let redirectUrl: string | null = null;
	try {
		const result = await provider.createCharge({
			tenantId,
			paymentId: payment.id,
			amount: input.amount,
			currency,
			description: input.description,
			returnUrl: input.returnUrl,
			metadata: input.metadata
		});
		redirectUrl = result.redirectUrl ?? null;

		await db()
			.insert(schema.paymentTransactions)
			.values({
				tenantId,
				paymentId: payment.id,
				kind: 'charge',
				status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
				amount: input.amount,
				currency,
				providerReference: result.providerPaymentId ?? null,
				rawResponse: result.raw ?? {}
			});

		const updated = await setPaymentStatus(tenantId, payment.id, result.status, {
			providerPaymentId: result.providerPaymentId ?? null
		});
		return { payment: updated, redirectUrl };
	} catch (err) {
		await setPaymentStatus(tenantId, payment.id, 'FAILED', {
			failureCode: 'charge_failed',
			failureMessage: (err as Error)?.message
		});
		throw err;
	}
}

export async function getPayment(tenantId: string, id: string): Promise<schema.Payment> {
	const rows = await db()
		.select()
		.from(schema.payments)
		.where(and(eq(schema.payments.id, id), eq(schema.payments.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('PAYMENT_NOT_FOUND', 'Payment could not be found.');
	return rows[0];
}

export async function listPayments(
	tenantId: string,
	p: Pagination,
	filters: { status?: schema.Payment['status']; bookingId?: string; orderId?: string } = {}
) {
	const conditions: SQL[] = [eq(schema.payments.tenantId, tenantId)];
	if (filters.status) conditions.push(eq(schema.payments.status, filters.status));
	if (filters.bookingId) conditions.push(eq(schema.payments.bookingId, filters.bookingId));
	if (filters.orderId) conditions.push(eq(schema.payments.orderId, filters.orderId));
	if (p.q) conditions.push(sql`${schema.payments.reference} ilike ${`%${p.q}%`}`);
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({ payment: schema.payments, booking: schema.bookings })
			.from(schema.payments)
			.leftJoin(schema.bookings, eq(schema.bookings.id, schema.payments.bookingId))
			.where(where)
			.orderBy(desc(schema.payments.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.payments).where(where)
	]);
	return { items, total: Number(total) };
}

/**
 * Move a payment to a new status and propagate the consequences: a SUCCEEDED payment
 * recomputes the booking's amount_paid / balance_due and may confirm it (§19).
 */
export async function setPaymentStatus(
	tenantId: string,
	paymentId: string,
	status: schema.Payment['status'],
	extra: { providerPaymentId?: string | null; failureCode?: string | null; failureMessage?: string | null } = {}
): Promise<schema.Payment> {
	const before = await getPayment(tenantId, paymentId);
	if (
		before.status === status &&
		(extra.providerPaymentId === undefined || extra.providerPaymentId === before.providerPaymentId) &&
		(extra.failureCode === undefined || extra.failureCode === before.failureCode) &&
		(extra.failureMessage === undefined || extra.failureMessage === before.failureMessage)
	) {
		return before;
	}

	if (status === 'SUCCEEDED' && before.provider !== 'MANUAL') {
		await assertProviderPaymentMatchesRequest(tenantId, before);
	}

	const [payment] = await db()
		.update(schema.payments)
		.set({
			status,
			...(extra.providerPaymentId !== undefined ? { providerPaymentId: extra.providerPaymentId } : {}),
			...(status === 'SUCCEEDED' ? { paidAt: new Date(), failureCode: null, failureMessage: null } : {}),
			...(status === 'FAILED'
				? { failureCode: extra.failureCode ?? 'failed', failureMessage: extra.failureMessage?.slice(0, 500) ?? null }
				: {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, tenantId)))
		.returning();

	if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Payment could not be found.');

	if (status === 'SUCCEEDED' && payment.bookingId) {
		await applyPaymentTotals(tenantId, payment.bookingId);
		// Same courtesy order payments already get: a receipt through the Template
		// Center when the tenant mapped one. Fire-and-forget.
		void (async () => {
			const [booking] = await dbh()
				.select()
				.from(sch.bookings)
				.where(eqh(sch.bookings.id, payment.bookingId!))
				.limit(1);
			const [customer] = booking?.customerId
				? await dbh().select().from(sch.customers).where(eqh(sch.customers.id, booking.customerId)).limit(1)
				: [];
			const receiptMessage = await sendEventTemplate(
				tenantId,
				'PAYMENT_RECEIVED',
				customer?.whatsappPhone,
				{
					customer: { firstName: customer?.firstName, lastName: customer?.lastName },
					booking: booking ? { reference: booking.bookingReference, total: booking.total } : null,
					payment: { amount: `${payment.currency} ${payment.amount}`, reference: payment.reference }
				},
				`payment-received:${payment.id}`
			);
			if (receiptMessage) {
				await audit(
					tenantId,
					'payment.received_notification_sent',
					{ type: 'system' },
					{ type: 'payment', id: payment.id },
					{ messageId: receiptMessage.id }
				);
			}
		})().catch(() => undefined);
	}
	if ((status === 'SUCCEEDED' || status === 'FAILED') && payment.orderId) {
		const order = await applyOrderPaymentTotals(tenantId, payment.orderId);
		if (status === 'SUCCEEDED') {
			void (async () => {
				const [customer] = order.customerId
					? await dbh().select().from(sch.customers).where(eqh(sch.customers.id, order.customerId)).limit(1)
					: [];
				const receiptMessage = await sendEventTemplate(
					tenantId,
					'PAYMENT_RECEIVED',
					customer?.whatsappPhone,
					{
						customer: { firstName: customer?.firstName, lastName: customer?.lastName },
						order: { number: order.orderNumber, total: order.total, currency: order.currency },
						payment: { amount: `${payment.currency} ${payment.amount}`, reference: payment.reference }
					},
					`payment-received:${payment.id}`
				);
				if (receiptMessage) {
					await audit(
						tenantId,
						'payment.received_notification_sent',
						{ type: 'system' },
						{ type: 'payment', id: payment.id },
						{ messageId: receiptMessage.id }
					);
				}
			})().catch(() => undefined);
		}
	}
	// The source system knows this booking by ITS OWN code, never by Connect's
	// uuid, so a payment event it cannot match to anything is a payment nobody
	// records. external_reference is the whole point of the envelope.
	const externalReference = payment.bookingId ? await bookingExternalReference(tenantId, payment.bookingId) : null;
	const paymentEventData = {
		id: payment.id,
		payment_id: payment.id,
		external_reference: externalReference,
		reference: payment.reference,
		amount: payment.amount,
		currency: payment.currency,
		method: payment.provider ? String(payment.provider).toLowerCase() : null,
		paid_at: (payment.paidAt ?? payment.updatedAt ?? new Date()).toISOString(),
		bookingId: payment.bookingId,
		orderId: payment.orderId
	};

	if (status === 'SUCCEEDED') {
		if (payment.provider !== 'MANUAL') await applyProviderPaymentToRequest(tenantId, payment);
		await emit(tenantId, 'payment.succeeded', paymentEventData);
	}
	if (status === 'FAILED') {
		await emit(tenantId, 'payment.failed', { ...paymentEventData, failureCode: payment.failureCode });
	}
	if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') {
		await emit(tenantId, 'payment.refunded', { ...paymentEventData, amount: payment.amountRefunded });
	}
	return payment;
}

function linkedPaymentRequestId(payment: schema.Payment): string | null {
	const value = (payment.metadata as Record<string, unknown> | null)?.paymentRequestId;
	return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

async function assertProviderPaymentMatchesRequest(tenantId: string, payment: schema.Payment): Promise<void> {
	const requestId = linkedPaymentRequestId(payment);
	if (!requestId) return;
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request)
		throw new AppError('NOT_FOUND', 'The provider payment does not match a payment request in this workspace.');
	if (payment.currency !== request.currency) {
		throw new AppError('CONFLICT', 'The provider-confirmed currency does not match the payment request.');
	}
	const remaining = Math.max(0, dec(request.amountRequested) - dec(request.amountReceived));
	if (dec(payment.amount) > remaining + 0.005) {
		throw new AppError('CONFLICT', 'The provider-confirmed amount exceeds the outstanding payment request.');
	}
}

/**
 * Authenticated provider success is authoritative and bypasses the customer-report
 * step. Totals are recomputed from linked SUCCEEDED payments, making retries idempotent.
 */
async function applyProviderPaymentToRequest(tenantId: string, payment: schema.Payment): Promise<void> {
	const requestId = linkedPaymentRequestId(payment);
	if (!requestId) return;
	const [request] = await db()
		.select()
		.from(schema.paymentRequests)
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)))
		.limit(1);
	if (!request || request.status === 'CANCELLED') return;

	const rows = (await db().execute<{ received: string }>(sql`
		select coalesce(sum(amount - amount_refunded), 0)::numeric(14,2) as received
		from payments
		where tenant_id = ${tenantId}::uuid
		  and status in ('SUCCEEDED','PARTIALLY_REFUNDED')
		  and metadata->>'paymentRequestId' = ${requestId}
	`)) as unknown as Array<{ received: string }>;
	const received = dec(rows[0]?.received);
	const result: schema.PaymentRequest['status'] =
		received + 0.005 >= dec(request.amountRequested) ? 'PAID' : 'PARTIALLY_PAID';

	await db()
		.update(schema.paymentRequests)
		.set({
			status: result,
			amountReceived: received.toFixed(2),
			paymentId: payment.id,
			verifiedByUserId: null,
			verifiedAt: new Date(),
			verificationStartedAt: null,
			updatedAt: new Date()
		})
		.where(and(eq(schema.paymentRequests.id, requestId), eq(schema.paymentRequests.tenantId, tenantId)));

	await audit(
		tenantId,
		'payment.provider_verified',
		{ type: 'system' },
		{ type: 'payment_request', id: requestId },
		{ provider: payment.provider, paymentReference: payment.reference, received: received.toFixed(2), result }
	);
	if (result === 'PARTIALLY_PAID') {
		await audit(
			tenantId,
			'payment.partial_recorded',
			{ type: 'system' },
			{ type: 'payment_request', id: requestId },
			{ provider: payment.provider, totalReceived: received.toFixed(2) }
		);
	}
}

export async function refundPayment(
	tenantId: string,
	paymentId: string,
	amount: string,
	reason: string | null,
	actor: { userId?: string | null } = {}
) {
	const payment = await getPayment(tenantId, paymentId);
	if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
		throw new AppError('CONFLICT', 'Only a successful payment can be refunded.');
	}
	const refundable = dec(payment.amount) - dec(payment.amountRefunded);
	if (dec(amount) <= 0 || dec(amount) > refundable) {
		throw new AppError('VALIDATION_ERROR', `Refund amount must be between 0 and ${refundable.toFixed(2)}.`);
	}

	const [refund] = await db()
		.insert(schema.refunds)
		.values({
			tenantId,
			paymentId,
			amount,
			currency: payment.currency,
			reason,
			status: 'SUCCEEDED',
			createdByUserId: actor.userId ?? null
		})
		.returning();

	const refundedTotal = dec(payment.amountRefunded) + dec(amount);
	const fullyRefunded = refundedTotal >= dec(payment.amount);
	await db()
		.update(schema.payments)
		.set({
			amountRefunded: refundedTotal.toFixed(2),
			status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
			updatedAt: new Date()
		})
		.where(and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, tenantId)));

	await db().insert(schema.paymentTransactions).values({
		tenantId,
		paymentId,
		kind: 'refund',
		status: 'SUCCEEDED',
		amount,
		currency: payment.currency
	});

	if (payment.bookingId) await applyPaymentTotals(tenantId, payment.bookingId);
	if (payment.orderId) await applyOrderPaymentTotals(tenantId, payment.orderId);
	return refund;
}

export async function paymentStats(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			count(*)::int as total,
			count(*) filter (where status = 'SUCCEEDED')::int as succeeded,
			count(*) filter (where status in ('PENDING','PROCESSING'))::int as pending,
			count(*) filter (where status = 'FAILED')::int as failed,
			coalesce(sum(amount - amount_refunded) filter (where status in ('SUCCEEDED','PARTIALLY_REFUNDED')), 0)::float as collected
		from payments where tenant_id = ${tenantId}::uuid
	`)) as unknown as Array<Record<string, number>>;
	const r = rows[0] ?? {};
	return {
		total: Number(r.total ?? 0),
		succeeded: Number(r.succeeded ?? 0),
		pending: Number(r.pending ?? 0),
		failed: Number(r.failed ?? 0),
		collected: Number(r.collected ?? 0)
	};
}


/**
 * The code the tenant's own system knows this booking by.
 *
 * Null when the booking did not come from anywhere — a payment event for a
 * Connect-native booking has nothing to match against on the other side, and
 * saying so is better than sending a uuid the receiver will log as unmatched.
 */
async function bookingExternalReference(tenantId: string, bookingId: string): Promise<string | null> {
	const [row] = await db()
		.select({ externalReference: schema.bookings.externalReference })
		.from(schema.bookings)
		.where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, tenantId)))
		.limit(1);
	return row?.externalReference ?? null;
}
