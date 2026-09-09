// One enquiry, one acceptance, one booking.
//
// The audit found three ways to break that, all of them read-then-act across separate
// autocommitted statements:
//
//   - two concurrent accepts both read SENT and both created a booking;
//   - a DECLINED quotation was still acceptable, because only EXPIRED was refused;
//   - a re-quote left the earlier quotation live, so one enquiry held two acceptable
//     offers and whichever landed second silently re-pointed the enquiry at it.
//
// The race tests here are REAL: the accepts are started together against a live
// Postgres and awaited with Promise.allSettled, so the advisory lock and the
// conditional claim are actually exercised. Two sequential calls would pass against
// the broken code and prove nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.DIRECT_DATABASE_URL ??= TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('acceptance integrity', () => {
	let tenantId: string;
	let mod: typeof import('../src/lib/server/quotations');
	let bookingRequests: typeof import('../src/lib/server/booking-requests');
	let dbmod: typeof import('../src/lib/server/db');

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Integrity Safaris',
			slug: `integrity-${Date.now()}`,
			planCode: 'STARTER'
		});
		tenantId = tenant.id;
		mod = await import('../src/lib/server/quotations');
		bookingRequests = await import('../src/lib/server/booking-requests');
		dbmod = await import('../src/lib/server/db');
		const { liftLimits } = await import('./support');
		await liftLimits(tenantId);
	}, 60000);

	/** A fresh enquiry with one SENT quotation on it. */
	async function sentQuote(tag: string) {
		const enquiry = await bookingRequests.createBookingRequest(tenantId, {
			customer: { firstName: 'Race', lastName: tag, email: `race-${tag}@example.com` },
			source: 'MARKETPLACE',
			adults: 2,
			children: 0,
			sendAcknowledgement: false,
			createLead: false
		});
		const quotation = await mod.createQuotation(tenantId, {
			bookingRequestId: enquiry.request.id,
			currency: 'USD',
			adults: 2,
			items: [{ title: `Trip ${tag}`, quantity: 2, unitPrice: '1000.00', total: '2000.00' }]
		});
		await mod.sendQuotation(tenantId, quotation.id, null);
		return { enquiryId: enquiry.request.id, quotationId: quotation.id };
	}

	const bookingsFor = async (enquiryId: string) => {
		const { db, schema } = dbmod;
		const { eq, and } = await import('drizzle-orm');
		return db()
			.select()
			.from(schema.bookings)
			.where(and(eq(schema.bookings.tenantId, tenantId), eq(schema.bookings.bookingRequestId, enquiryId)));
	};

	it('1. SENT → ACCEPTED produces exactly one booking from the frozen offer', async () => {
		const { enquiryId, quotationId } = await sentQuote('happy');
		const { booking } = await mod.acceptQuotation(tenantId, quotationId, {});
		expect(booking.total).toBe('2000.00');
		expect(await bookingsFor(enquiryId)).toHaveLength(1);
	});

	it('2. accepting the same quotation twice returns the SAME booking', async () => {
		const { enquiryId, quotationId } = await sentQuote('twice');
		const first = await mod.acceptQuotation(tenantId, quotationId, {});
		const second = await mod.acceptQuotation(tenantId, quotationId, {});
		expect(second.booking.id).toBe(first.booking.id);
		expect(await bookingsFor(enquiryId)).toHaveLength(1);
	});

	it('3. CONCURRENT accepts of one quotation create exactly one booking', async () => {
		const { enquiryId, quotationId } = await sentQuote('concurrent');
		// Started together, not awaited in turn — this is the actual race.
		const results = await Promise.allSettled(
			Array.from({ length: 5 }, () => mod.acceptQuotation(tenantId, quotationId, {}))
		);
		const rows = await bookingsFor(enquiryId);
		expect(rows).toHaveLength(1);
		// Whoever succeeded must all name the one booking that exists.
		const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ booking: { id: string } }>[];
		expect(ok.length).toBeGreaterThan(0);
		for (const r of ok) expect(r.value.booking.id).toBe(rows[0].id);
	});

	it('6. a DECLINED quotation cannot be accepted', async () => {
		const { enquiryId, quotationId } = await sentQuote('declined');
		await mod.declineQuotation(tenantId, quotationId, 'Re-quoting at a better rate');
		await expect(mod.acceptQuotation(tenantId, quotationId, {})).rejects.toThrow(/no longer open/i);
		expect(await bookingsFor(enquiryId)).toHaveLength(0);
	});

	it('6b. the decline reason never lands on the traveller-facing notes', async () => {
		const { quotationId } = await sentQuote('declinenotes');
		await mod.declineQuotation(tenantId, quotationId, 'INTERNAL: margin too thin');
		const q = await mod.getQuotation(tenantId, quotationId);
		expect(q.notes ?? '').not.toContain('INTERNAL');
		expect((q.metadata as Record<string, unknown>).declineReason).toBe('INTERNAL: margin too thin');
	});

	it('7. a CONVERTED quotation cannot be declined back into an open offer', async () => {
		const { quotationId } = await sentQuote('nodecline');
		await mod.acceptQuotation(tenantId, quotationId, {});
		await expect(mod.declineQuotation(tenantId, quotationId, 'changed my mind')).rejects.toThrow(
			/already been accepted/i
		);
		const q = await mod.getQuotation(tenantId, quotationId);
		expect(q.status).toBe('CONVERTED');
	});

	it('8. an expired quotation cannot be accepted', async () => {
		const { enquiryId, quotationId } = await sentQuote('expired');
		const { db, schema } = dbmod;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.quotations)
			.set({ validUntil: new Date(Date.now() - 60_000) })
			.where(eq(schema.quotations.id, quotationId));
		await expect(mod.acceptQuotation(tenantId, quotationId, {})).rejects.toThrow(/expired/i);
		expect(await bookingsFor(enquiryId)).toHaveLength(0);
	});

	it('4+5. with two quotations on one enquiry, only the first accepted wins', async () => {
		const { enquiryId, quotationId: v1 } = await sentQuote('two');
		const second = await mod.createQuotation(tenantId, {
			bookingRequestId: enquiryId,
			currency: 'USD',
			adults: 2,
			items: [{ title: 'Trip two (revised)', quantity: 2, unitPrice: '1200.00', total: '2400.00' }]
		});
		await mod.sendQuotation(tenantId, second.id, null);

		const { booking } = await mod.acceptQuotation(tenantId, second.id, {});
		expect(booking.total).toBe('2400.00');

		// Sending V2 already withdrew V1, so accepting the old link is refused by the
		// allow-list — earlier, and for the more precise reason, than the enquiry guard
		// behind it. Both are load-bearing: the allow-list catches the ordinary re-quote,
		// the enquiry guard catches an offer that was never superseded (a quotation with
		// no bookingRequestId, or one created before this rule existed).
		expect((await mod.getQuotation(tenantId, v1)).status).toBe('SUPERSEDED');
		await expect(mod.acceptQuotation(tenantId, v1, {})).rejects.toThrow(/no longer open/i);
		expect(await bookingsFor(enquiryId)).toHaveLength(1);
	});

	it('12. two DIFFERENT quotations on one enquiry, accepted concurrently, yield one booking', async () => {
		const { enquiryId, quotationId: v1 } = await sentQuote('compete');
		const v2 = await mod.createQuotation(tenantId, {
			bookingRequestId: enquiryId,
			currency: 'USD',
			adults: 2,
			items: [{ title: 'Competing revision', quantity: 2, unitPrice: '1500.00', total: '3000.00' }]
		});
		await mod.sendQuotation(tenantId, v2.id, null);

		// The hard case: the lock is keyed on the ENQUIRY, so these serialise against
		// each other even though they are different quotation rows.
		await Promise.allSettled([mod.acceptQuotation(tenantId, v1, {}), mod.acceptQuotation(tenantId, v2.id, {})]);
		expect(await bookingsFor(enquiryId)).toHaveLength(1);
	});

	it('11. the booking takes the FROZEN amount, not the quotation row edited afterwards', async () => {
		const { quotationId } = await sentQuote('frozen');
		const { db, schema } = dbmod;
		const { eq } = await import('drizzle-orm');
		// Rewrite the live rows under the sent offer, as a future editor would.
		await db().update(schema.quotations).set({ total: '99999.00' }).where(eq(schema.quotations.id, quotationId));
		await db()
			.update(schema.quotationItems)
			.set({ unitPrice: '49999.50', total: '99999.00' })
			.where(eq(schema.quotationItems.quotationId, quotationId));

		const { booking } = await mod.acceptQuotation(tenantId, quotationId, {});
		// The offer that was made, not the row as it stands now.
		expect(booking.total).toBe('2000.00');
	});

	/* ---------------------------------------------------- supersede ---- */

	/** V1 sent, then V2 sent on the same enquiry. */
	async function supersededPair(tag: string) {
		const { enquiryId, quotationId: v1 } = await sentQuote(tag);
		const v2 = await mod.createQuotation(tenantId, {
			bookingRequestId: enquiryId,
			currency: 'USD',
			adults: 2,
			items: [{ title: `${tag} revised`, quantity: 2, unitPrice: '1300.00', total: '2600.00' }]
		});
		await mod.sendQuotation(tenantId, v2.id, null);
		return { enquiryId, v1, v2: v2.id };
	}

	it('S1. sending V2 supersedes V1, and leaves V2 the only open offer', async () => {
		const { v1, v2 } = await supersededPair('sup');
		expect((await mod.getQuotation(tenantId, v1)).status).toBe('SUPERSEDED');
		expect((await mod.getQuotation(tenantId, v2)).status).toBe('SENT');
	});

	it('S2. the superseded quotation stays readable, with its own token and its own figures', async () => {
		const { v1 } = await supersededPair('readable');
		const q = await mod.getQuotation(tenantId, v1);
		// Still fetchable, still tokened — the traveller can see what they were sent.
		expect(q.publicToken).toBeTruthy();
		expect(q.deletedAt).toBeNull();
		expect(q.total).toBe('2000.00');
	});

	it('S3+S4. a superseded quotation can be neither accepted nor declined', async () => {
		const { enquiryId, v1 } = await supersededPair('closed');
		await expect(mod.acceptQuotation(tenantId, v1, {})).rejects.toThrow(/no longer open/i);
		await expect(mod.declineQuotation(tenantId, v1, 'nope')).rejects.toThrow(/replaced by a newer offer/i);
		expect(await bookingsFor(enquiryId)).toHaveLength(0);
	});

	it('S5. the new offer accepts normally, at its own price', async () => {
		const { enquiryId, v2 } = await supersededPair('accepts');
		const { booking } = await mod.acceptQuotation(tenantId, v2, {});
		expect(booking.total).toBe('2600.00');
		expect(await bookingsFor(enquiryId)).toHaveLength(1);
	});

	it('S6. settled quotations are NOT superseded — only open offers move', async () => {
		// A declined offer keeps DECLINED: how it ended is a fact about the traveller,
		// and rewriting it to SUPERSEDED would erase that.
		const { enquiryId, quotationId: declined } = await sentQuote('settled');
		await mod.declineQuotation(tenantId, declined, 'too expensive');
		const next = await mod.createQuotation(tenantId, {
			bookingRequestId: enquiryId,
			currency: 'USD',
			adults: 2,
			items: [{ title: 'settled revised', quantity: 2, unitPrice: '900.00', total: '1800.00' }]
		});
		await mod.sendQuotation(tenantId, next.id, null);
		expect((await mod.getQuotation(tenantId, declined)).status).toBe('DECLINED');
	});

	it('S7. a superseded or declined quotation cannot be re-sent back into life', async () => {
		const { v1 } = await supersededPair('resend');
		await expect(mod.sendQuotation(tenantId, v1, null)).rejects.toThrow(/no longer open/i);
		expect((await mod.getQuotation(tenantId, v1)).status).toBe('SUPERSEDED');
	});

	it('13. V2 failing to DELIVER does not reactivate V1 — commercial state is not delivery state', async () => {
		// Email is unconfigured in tests, so V2's delivery genuinely fails. The offer is
		// still frozen and SENT, and V1 stays withdrawn: a transport failure is not a
		// reason to put a replaced price back on the table.
		const { v1, v2 } = await supersededPair('deliveryfail');
		const sent = await mod.getQuotation(tenantId, v2);
		const delivery = (sent.metadata as Record<string, unknown>).delivery as { email: { status: string } } | undefined;
		expect(delivery?.email.status).not.toBe('SENT');
		expect(sent.status).toBe('SENT');
		expect((await mod.getQuotation(tenantId, v1)).status).toBe('SUPERSEDED');
	});

	it("14. superseding does not touch V1's frozen snapshot", async () => {
		const { v1 } = await supersededPair('snapshot');
		const { db, schema } = dbmod;
		const { eq } = await import('drizzle-orm');
		const [version] = await db()
			.select()
			.from(schema.quotationVersions)
			.where(eq(schema.quotationVersions.quotationId, v1));
		const snap = version.snapshot as Record<string, unknown>;
		// The offer that was made stands, whatever happened to the row afterwards.
		expect(snap.total).toBe('2000.00');
		expect((snap.items as { unitPrice: string }[])[0].unitPrice).toBe('1000.00');
	});

	it('16. the DATABASE refuses a second booking for one quotation, not just the app', async () => {
		const { quotationId } = await sentQuote('dbindex');
		const { booking } = await mod.acceptQuotation(tenantId, quotationId, {});
		const { db, schema } = dbmod;
		// Straight at the table, bypassing every application guard — this is what stops
		// POST /api/v1/bookings and the Goldfinch mirror from doubling up.
		await expect(
			db()
				.insert(schema.bookings)
				.values({
					tenantId,
					bookingReference: `DUP-${Date.now()}`,
					customerId: booking.customerId,
					quotationId,
					status: 'PENDING',
					currency: 'USD',
					subtotal: '1.00',
					total: '1.00',
					balanceDue: '1.00'
				})
		).rejects.toThrow(/bookings_one_per_quotation|duplicate key/i);
	});

	it('10. a failure inside acceptance leaves neither a booking nor a claimed quotation', async () => {
		const { enquiryId, quotationId } = await sentQuote('atomic');
		const { db, schema } = dbmod;
		const { eq } = await import('drizzle-orm');
		// Break the snapshot so frozenOfferFor throws after the guards have passed.
		await db().delete(schema.quotationVersions).where(eq(schema.quotationVersions.quotationId, quotationId));

		await expect(mod.acceptQuotation(tenantId, quotationId, {})).rejects.toThrow();
		expect(await bookingsFor(enquiryId)).toHaveLength(0);
		const q = await mod.getQuotation(tenantId, quotationId);
		expect(q.status).toBe('SENT');
		expect(q.convertedBookingId).toBeNull();
	});
});
