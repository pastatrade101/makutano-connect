// The payment-request ladder, acceptance-tested: requested ≠ reminded ≠ reported ≠ paid.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	pr: typeof import('../src/lib/server/payment-requests');
	bookings: typeof import('../src/lib/server/bookings');
	customers: typeof import('../src/lib/server/customers');
	payments: typeof import('../src/lib/server/payments');
};

let ctx: Ctx;
let tenantA: { id: string };
let tenantB: { id: string };
let staffId: string;
const stamp = `${Date.now()}-pr`;

suite('payment requests', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			pr: await import('../src/lib/server/payment-requests'),
			bookings: await import('../src/lib/server/bookings'),
			customers: await import('../src/lib/server/customers'),
			payments: await import('../src/lib/server/payments')
		};
		tenantA = await provisionTestTenant({ name: 'Pay A', slug: `pay-a-${stamp}`, bookingReferencePrefix: 'PAA' });
		tenantB = await provisionTestTenant({ name: 'Pay B', slug: `pay-b-${stamp}`, bookingReferencePrefix: 'PAB' });
		const { db, schema } = ctx.db;
		for (const tenant of [tenantA, tenantB]) {
			await db()
				.update(schema.tenants)
				.set({
					entitlementOverrides: { 'payments.enabled': true },
					settings: {
						capabilities: 'HYBRID',
						paymentMethods: [
							{
								key: 'bank',
								kind: 'BANK',
								displayName: 'Bank Transfer',
								bank: 'CRDB Bank',
								accountName: tenant === tenantA ? 'Pay A Ltd' : 'Pay B Ltd',
								accountNumber: tenant === tenantA ? '10001' : '20002',
								enabled: true
							}
						]
					}
				})
				.where((await import('drizzle-orm')).eq(schema.tenants.id, tenant.id));
			await db()
				.insert(schema.whatsappTemplates)
				.values({
					tenantId: tenant.id,
					name: `payment_request_${tenant.id.slice(0, 8)}`,
					language: 'en',
					status: 'APPROVED',
					bodyText: 'Payment {{1}} {{2}}',
					eventKey: 'PAYMENT_REQUESTED',
					variables: ['payment.amount_due', 'payment.instructions'],
					enabled: true
				});
		}
		const [staff] = await db()
			.insert(schema.users)
			.values({ email: `pr-staff-${stamp}@example.com`, fullName: 'Staff' })
			.returning();
		staffId = staff.id;
	}, 120_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { eq, inArray } = await import('drizzle-orm');
		await db()
			.delete(schema.tenants)
			.where(inArray(schema.tenants.id, [tenantA.id, tenantB.id]));
		await db().delete(schema.users).where(eq(schema.users.id, staffId));
		await ctx.db.closeDb();
	});

	async function mkBooking(tenantId: string, total: string) {
		const { db, schema } = ctx.db;
		const [customer] = await db()
			.insert(schema.customers)
			.values({ tenantId, firstName: 'Amina', whatsappPhone: `2557000${Math.floor(Math.random() * 90000) + 10000}` })
			.returning();
		const [booking] = await db()
			.insert(schema.bookings)
			.values({
				tenantId,
				bookingReference: `T-BK-${Math.random().toString(36).slice(2, 8)}`,
				customerId: customer.id,
				status: 'PENDING',
				currency: 'USD',
				subtotal: total,
				total,
				balanceDue: total
			})
			.returning();
		return { booking, customer };
	}

	it('acceptance: request → report → verify → PAID, booking advances', async () => {
		const { booking } = await mkBooking(tenantA.id, '600.00');

		const { request, reused } = await ctx.pr.createPaymentRequest(tenantA.id, {
			bookingId: booking.id,
			requestedByUserId: staffId
		});
		expect(reused).toBe(false);
		expect(request.status).toBe('REQUESTED');
		expect(request.amountRequested).toBe('600.00');

		// 1. Double-click: same outstanding amount → reused, no duplicate.
		const dup = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		expect(dup.reused).toBe(true);
		expect(dup.request.id).toBe(request.id);

		// 2+3. Customer reports — repeated callbacks no-op, and NEVER means PAID.
		const reported = await ctx.pr.reportPayment(tenantA.id, request.id, { messageId: 'wamid.1' });
		expect(reported.status).toBe('REPORTED');
		const again = await ctx.pr.reportPayment(tenantA.id, request.id, { messageId: 'wamid.1-retry' });
		expect(again.status).toBe('REPORTED');
		expect(again.reportedMessageId).toBe('wamid.1'); // first claim wins, no second record

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		let [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(b.status).toBe('PENDING'); // reporting changed NOTHING about money or lifecycle
		expect(b.amountPaid).toBe('0.00');

		// Staff verifies the full amount → PAID, money recorded, booking advances.
		const verified = await ctx.pr.verifyPaymentRequest(tenantA.id, request.id, { userId: staffId });
		expect(verified.status).toBe('PAID');
		expect(verified.amountReceived).toBe('600.00');
		expect(verified.paymentId).toBeTruthy();

		[b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(b.amountPaid).toBe('600.00');
		expect(b.status).toBe('CONFIRMED'); // domain rule: balance 0 → CONFIRMED

		// Double-confirm is a no-op.
		const reVerified = await ctx.pr.verifyPaymentRequest(tenantA.id, request.id, { userId: staffId });
		expect(reVerified.amountReceived).toBe('600.00');
	});

	it('double-click requests are concurrency-safe, not only sequentially deduped', async () => {
		const { booking } = await mkBooking(tenantA.id, '610.00');
		const [a, b] = await Promise.all([
			ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id }),
			ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id })
		]);
		expect(a.request.id).toBe(b.request.id);
		const all = await ctx.pr.requestsForTransaction(tenantA.id, { bookingId: booking.id });
		expect(all).toHaveLength(1);
	});

	it('manual confirmation is rejected until the customer reports payment', async () => {
		const { booking } = await mkBooking(tenantA.id, '620.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		await expect(ctx.pr.verifyPaymentRequest(tenantA.id, request.id, { userId: staffId })).rejects.toMatchObject({
			code: 'CONFLICT'
		});
	});

	it('4. partial receipt → PARTIALLY_PAID, outstanding stays honest', async () => {
		const { booking } = await mkBooking(tenantA.id, '600.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		await ctx.pr.reportPayment(tenantA.id, request.id);

		const verified = await ctx.pr.verifyPaymentRequest(tenantA.id, request.id, {
			amountReceived: '300',
			userId: staffId
		});
		expect(verified.status).toBe('PARTIALLY_PAID');
		expect(verified.amountReceived).toBe('300.00');

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(b.status).toBe('PARTIALLY_PAID');
		expect(b.balanceDue).toBe('300.00');

		// A second report represents a new claim for the remainder and can be verified once.
		const reportedAgain = await ctx.pr.reportPayment(tenantA.id, request.id, { messageId: 'wamid.partial.2' });
		expect(reportedAgain.status).toBe('REPORTED');
		const settled = await ctx.pr.verifyPaymentRequest(tenantA.id, request.id, {
			amountReceived: '300',
			userId: staffId
		});
		expect(settled.status).toBe('PAID');
		expect(settled.amountReceived).toBe('600.00');
	});

	it('two staff confirmations cannot record the same reported claim twice', async () => {
		const { booking } = await mkBooking(tenantA.id, '630.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		await ctx.pr.reportPayment(tenantA.id, request.id, { messageId: 'wamid.concurrent.verify' });
		await Promise.allSettled([
			ctx.pr.verifyPaymentRequest(tenantA.id, request.id, { userId: staffId }),
			ctx.pr.verifyPaymentRequest(tenantA.id, request.id, { userId: staffId })
		]);
		const { db, schema } = ctx.db;
		const rows = (await db().execute<{ count: number }>((await import('drizzle-orm')).sql`
			select count(*)::int as count from payments
			where tenant_id = ${tenantA.id}::uuid and metadata->>'paymentRequestId' = ${request.id}
		`)) as unknown as Array<{ count: number }>;
		expect(Number(rows[0]?.count)).toBe(1);
	});

	it('5. a reminder never creates another request', async () => {
		const { booking } = await mkBooking(tenantA.id, '500.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		await ctx.pr.remindPaymentRequest(tenantA.id, request.id, { userId: staffId });

		const all = await ctx.pr.requestsForTransaction(tenantA.id, { bookingId: booking.id });
		expect(all).toHaveLength(1); // still exactly one request
	});

	it('18/19. deposits: two independent requests, requested-paid ≠ booking-paid', async () => {
		const { booking } = await mkBooking(tenantA.id, '2000.00');

		const deposit = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id, amount: '600' });
		await ctx.pr.reportPayment(tenantA.id, deposit.request.id);
		const settled = await ctx.pr.verifyPaymentRequest(tenantA.id, deposit.request.id, { userId: staffId });
		expect(settled.status).toBe('PAID'); // the REQUEST is fully paid…

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(b.balanceDue).toBe('1400.00'); // …the BOOKING is not
		expect(b.status).toBe('PARTIALLY_PAID');

		// Later: the balance is its own request; history is preserved, not overwritten.
		const balance = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id, amount: '1400' });
		expect(balance.reused).toBe(false);
		const all = await ctx.pr.requestsForTransaction(tenantA.id, { bookingId: booking.id });
		expect(all).toHaveLength(2);
	});

	it('13. payment not found returns the claim to outstanding, never cancels', async () => {
		const { booking } = await mkBooking(tenantA.id, '450.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		await ctx.pr.reportPayment(tenantA.id, request.id);
		const back = await ctx.pr.paymentNotFound(tenantA.id, request.id, { userId: staffId });
		expect(back.status).toBe('REQUESTED');

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [b] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(b.status).toBe('PENDING'); // booking untouched
	});

	it('7. tenant isolation: requests are invisible and unusable across tenants', async () => {
		const { booking } = await mkBooking(tenantA.id, '100.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });

		await expect(ctx.pr.reportPayment(tenantB.id, request.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(ctx.pr.verifyPaymentRequest(tenantB.id, request.id, { userId: staffId })).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
		await expect(ctx.pr.createPaymentRequest(tenantB.id, { bookingId: booking.id })).rejects.toMatchObject({
			code: 'BOOKING_NOT_FOUND'
		});
	});

	it('8. payment entitlements are enforced before a request is created', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const locked = await provisionTestTenant({
			name: 'Pay Locked',
			slug: `pay-locked-${stamp}`,
			bookingReferencePrefix: 'PAL'
		});
		try {
			const { booking } = await mkBooking(locked.id, '100.00');
			await expect(ctx.pr.createPaymentRequest(locked.id, { bookingId: booking.id })).rejects.toMatchObject({
				code: 'FEATURE_NOT_AVAILABLE'
			});
		} finally {
			await db().delete(schema.tenants).where(eq(schema.tenants.id, locked.id));
		}
	});

	it('14. authenticated provider success settles the request without a customer claim', async () => {
		const { booking } = await mkBooking(tenantA.id, '640.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });
		const { db, schema } = ctx.db;
		const [providerPayment] = await db()
			.insert(schema.payments)
			.values({
				tenantId: tenantA.id,
				bookingId: booking.id,
				customerId: request.customerId,
				reference: `PROVIDER-${Math.random().toString(36).slice(2, 10)}`,
				provider: 'STRIPE',
				providerPaymentId: `pi_${Math.random().toString(36).slice(2, 12)}`,
				status: 'PROCESSING',
				currency: 'USD',
				amount: '640.00',
				metadata: { paymentRequestId: request.id, verificationSource: 'PROVIDER' }
			})
			.returning();
		await ctx.payments.setPaymentStatus(tenantA.id, providerPayment.id, 'SUCCEEDED');
		const [settled] = await db()
			.select()
			.from(schema.paymentRequests)
			.where((await import('drizzle-orm')).eq(schema.paymentRequests.id, request.id));
		expect(settled.status).toBe('PAID');
		expect(settled.amountReceived).toBe('640.00');
		expect(settled.verifiedByUserId).toBeNull();
	});

	it('the inbound "I have paid" path accepts exact payloads and refuses ambiguous text-only matching', async () => {
		const { booking, customer } = await mkBooking(tenantA.id, '750.00');
		const { request } = await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: booking.id });

		const found = await ctx.pr.latestRequestForCustomer(tenantA.id, customer.id);
		expect(found?.id).toBe(request.id);
		expect(ctx.pr.paymentRequestIdFromPayload(ctx.pr.paymentReportPayload(request.id))).toBe(request.id);
		expect((await ctx.pr.unambiguousRequestForCustomer(tenantA.id, customer.id))?.id).toBe(request.id);

		const { db, schema } = ctx.db;
		const [secondBooking] = await db()
			.insert(schema.bookings)
			.values({
				tenantId: tenantA.id,
				bookingReference: `T-BK-${Math.random().toString(36).slice(2, 8)}`,
				customerId: customer.id,
				status: 'PENDING',
				currency: 'USD',
				subtotal: '100.00',
				total: '100.00',
				balanceDue: '100.00'
			})
			.returning();
		await ctx.pr.createPaymentRequest(tenantA.id, { bookingId: secondBooking.id });
		expect(await ctx.pr.unambiguousRequestForCustomer(tenantA.id, customer.id)).toBeNull();

		await ctx.pr.reportPayment(tenantA.id, found!.id, { messageId: 'wamid.button' });
		expect((await ctx.pr.latestRequestForCustomer(tenantA.id, customer.id))?.bookingId).toBe(secondBooking.id);
	});

	it('payment methods render instructions without ever holding secrets', () => {
		const methods = ctx.pr.paymentMethods({
			paymentMethods: [
				{
					key: 'mpesa',
					kind: 'MOBILE',
					displayName: 'M-Pesa Lipa Namba',
					number: '5123456',
					accountName: 'Pay A Ltd',
					enabled: true
				}
			]
		});
		expect(methods).toHaveLength(1);
		expect(ctx.pr.methodInstructions(methods[0])).toBe(
			'M-Pesa Lipa Namba · Business name: Pay A Ltd · Number: 5123456'
		);
	});

	it('keeps reminder V2 inactive until Meta approval, then switches the mapping atomically', async () => {
		const { db, schema } = ctx.db;
		const { and, eq } = await import('drizzle-orm');
		const templates = await import('../src/lib/server/whatsapp/templates');
		await db().insert(schema.whatsappTemplates).values([
			{
				tenantId: tenantA.id,
				name: 'payment_reminder',
				language: 'en',
				status: 'APPROVED',
				eventKey: 'PAYMENT_REMINDER',
				enabled: true
			},
			{
				tenantId: tenantA.id,
				name: 'payment_reminder_v2',
				language: 'en',
				status: 'PENDING',
				eventKey: 'PAYMENT_REMINDER',
				enabled: false
			}
		]);

		expect(await templates.promoteApprovedPaymentReminderV2(tenantA.id)).toBe(false);
		await db()
			.update(schema.whatsappTemplates)
			.set({ status: 'APPROVED' })
			.where(
				and(
					eq(schema.whatsappTemplates.tenantId, tenantA.id),
					eq(schema.whatsappTemplates.name, 'payment_reminder_v2')
				)
			);
		expect(await templates.promoteApprovedPaymentReminderV2(tenantA.id)).toBe(true);

		const rows = await db()
			.select()
			.from(schema.whatsappTemplates)
			.where(
				and(
					eq(schema.whatsappTemplates.tenantId, tenantA.id),
					eq(schema.whatsappTemplates.eventKey, 'PAYMENT_REMINDER')
				)
			);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: 'payment_reminder_v2', status: 'APPROVED', enabled: true });
	});
});
