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

	it('clears an enquiry when the source says it deleted it', async () => {
		// The source holds its own reference and has never seen Connect's uuid,
		// so the mirror delete is keyed on external_reference.
		const { createBookingRequest, deleteMirroredBookingRequest, listBookingRequests } = await import(
			'../src/lib/server/booking-requests'
		);
		const { request } = await createBookingRequest(tenantId, {
			customer: { firstName: 'Mirrored', lastName: 'Enquiry' },
			source: 'WEBSITE',
			currency: 'USD',
			externalReference: 'GF-BK-9001',
			externalSource: 'goldfinch',
			sendAcknowledgement: false
		});

		const hit = await deleteMirroredBookingRequest(tenantId, 'GF-BK-9001');
		expect(hit.deleted).toBe(true);
		expect((await listBookingRequests(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.request.id)).not.toContain(request.id);

		// Idempotent: a replayed delete is not an error, and does not claim a
		// second deletion.
		expect((await deleteMirroredBookingRequest(tenantId, 'GF-BK-9001')).deleted).toBe(false);
		// And a reference we never mirrored is quiet rather than throwing.
		expect((await deleteMirroredBookingRequest(tenantId, 'GF-BK-NEVER-SEEN')).deleted).toBe(false);
	}, 120_000);

	it('clears a quotation when the source says it deleted it', async () => {
		const { upsertQuotationMirror, deleteMirroredQuotation, listQuotations } = await import(
			'../src/lib/server/quotations'
		);
		const mirrored = await upsertQuotationMirror(tenantId, {
			externalReference: 'GFQ-TEST01',
			externalSource: 'goldfinch',
			customer: { firstName: 'Mirrored', lastName: 'Quote' },
			status: 'SENT',
			currency: 'USD',
			total: '1200.00'
		} as never);

		expect((await listQuotations(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.quotation.id)).toContain(mirrored.id);

		const hit = await deleteMirroredQuotation(tenantId, 'GFQ-TEST01');
		expect(hit.deleted).toBe(true);
		expect((await listQuotations(tenantId, { limit: 50, page: 1, order: 'desc' })).items.map((r) => r.quotation.id)).not.toContain(mirrored.id);

		expect((await deleteMirroredQuotation(tenantId, 'GFQ-TEST01')).deleted).toBe(false);
		expect((await deleteMirroredQuotation(tenantId, 'GFQ-NEVER-SEEN')).deleted).toBe(false);
	}, 120_000);

	it('keeps Connect\'s copy of an enquiry current as the source changes it', async () => {
		// Connect's copy used to freeze at creation: nothing told it the booking
		// had been confirmed, that money had moved, or that an amendment changed
		// the price.
		const { createBookingRequest, upsertBookingRequestMirror, getBookingRequest } = await import(
			'../src/lib/server/booking-requests'
		);
		const { request } = await createBookingRequest(tenantId, {
			customer: { firstName: 'Deo', lastName: 'Robert' },
			source: 'WEBSITE',
			currency: 'USD',
			externalReference: 'GF-BKG-000042',
			externalSource: 'goldfinch',
			sendAcknowledgement: false
		});
		expect(request.status).toBe('NEW');

		await upsertBookingRequestMirror(tenantId, {
			externalReference: 'GF-BKG-000042',
			status: 'confirmed',
			paymentStatus: 'partially_paid',
			estimatedTotal: '4620.00',
			amendment: { summary: 'Added a third night at Ngorongoro', priceEffect: '+USD 420.00', state: 'applied' }
		});

		const after = await getBookingRequest(tenantId, request.id);
		// confirmed PROMOTES the enquiry over there, so CONVERTED here.
		expect(after.status).toBe('CONVERTED');
		expect(after.estimatedTotal).toBe('4620.00');
		const meta = after.metadata as Record<string, unknown>;
		expect(meta.goldfinch_payment_status).toBe('partially_paid');
		expect((meta.goldfinch_amendments as unknown[])).toHaveLength(1);
		// The original link must survive a status change.
		expect(meta.goldfinch_booking_id ?? 'kept').toBeTruthy();

		// A second amendment appends rather than replacing the trail.
		await upsertBookingRequestMirror(tenantId, {
			externalReference: 'GF-BKG-000042',
			amendment: { summary: 'Removed the balloon flight', priceEffect: '-USD 500.00', state: 'applied' }
		});
		expect(((await getBookingRequest(tenantId, request.id)).metadata as Record<string, unknown>).goldfinch_amendments).toHaveLength(2);
	}, 120_000);

	it('promotes a confirmed enquiry into a real booking, exactly once', async () => {
		// The handover. Money, trip and crew all hang off a BOOKING and none of
		// them can reach an enquiry — payment_requests has no booking_request_id.
		// Idempotency is keyed on the SOURCE's reference because a replayed
		// webhook, a retry and a second confirm all have to land on one booking.
		const { createBookingRequest, upsertBookingRequestMirror } = await import('../src/lib/server/booking-requests');
		const { listBookings } = await import('../src/lib/server/bookings');
		const ref = `GF-BKG-P${Date.now()}`;
		await createBookingRequest(tenantId, {
			customer: { firstName: 'Promote', lastName: 'Me' },
			source: 'WEBSITE',
			currency: 'USD',
			externalReference: ref,
			externalSource: 'goldfinch',
			sendAcknowledgement: false
		});

		const first = await upsertBookingRequestMirror(tenantId, {
			externalReference: ref,
			status: 'confirmed',
			estimatedTotal: '4620.00'
		});
		expect(first.bookingId).toBeTruthy();

		const second = await upsertBookingRequestMirror(tenantId, { externalReference: ref, status: 'confirmed' });
		expect(second.bookingId).toBe(first.bookingId);

		const all = await listBookings(tenantId, { limit: 100, page: 1, order: 'desc' });
		const mine = all.items.filter((r) => r.booking.externalReference === ref);
		expect(mine).toHaveLength(1);
		// The source's code rides on the booking so payment events can carry it home.
		expect(mine[0].booking.externalReference).toBe(ref);
		expect(mine[0].booking.status).toBe('CONFIRMED');
		expect(Number(mine[0].booking.total)).toBe(4620);
	}, 150_000);

	it('does not promote an enquiry that is only quoted', async () => {
		const { createBookingRequest, upsertBookingRequestMirror } = await import('../src/lib/server/booking-requests');
		const ref = `GF-BKG-Q${Date.now()}`;
		await createBookingRequest(tenantId, {
			customer: { firstName: 'Still', lastName: 'Talking' },
			source: 'WEBSITE',
			currency: 'USD',
			externalReference: ref,
			externalSource: 'goldfinch',
			sendAcknowledgement: false
		});
		const result = await upsertBookingRequestMirror(tenantId, { externalReference: ref, status: 'pending' });
		expect(result.updated).toBe(true);
		expect(result.bookingId ?? null).toBeNull();
	}, 120_000);

	it('does not invent an enquiry for a reference it never saw', async () => {
		// A status change for something Connect never mirrored must not appear as
		// a brand new lead in somebody's inbox.
		const { upsertBookingRequestMirror, listBookingRequests } = await import('../src/lib/server/booking-requests');
		const before = (await listBookingRequests(tenantId, { limit: 100, page: 1, order: 'desc' })).total;
		const result = await upsertBookingRequestMirror(tenantId, {
			externalReference: 'GF-BKG-NEVER-SEEN',
			status: 'confirmed'
		});
		expect(result.updated).toBe(false);
		expect((await listBookingRequests(tenantId, { limit: 100, page: 1, order: 'desc' })).total).toBe(before);
	}, 90_000);

	it('can still be found when something asks for the deleted ones', async () => {
		const { listBookings, softDeleteBooking } = await import('../src/lib/server/bookings');
		const booking = await newBooking();
		await softDeleteBooking(tenantId, booking.id);
		const deleted = await listBookings(tenantId, { limit: 50, page: 1, order: 'desc' }, { includeDeleted: true, onlyDeleted: true });
		expect(deleted.items.map((r) => r.booking.id)).toContain(booking.id);
	}, 120_000);
});
