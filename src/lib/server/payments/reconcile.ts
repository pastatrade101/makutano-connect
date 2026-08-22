// Payment reconciliation job (§28). Re-reads authoritative status from the provider
// for anything still in flight, so a lost redirect or a missed provider webhook does
// not leave a paid booking looking unpaid.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { log } from '../logger';
import { setPaymentStatus } from './index';
import { providerFor } from './providers';

export async function reconcilePayment(paymentId: string): Promise<void> {
	const rows = await db().select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
	const payment = rows[0];
	if (!payment) return;
	if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') return;
	if (!payment.providerPaymentId) return;

	const provider = providerFor(payment.provider);
	if (!provider.isConfigured) return;

	const result = await provider.verify(payment.providerPaymentId);
	if (result.status === 'PENDING' || result.status === 'PROCESSING') return;

	await db()
		.insert(schema.paymentTransactions)
		.values({
			tenantId: payment.tenantId,
			paymentId: payment.id,
			kind: 'webhook',
			status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
			amount: payment.amount,
			currency: payment.currency,
			providerReference: payment.providerPaymentId,
			rawResponse: result.raw ?? {}
		});

	await setPaymentStatus(payment.tenantId, payment.id, result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', {
		failureCode: result.status === 'FAILED' ? 'provider_declined' : null
	});
	log.info('payment_reconciled', { paymentId: payment.id, status: result.status });
}
