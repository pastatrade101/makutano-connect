// Deleting from a phone, with a thumb, by accident.
//
// The whole point is that this is survivable. A hard delete would cascade into
// the trip, the travellers, the status history and the payment requests, and
// orphan the payments — so these tests are as much about what SURVIVES a delete
// as about what disappears.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('deleting is hiding, not destroying', () => {
	let tenantId: string;
	let customerId: string;

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Delete Co', slug: `test-del-${Date.now()}` } as never);
		tenantId = tenant.id;
		const { createCustomer } = await import('../src/lib/server/customers');
		customerId = (await createCustomer(tenantId, { firstName: 'Anna', lastName: 'Berg' })).id;
	}, 120_000);

	const newBooking = async () => {
		const { createBooking } = await import('../src/lib/server/bookings');
		return createBooking(tenantId, {
			customerId,
			status: 'CONFIRMED',
			items: [{ title: 'Serengeti', type: 'TOUR', quantity: 1, unitPrice: '900.00' }]
		});
	};

	it('takes a deleted booking out of every list, and puts it back', async () => {
		const { listBookings, getBooking, softDeleteBooking, restoreBooking } = await import('../src/lib/server/bookings');
		const booking = await newBooking();

		expect((await listBookings(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.booking.id)).toContain(booking.id);

		await softDeleteBooking(tenantId, booking.id);
		const after = await listBookings(tenantId, { limit: 50, page: 1, order: 'desc' });
		expect(after.items.map((r) => r.booking.id)).not.toContain(booking.id);
		// Gone for anyone holding the id too, not just for the list.
		await expect(getBooking(tenantId, booking.id)).rejects.toThrow(/could not be found/i);

		await restoreBooking(tenantId, booking.id);
		expect((await listBookings(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.booking.id)).toContain(booking.id);
		expect((await getBooking(tenantId, booking.id)).status).toBe('CONFIRMED');
	}, 120_000);

	it('keeps the row, the items and the money', async () => {
		// The reason this is a soft delete at all.
		const { softDeleteBooking } = await import('../src/lib/server/bookings');
		const { db, schema } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const booking = await newBooking();
		await softDeleteBooking(tenantId, booking.id);

		const [row] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
		expect(row).toBeTruthy();
		expect(row.deletedAt).toBeTruthy();
		const items = await db().select().from(schema.bookingItems).where(eq(schema.bookingItems.bookingId, booking.id));
		expect(items).toHaveLength(1);
	}, 120_000);

	it('cancels the trip rather than leaving it on the board', async () => {
		// A departure whose booking was deleted is not something to keep preparing.
		const { softDeleteBooking } = await import('../src/lib/server/bookings');
		const { createTripFromBooking, getTrip } = await import('../src/lib/server/trips');
		const booking = await newBooking();
		const trip = await createTripFromBooking(tenantId, booking.id, {});

		await softDeleteBooking(tenantId, booking.id);
		expect((await getTrip(tenantId, trip.id)).status).toBe('CANCELLED');
	}, 120_000);

	it('hides a deleted enquiry from the list and the counts', async () => {
		const { createBookingRequest, listBookingRequests, softDeleteBookingRequest, restoreBookingRequest } =
			await import('../src/lib/server/booking-requests');
		const { bookingRequestStats } = await import('../src/lib/server/booking-requests');
		const { request: enquiry } = await createBookingRequest(tenantId, {
			customer: { firstName: 'Passing', lastName: 'Trade', email: 'passing@example.com' },
			source: 'WEBSITE',
			currency: 'USD',
			adults: 2,
			notes: 'Wants August',
			// As the other suites do: this test is about the row, not about the
			// acknowledgement the create path would otherwise try to send.
			sendAcknowledgement: false
		});

		const before = await bookingRequestStats(tenantId);
		await softDeleteBookingRequest(tenantId, enquiry.id);
		const after = await bookingRequestStats(tenantId);

		expect((await listBookingRequests(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.request.id)).not.toContain(enquiry.id);
		// The stats query is raw SQL and does not share the list's filter, which is
		// exactly the sort of surface a soft delete leaks out of.
		expect(after.total).toBe(before.total - 1);

		await restoreBookingRequest(tenantId, enquiry.id);
		expect((await listBookingRequests(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.request.id)).toContain(enquiry.id);
	}, 120_000);

	it('can still be found when something asks for the deleted ones', async () => {
		const { listBookings, softDeleteBooking } = await import('../src/lib/server/bookings');
		const booking = await newBooking();
		await softDeleteBooking(tenantId, booking.id);
		const deleted = await listBookings(tenantId, { limit: 50, page: 1, order: 'desc' }, { includeDeleted: true, onlyDeleted: true });
		expect(deleted.items.map((r) => r.booking.id)).toContain(booking.id);
	}, 120_000);
});
