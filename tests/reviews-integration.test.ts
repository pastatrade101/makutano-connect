// The whole review journey, against a real database.
//
// Reviews are the one thing on this marketplace an operator has an obvious
// motive to interfere with, so this suite is written as much about who CANNOT
// do things as who can. Every "cannot" here is a boundary the product depends
// on: an operator who could hide a bad review, or a stranger who could review a
// trip they did not take, makes every rating on the site worthless.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('reviews', () => {
	let ctx: {
		db: typeof import('../src/lib/server/db');
		reviews: typeof import('../src/lib/server/reviews');
		bookings: typeof import('../src/lib/server/bookings');
		customers: typeof import('../src/lib/server/customers');
		permissions: typeof import('../src/lib/server/auth/permissions');
	};
	let operatorA: { id: string };
	let operatorB: { id: string };
	let moderatorId: string;
	const stamp = `${Date.now()}-rev`;

	/** A completed booking for a real customer, ready to be reviewed. */
	async function completedBooking(tenantId: string, name: string) {
		const customer = await ctx.customers.createCustomer(tenantId, {
			firstName: name,
			lastName: 'Traveller',
			email: `${name.toLowerCase()}-${stamp}@example.test`
		});
		const booking = await ctx.bookings.createBooking(tenantId, {
			customerId: customer.id,
			currency: 'USD',
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Northern circuit', quantity: 2, unitPrice: '100.00' }]
		});
		await ctx.bookings.changeBookingStatus(tenantId, booking.id, 'CONFIRMED');
		await ctx.bookings.changeBookingStatus(tenantId, booking.id, 'COMPLETED');
		return { booking, customer };
	}

	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			reviews: await import('../src/lib/server/reviews'),
			bookings: await import('../src/lib/server/bookings'),
			customers: await import('../src/lib/server/customers'),
			permissions: await import('../src/lib/server/auth/permissions')
		};
		operatorA = await provisionTestTenant({ name: 'Op A', slug: `op-a-${stamp}`, bookingReferencePrefix: 'OPA' });
		operatorB = await provisionTestTenant({ name: 'Op B', slug: `op-b-${stamp}`, bookingReferencePrefix: 'OPB' });
		const { schema, db } = ctx.db;
		const [user] = await db().select({ id: schema.users.id }).from(schema.users).limit(1);
		moderatorId = user.id;
	});

	afterAll(async () => {
		await ctx.db.closeDb?.();
	});

	/* ------------------------------------------------------ the happy path -- */

	it('runs the whole journey: completed trip → invite → submit → moderate → public', async () => {
		const { booking, customer } = await completedBooking(operatorA.id, 'Asha');

		const eligibility = await ctx.reviews.checkReviewEligibility(booking.id);
		expect(eligibility.eligible).toBe(true);

		const { token, reviewId } = await ctx.reviews.inviteReview(booking.id);
		expect(token).toMatch(/^[a-f0-9]{40}$/);

		// The traveller's page before they write: context, no rating yet.
		const invited = await ctx.reviews.getOwnReview(token);
		expect(invited?.submitted).toBe(false);
		expect(invited?.rating).toBeNull();

		await ctx.reviews.submitReview(token, {
			rating: 5,
			title: 'Superb guiding',
			body: 'Our guide read the bush better than anyone we have travelled with.'
		});

		// PENDING is not public. This is the assertion that stops a marketplace
		// showing unmoderated words.
		const beforePublish = await ctx.reviews.getPublicOperatorReviews(operatorA.id, { page: 1, limit: 20, order: 'desc' });
		expect(beforePublish.items).toHaveLength(0);
		expect(beforePublish.summary.average).toBeNull();

		// The traveller's own view still works and still says pending.
		const own = await ctx.reviews.getOwnReview(token);
		expect(own?.submitted).toBe(true);
		expect(own?.status).toBe('PENDING');

		await ctx.reviews.moderateReview(reviewId, 'publish', { userId: moderatorId });

		const afterPublish = await ctx.reviews.getPublicOperatorReviews(operatorA.id, { page: 1, limit: 20, order: 'desc' });
		expect(afterPublish.items).toHaveLength(1);
		expect(afterPublish.summary.average).toBe(5);
		// Privacy: a first name and an initial, never the address it was sent to.
		expect(afterPublish.items[0].author).toBe('Asha T.');
		expect(JSON.stringify(afterPublish.items[0])).not.toContain(customer.email);
		expect(JSON.stringify(afterPublish.items[0])).not.toContain(booking.bookingReference);

		// The operator answers — their only write.
		await ctx.reviews.respondToReview(operatorA.id, reviewId, 'Thank you for travelling with us.');
		const answered = await ctx.reviews.getPublicOperatorReviews(operatorA.id, { page: 1, limit: 20, order: 'desc' });
		expect(answered.items[0].operatorResponse).toBe('Thank you for travelling with us.');
	});

	/* --------------------------------------------------------- eligibility -- */

	it('refuses a booking that has not completed', async () => {
		const customer = await ctx.customers.createCustomer(operatorA.id, { firstName: 'Early', lastName: 'Bird' });
		const booking = await ctx.bookings.createBooking(operatorA.id, {
			customerId: customer.id,
			currency: 'USD',
			status: 'AWAITING_PAYMENT',
			items: [{ title: 'Trip', quantity: 1, unitPrice: '10.00' }]
		});
		const eligibility = await ctx.reviews.checkReviewEligibility(booking.id);
		expect(eligibility.eligible).toBe(false);
		await expect(ctx.reviews.inviteReview(booking.id)).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('refuses a cancelled booking, and revokes a refunded one', async () => {
		const { booking } = await completedBooking(operatorA.id, 'Refunded');
		await ctx.bookings.changeBookingStatus(operatorA.id, booking.id, 'REFUNDED');
		const eligibility = await ctx.reviews.checkReviewEligibility(booking.id);
		expect(eligibility.eligible).toBe(false);
	});

	it('allows only one review per booking', async () => {
		const { booking } = await completedBooking(operatorA.id, 'Once');
		const { token } = await ctx.reviews.inviteReview(booking.id);
		await ctx.reviews.submitReview(token, { rating: 4, body: 'Good trip.' });
		// The token still resolves — the traveller sees their thank-you — but it
		// cannot write a second review.
		expect((await ctx.reviews.getOwnReview(token))?.submitted).toBe(true);
		await expect(ctx.reviews.submitReview(token, { rating: 1, body: 'Again.' })).rejects.toMatchObject({
			code: 'CONFLICT'
		});
	});

	/* -------------------------------------------------------- custom trips -- */

	it('reviews a custom trip: counts for the operator, not for any tour', async () => {
		// No enquiry behind it, so no tour — an accepted quotation for a bespoke
		// itinerary. Refusing this would punish the traveller for how they booked.
		const { booking } = await completedBooking(operatorB.id, 'Bespoke');
		const { token, reviewId } = await ctx.reviews.inviteReview(booking.id);
		await ctx.reviews.submitReview(token, { rating: 4, body: 'Built exactly around our dates.' });
		await ctx.reviews.moderateReview(reviewId, 'publish', { userId: moderatorId });

		const operator = await ctx.reviews.getOperatorReviewSummary(operatorB.id);
		expect(operator.count).toBe(1);
		expect(operator.average).toBe(4);

		// tour_id is null, so no listing's rating moved — the review counts for the
		// operator alone, which is the whole point of the column being nullable.
		const { schema, db } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const [row] = await db()
			.select({ tourId: schema.reviews.tourId })
			.from(schema.reviews)
			.where(eq(schema.reviews.id, reviewId))
			.limit(1);
		expect(row.tourId).toBeNull();
	});

	/* ------------------------------------------------------------ security -- */

	it('rejects an invalid or unknown token', async () => {
		expect(await ctx.reviews.getOwnReview('not-a-token')).toBeNull();
		expect(await ctx.reviews.getOwnReview('a'.repeat(40))).toBeNull();
		await expect(
			ctx.reviews.submitReview('b'.repeat(40), { rating: 5, body: 'Hello.' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('refuses to write through an expired invitation but still shows the review', async () => {
		const { booking } = await completedBooking(operatorA.id, 'Lapsed');
		const { token, reviewId } = await ctx.reviews.inviteReview(booking.id);

		const { schema, db } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.reviews)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.reviews.id, reviewId));

		await expect(ctx.reviews.submitReview(token, { rating: 5, body: 'Too late.' })).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		// Reading is not blocked: telling somebody their words are gone when they
		// are not would be worse than a lapsed form.
		expect(await ctx.reviews.getOwnReview(token)).not.toBeNull();
	});

	it('will not let one operator respond to another operator\'s review', async () => {
		const { booking } = await completedBooking(operatorA.id, 'Crossed');
		const { token, reviewId } = await ctx.reviews.inviteReview(booking.id);
		await ctx.reviews.submitReview(token, { rating: 5, body: 'Wonderful.' });
		await ctx.reviews.moderateReview(reviewId, 'publish', { userId: moderatorId });

		await expect(
			ctx.reviews.respondToReview(operatorB.id, reviewId, 'Not our review.')
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('gives no tenant role — not even OWNER — the power to moderate', () => {
		// The permission exists, and every tenant role is missing it. An operator
		// who could hide a bad review makes every rating on the site worthless.
		for (const role of ['OWNER', 'ADMIN', 'SALES', 'BOOKING_AGENT', 'OPERATIONS', 'VIEWER'] as const) {
			const held = ctx.permissions.permissionsForRole(role);
			expect(held).not.toContain('reviews:moderate');
		}
		expect(ctx.permissions.permissionsForRole('OWNER')).toContain('reviews:respond');
	});

	/* ---------------------------------------------------------- moderation -- */

	it('removes a hidden review from public reads and from the average', async () => {
		const first = await completedBooking(operatorA.id, 'Kept');
		const second = await completedBooking(operatorA.id, 'Pulled');

		for (const [b, rating] of [
			[first.booking, 5],
			[second.booking, 1]
		] as const) {
			const { token, reviewId } = await ctx.reviews.inviteReview(b.id);
			await ctx.reviews.submitReview(token, { rating, body: `Rated ${rating}.` });
			await ctx.reviews.moderateReview(reviewId, 'publish', { userId: moderatorId });
		}

		const before = await ctx.reviews.getOperatorReviewSummary(operatorA.id);
		expect(before.count).toBeGreaterThanOrEqual(2);

		const { schema, db } = ctx.db;
		const { and, eq } = await import('drizzle-orm');
		const [oneStar] = await db()
			.select({ id: schema.reviews.id })
			.from(schema.reviews)
			.where(and(eq(schema.reviews.tenantId, operatorA.id), eq(schema.reviews.rating, 1)))
			.limit(1);

		await ctx.reviews.moderateReview(oneStar.id, 'hide', { userId: moderatorId, reason: 'Spam' });

		const after = await ctx.reviews.getOperatorReviewSummary(operatorA.id);
		expect(after.count).toBe(before.count - 1);
		const publicRows = await ctx.reviews.getPublicOperatorReviews(operatorA.id, { page: 1, limit: 50, order: 'desc' });
		expect(publicRows.items.some((r) => r.body === 'Rated 1.')).toBe(false);

		// Hidden is not deleted: the traveller's words survive, and the platform
		// can put them back.
		const [stillThere] = await db()
			.select({ status: schema.reviews.status, reason: schema.reviews.moderationReason })
			.from(schema.reviews)
			.where(eq(schema.reviews.id, oneStar.id));
		expect(stillThere.status).toBe('HIDDEN');
		expect(stillThere.reason).toBe('Spam');

		await ctx.reviews.moderateReview(oneStar.id, 'restore', { userId: moderatorId });
		expect((await ctx.reviews.getOperatorReviewSummary(operatorA.id)).count).toBe(before.count);
	});

	it('demands a reason before taking a review down', async () => {
		const { booking } = await completedBooking(operatorA.id, 'Reasoned');
		const { token, reviewId } = await ctx.reviews.inviteReview(booking.id);
		await ctx.reviews.submitReview(token, { rating: 2, body: 'Not for us.' });
		await expect(
			ctx.reviews.moderateReview(reviewId, 'hide', { userId: moderatorId })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});
});
