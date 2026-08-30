// Money must not disappear behind a delete.
//
// payment_requests cascaded from bookings, orders and quotations, so a direct
// `delete from bookings ...` — a console, a cleanup script, a test harness
// tidying up after itself — destroyed the payment records and said nothing. The
// app soft-deletes, so this only ever fired where nobody was watching.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('money survives a delete', () => {
	let tenantId: string;
	let customerId: string;

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Money Co', slug: `test-money-${Date.now()}` } as never);
		tenantId = tenant.id;
		const { createCustomer } = await import('../src/lib/server/customers');
		customerId = (await createCustomer(tenantId, { firstName: 'Pay', lastName: 'Er' })).id;
	}, 120_000);

	const bookingWithRequest = async () => {
		const { createBooking } = await import('../src/lib/server/bookings');
		const { db, schema } = await import('../src/lib/server/db');
		const booking = await createBooking(tenantId, {
			customerId,
			status: 'CONFIRMED',
			items: [{ title: 'Trip', type: 'TOUR', quantity: 1, unitPrice: '900.00' }]
		});
		await db()
			.insert(schema.paymentRequests)
			.values({ tenantId, bookingId: booking.id, amountRequested: '900.00', currency: 'USD' });
		return booking.id;
	};

	it('refuses to hard-delete a booking that has money against it', async () => {
		const { db, schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const bookingId = await bookingWithRequest();

		// The delete a cleanup script would do. It used to succeed silently.
		await expect(db().delete(schema.bookings).where(eq(schema.bookings.id, bookingId))).rejects.toThrow();

		const left = await db()
			.select()
			.from(schema.paymentRequests)
			.where(eq(schema.paymentRequests.bookingId, bookingId));
		expect(left).toHaveLength(1);
	}, 120_000);

	it('still lets a whole tenant be removed', async () => {
		// The way this fix could quietly break something: tenant deletion
		// cascades into bookings, and a RESTRICT on the way could have blocked
		// it. It does not — payment_requests go first through their own tenant FK.
		const { db, schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const tenant = await provisionTestTenant({ name: 'Doomed', slug: `test-doomed-${Date.now()}` } as never);
		const { createCustomer } = await import('../src/lib/server/customers');
		const { createBooking } = await import('../src/lib/server/bookings');
		const c = await createCustomer(tenant.id, { firstName: 'Gone' });
		const b = await createBooking(tenant.id, {
			customerId: c.id,
			status: 'CONFIRMED',
			items: [{ title: 'Trip', type: 'TOUR', quantity: 1, unitPrice: '10.00' }]
		});
		await db()
			.insert(schema.paymentRequests)
			.values({ tenantId: tenant.id, bookingId: b.id, amountRequested: '10.00', currency: 'USD' });

		await expect(db().delete(schema.tenants).where(eq(schema.tenants.id, tenant.id))).resolves.toBeDefined();
	}, 150_000);
});
