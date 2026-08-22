// Traveller booking payments (§19) — deliberately separate from Makutano's own SaaS
// subscription billing, which lives in billing.ts and the subscriptions tables.
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';
import { nextReference } from '../db/references';
import { applyPaymentTotals, getBooking } from '../bookings';
import { emit } from '../events';
import { AppError } from '../errors';
import { getTenantById } from '../tenants';
import type { Pagination } from '../http';
import { providerFor } from './providers';

const dec = (v: string | number | null | undefined) => Number(v ?? 0);

export type CreatePaymentInput = {
	bookingId?: string | null;
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

	// Scoped read: a payment can only ever attach to a booking of the same tenant.
	const booking = input.bookingId ? await getBooking(tenantId, input.bookingId) : null;
	const currency = input.currency ?? booking?.currency ?? tenant.currency;
	const provider = providerFor(input.provider ?? 'MANUAL');
	const reference = await nextReference(db(), tenantId, 'PY', tenant.bookingReferencePrefix);

	const [payment] = await db()
		.insert(schema.payments)
		.values({
			tenantId,
			bookingId: booking?.id ?? null,
			customerId: input.customerId ?? booking?.customerId ?? null,
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
	filters: { status?: schema.Payment['status']; bookingId?: string } = {}
) {
	const conditions: SQL[] = [eq(schema.payments.tenantId, tenantId)];
	if (filters.status) conditions.push(eq(schema.payments.status, filters.status));
	if (filters.bookingId) conditions.push(eq(schema.payments.bookingId, filters.bookingId));
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
	}
	if (status === 'SUCCEEDED') {
		await emit(tenantId, 'payment.succeeded', {
			id: payment.id,
			reference: payment.reference,
			amount: payment.amount,
			currency: payment.currency,
			bookingId: payment.bookingId
		});
	}
	if (status === 'FAILED') {
		await emit(tenantId, 'payment.failed', {
			id: payment.id,
			reference: payment.reference,
			failureCode: payment.failureCode,
			bookingId: payment.bookingId
		});
	}
	return payment;
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
