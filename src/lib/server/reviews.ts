// Traveller reviews. Platform trust data, not a testimonial feature.
//
// Three parties, three different rights, and this file is where that boundary
// is enforced rather than assumed by a UI:
//
//   the traveller owns the rating, title and body
//   the operator owns the response, and nothing else
//   the platform owns publication
//
// The booking is the source of truth throughout. Nothing here ever takes a
// customerId, tenantId or tourId from a caller: every one of them is resolved
// FROM the booking, because a review whose subject the browser chose is worth
// nothing. That is also why there is no `isVerified` column — a review is
// verified because `bookingId` is NOT NULL and the row could not have been
// written without passing the eligibility check below.
import { and, asc, desc, eq, inArray, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from './db';
import { sha256 } from './encryption';
import { AppError } from './errors';
import { audit } from './audit';
import { reviewInviteEmail, sendEmail } from './email';
import { env } from './env';
import { emit } from './events';
import type { Pagination } from './http';

/* ---------------------------------------------------------- eligibility ---- */

export type ReviewEligibility =
	| { eligible: true; booking: schema.Booking; tourId: string | null; customerId: string }
	| { eligible: false; reason: string; existingReviewId?: string };

/**
 * Statuses that end a booking's commercial life without the trip happening.
 * Nobody reviews a trip they did not take.
 */
const DEAD = ['CANCELLED', 'REFUNDED'] as const;

/**
 * Is this booking reviewable, and by whom?
 *
 * Two lifecycles exist in this system and neither drives the other: a booking
 * reaches COMPLETED through changeBookingStatus, and a trip reaches COMPLETED
 * through its own transition. Operations regularly closes a trip while the
 * commercial status lags, so gating on the booking alone would leave real
 * travellers unable to review a trip they finished last week. Either counts —
 * and a cancelled or refunded booking counts for nothing, whatever a stale trip
 * row says.
 *
 * This is not a third lifecycle. It reads the two that already exist.
 */
export async function checkReviewEligibility(bookingId: string): Promise<ReviewEligibility> {
	const [booking] = await db()
		.select()
		.from(schema.bookings)
		.where(and(eq(schema.bookings.id, bookingId), isNull(schema.bookings.deletedAt)))
		.limit(1);
	if (!booking) return { eligible: false, reason: 'That booking could not be found.' };

	if ((DEAD as readonly string[]).includes(booking.status)) {
		return { eligible: false, reason: 'This booking was cancelled, so there is no trip to review.' };
	}
	if (!booking.customerId) {
		return { eligible: false, reason: 'This booking has no traveller attached.' };
	}

	if (booking.status !== 'COMPLETED') {
		const [trip] = await db()
			.select({ id: schema.trips.id })
			.from(schema.trips)
			.where(
				and(
					eq(schema.trips.bookingId, booking.id),
					eq(schema.trips.tenantId, booking.tenantId),
					eq(schema.trips.status, 'COMPLETED')
				)
			)
			.limit(1);
		if (!trip) {
			return { eligible: false, reason: 'This trip has not finished yet.' };
		}
	}

	const [existing] = await db()
		.select({ id: schema.reviews.id })
		.from(schema.reviews)
		.where(eq(schema.reviews.bookingId, booking.id))
		.limit(1);
	if (existing) {
		return { eligible: false, reason: 'This trip has already been reviewed.', existingReviewId: existing.id };
	}

	return {
		eligible: true,
		booking,
		customerId: booking.customerId,
		tourId: await tourForBooking(booking)
	};
}

/**
 * The tour a booking was for, if any.
 *
 * A booking has no tour column: it reaches one through the enquiry it came
 * from. An accepted quotation for a custom trip has no enquiry and no tour, and
 * that review is still valid — it simply counts towards the operator rather
 * than towards a listing.
 */
async function tourForBooking(booking: schema.Booking): Promise<string | null> {
	if (!booking.bookingRequestId) return null;
	const [row] = await db()
		.select({ tourId: schema.bookingRequests.tourId })
		.from(schema.bookingRequests)
		.where(
			and(
				eq(schema.bookingRequests.id, booking.bookingRequestId),
				eq(schema.bookingRequests.tenantId, booking.tenantId)
			)
		)
		.limit(1);
	return row?.tourId ?? null;
}

/* -------------------------------------------------------------- inviting ---- */

/**
 * Unguessable, and the only credential a traveller has — there is no login.
 *
 * 40 hex characters of crypto randomness. Only its sha256 reaches the database:
 * the raw value lives in the email and nowhere else, so read access to the
 * table does not let anyone review as somebody else.
 */
const mintToken = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);

/** How long an invitation can be acted on. Reading it never expires. */
const INVITE_DAYS = 180;

/**
 * Open a review for a finished trip and return the traveller's private link.
 *
 * Creates the row in PENDING with no rating yet: the invite IS the row, so a
 * second invite for the same booking returns the same token rather than a
 * second review. `reviews_booking_key` would refuse the duplicate anyway; this
 * makes the answer useful instead of an error.
 */
export async function inviteReview(
	bookingId: string,
	actor: { userId?: string | null } = {}
): Promise<{ token: string; reviewId: string }> {
	// A hash cannot be turned back into a link, so a second invitation for a
	// booking that already has one issues a FRESH token against the same review
	// rather than resurrecting the old one. The unique booking_id still means one
	// review; only the way in is reissued.
	const [open] = await db()
		.select({ id: schema.reviews.id, body: schema.reviews.body })
		.from(schema.reviews)
		.where(eq(schema.reviews.bookingId, bookingId))
		.limit(1);
	if (open?.body) throw new AppError('CONFLICT', 'This trip has already been reviewed.');
	if (open) {
		const token = mintToken();
		await db()
			.update(schema.reviews)
			.set({ inviteTokenHash: sha256(token), invitedAt: new Date(), expiresAt: inviteExpiry(), updatedAt: new Date() })
			.where(eq(schema.reviews.id, open.id));
		return { token, reviewId: open.id };
	}

	const eligibility = await checkReviewEligibility(bookingId);
	if (!eligibility.eligible) throw new AppError('CONFLICT', eligibility.reason);

	const token = mintToken();
	const [row] = await db()
		.insert(schema.reviews)
		.values({
			bookingId,
			tenantId: eligibility.booking.tenantId,
			customerId: eligibility.customerId,
			tourId: eligibility.tourId,
			// Placeholders until the traveller writes: the row exists so the token
			// can, and `submitted_at` is corrected on submission.
			rating: 5,
			body: '',
			status: 'PENDING',
			inviteTokenHash: sha256(token),
			invitedAt: new Date(),
			expiresAt: inviteExpiry()
		})
		.returning({ id: schema.reviews.id });

	await audit(
		eligibility.booking.tenantId,
		'review.invited',
		{ type: 'user', userId: actor.userId ?? null },
		{ type: 'booking', id: bookingId },
		{ reviewId: row.id }
	);
	return { token, reviewId: row.id };
}

/**
 * Invite, and send the traveller their link.
 *
 * Split from [inviteReview] so the completion workflow can call one function
 * without this module having to know when a booking or a trip finished — the
 * review system stays OUT of those state machines, and they call in. Sending
 * uses the existing provider and the same traveller-facing wrapper the
 * quotation email uses; there is no second mail path.
 *
 * Delivery is reported, never assumed: an invitation that was created but not
 * delivered is a different outcome from one the traveller has.
 */
export async function inviteAndNotify(
	bookingId: string,
	actor: { userId?: string | null } = {}
): Promise<{ token: string; reviewId: string; delivered: boolean; reason?: string }> {
	const { token, reviewId } = await inviteReview(bookingId, actor);

	const [context] = await db()
		.select({
			tenantId: schema.reviews.tenantId,
			email: schema.customers.email,
			firstName: schema.customers.firstName,
			tourTitle: schema.tours.title,
			startDate: schema.bookings.startDate,
			operatorName: schema.operatorProfiles.displayName,
			operatorLocation: schema.operatorProfiles.location,
			operatorVerified: schema.operatorProfiles.isVerified,
			tenantName: schema.tenants.name
		})
		.from(schema.reviews)
		.innerJoin(schema.bookings, eq(schema.bookings.id, schema.reviews.bookingId))
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.reviews.tenantId))
		.leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
		.leftJoin(schema.tours, eq(schema.tours.id, schema.reviews.tourId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.reviews.tenantId))
		.where(eq(schema.reviews.id, reviewId))
		.limit(1);

	if (!context?.email) {
		return { token, reviewId, delivered: false, reason: 'That traveller has no email address on file.' };
	}

	const marketplace = env().MARKETPLACE_URL.replace(/\/+$/, '');
	const message = reviewInviteEmail({
		operator: {
			name: context.operatorName ?? context.tenantName,
			location: context.operatorLocation,
			verified: context.operatorVerified ?? false
		},
		customerFirstName: context.firstName,
		tourTitle: context.tourTitle,
		travelledOn: travelMonth(context.startDate),
		url: `${marketplace}/review/${token}`
	});
	const result = await sendEmail({ ...message, to: context.email });
	return { token, reviewId, delivered: result.delivered, reason: result.reason };
}

/* ------------------------------------------------------------ submission ---- */

const RATINGS = [1, 2, 3, 4, 5];
const MAX_TITLE = 120;
const MAX_BODY = 4000;

/** What the traveller's own page is allowed to see about their review. */
export type OwnReview = {
	id: string;
	rating: number | null;
    title: string | null;
	body: string;
	status: schema.Review['status'];
	submitted: boolean;
	edited: boolean;
	/** False once the invitation has lapsed. Reading still works. */
	writable: boolean;
	tourTitle: string | null;
	operatorName: string | null;
	travelledOn: Date | null;
};

const inviteExpiry = () => new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);

/**
 * Resolve a traveller by their token. The token IS the identity.
 *
 * Looked up by hash, so a token is never compared in the clear and the shape
 * check runs before the query — a malformed value never reaches the database.
 */
async function reviewByToken(token: string) {
	if (!/^[a-f0-9]{20,80}$/.test(token)) return null;
	const [row] = await db()
		.select()
		.from(schema.reviews)
		.where(eq(schema.reviews.inviteTokenHash, sha256(token)))
		.limit(1);
	return row ?? null;
}

/**
 * Expiry gates WRITES only.
 *
 * A traveller opening a lapsed link still sees their own review and the
 * thank-you; they simply cannot write. Erroring on read would tell somebody
 * their words are gone when they are not.
 */
function assertWritable(review: schema.Review) {
	if (review.expiresAt && review.expiresAt.getTime() < Date.now()) {
		throw new AppError('CONFLICT', 'This review link has expired. Ask the operator for a new one.');
	}
}

export async function getOwnReview(token: string): Promise<OwnReview | null> {
	const review = await reviewByToken(token);
	if (!review) return null;

	const [context] = await db()
		.select({
			tourTitle: schema.tours.title,
			operatorName: schema.operatorProfiles.displayName,
			startDate: schema.bookings.startDate
		})
		.from(schema.reviews)
		.innerJoin(schema.bookings, eq(schema.bookings.id, schema.reviews.bookingId))
		.leftJoin(schema.tours, eq(schema.tours.id, schema.reviews.tourId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.reviews.tenantId))
		.where(eq(schema.reviews.id, review.id))
		.limit(1);

	return {
		id: review.id,
		// An un-submitted invite has no rating yet; the placeholder must not be
		// shown back as though they chose five stars.
		rating: review.body ? review.rating : null,
		title: review.title,
		body: review.body,
		status: review.status,
		submitted: Boolean(review.body),
		edited: Boolean(review.editedAt),
		// Surfaced so the page can say "you can no longer change this" rather than
		// showing a form that will be refused on submit.
		writable: !review.expiresAt || review.expiresAt.getTime() >= Date.now(),
		tourTitle: context?.tourTitle ?? null,
		operatorName: context?.operatorName ?? null,
		travelledOn: context?.startDate ?? null
	};
}

function assertReviewText(rating: number, body: string, title?: string | null) {
	if (!RATINGS.includes(rating)) throw new AppError('VALIDATION_ERROR', 'Choose a rating from one to five stars.');
	const text = body.trim();
	if (!text) throw new AppError('VALIDATION_ERROR', 'Tell us a little about the trip.');
	if (text.length > MAX_BODY) throw new AppError('VALIDATION_ERROR', 'That review is too long.');
	if (title && title.trim().length > MAX_TITLE) throw new AppError('VALIDATION_ERROR', 'That title is too long.');
}

export async function submitReview(
	token: string,
	input: { rating: number; title?: string | null; body: string }
): Promise<schema.Review> {
	const review = await reviewByToken(token);
	if (!review) throw new AppError('NOT_FOUND', 'That review link is not valid.');
	if (review.body) throw new AppError('CONFLICT', 'This trip has already been reviewed.');
	assertWritable(review);
	assertReviewText(input.rating, input.body, input.title);

	// Re-checked at submission, not only at invite: a booking can be cancelled or
	// refunded between the two, and the link would otherwise still work.
	const eligibility = await checkReviewEligibility(review.bookingId);
	if (!eligibility.eligible && !eligibility.existingReviewId) {
		throw new AppError('CONFLICT', eligibility.reason);
	}

	const [row] = await db()
		.update(schema.reviews)
		.set({
			rating: input.rating,
			title: input.title?.trim() || null,
			body: input.body.trim(),
			status: 'PENDING',
			submittedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(schema.reviews.id, review.id))
		.returning();

	await emit(review.tenantId, 'review.submitted', { id: row.id, rating: row.rating, tourId: row.tourId });
	return row;
}

/**
 * A traveller correcting their own review.
 *
 * Editing returns it to PENDING when it had already been published: the words
 * on a public page must be words the platform has seen. `editedAt` is set and
 * never cleared — a review that changed says so.
 */
export async function updateCustomerReview(
	token: string,
	input: { rating: number; title?: string | null; body: string }
): Promise<schema.Review> {
	const review = await reviewByToken(token);
	if (!review) throw new AppError('NOT_FOUND', 'That review link is not valid.');
	if (!review.body) throw new AppError('CONFLICT', 'There is nothing to edit yet.');
	if (review.status === 'REJECTED') throw new AppError('CONFLICT', 'This review cannot be edited.');
	assertWritable(review);
	assertReviewText(input.rating, input.body, input.title);

	const [row] = await db()
		.update(schema.reviews)
		.set({
			rating: input.rating,
			title: input.title?.trim() || null,
			body: input.body.trim(),
			status: 'PENDING',
			publishedAt: null,
			editedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(schema.reviews.id, review.id))
		.returning();
	return row;
}

/* -------------------------------------------------------------- operator ---- */

const MAX_RESPONSE = 2000;

/**
 * The operator's answer. Their ONLY write.
 *
 * Scoped by tenantId from the authenticated server context — never from the
 * request — so a tenant cannot reach another tenant's review by guessing an id.
 * Only a published review can be answered: replying to something the public
 * cannot see is a conversation with nobody.
 */
export async function respondToReview(
	tenantId: string,
	reviewId: string,
	response: string,
	actor: { userId?: string | null } = {}
): Promise<schema.Review> {
	const text = response.trim();
	if (!text) throw new AppError('VALIDATION_ERROR', 'Write a response first.');
	if (text.length > MAX_RESPONSE) throw new AppError('VALIDATION_ERROR', 'That response is too long.');

	const [row] = await db()
		.update(schema.reviews)
		.set({ operatorResponse: text, operatorRespondedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(schema.reviews.id, reviewId),
				eq(schema.reviews.tenantId, tenantId),
				eq(schema.reviews.status, 'PUBLISHED')
			)
		)
		.returning();
	if (!row) throw new AppError('NOT_FOUND', 'That review could not be found.');

	await audit(
		tenantId,
		'review.responded',
		{ type: 'user', userId: actor.userId ?? null },
		{ type: 'review', id: reviewId },
		{ length: text.length }
	);
	return row;
}

/* ------------------------------------------------------------ moderation ---- */

export const MODERATION_REASONS = [
	'Spam',
	'Abusive content',
	'Personal information',
	'Fraud or suspicious activity',
	'Off topic',
	'Duplicate',
	'Other'
] as const;

export type ModerationAction = 'publish' | 'hide' | 'reject' | 'restore';

/**
 * The platform's decision. Guarded by `reviews:moderate`, which no tenant role
 * can hold — see PLATFORM_ONLY in auth/permissions.ts.
 *
 * Nothing here deletes. A hidden review keeps its words and its history; the
 * traveller wrote them, and tidying a page is not a reason to destroy them.
 */
export async function moderateReview(
	reviewId: string,
	action: ModerationAction,
	actor: { userId: string; reason?: string | null }
): Promise<schema.Review> {
	const [review] = await db().select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).limit(1);
	if (!review) throw new AppError('NOT_FOUND', 'That review could not be found.');
	if (!review.body) throw new AppError('CONFLICT', 'That review has not been written yet.');

	const now = new Date();
	const status: schema.Review['status'] =
		action === 'publish' || action === 'restore' ? 'PUBLISHED' : action === 'hide' ? 'HIDDEN' : 'REJECTED';

	if ((action === 'hide' || action === 'reject') && !actor.reason?.trim()) {
		throw new AppError('VALIDATION_ERROR', 'Say why. A review taken down without a reason cannot be reviewed later.');
	}

	const [row] = await db()
		.update(schema.reviews)
		.set({
			status,
			publishedAt: status === 'PUBLISHED' ? (review.publishedAt ?? now) : review.publishedAt,
			moderatedAt: now,
			moderatedBy: actor.userId,
			moderationReason: status === 'PUBLISHED' ? null : (actor.reason?.trim() ?? null),
			updatedAt: now
		})
		.where(eq(schema.reviews.id, reviewId))
		.returning();

	await audit(
		review.tenantId,
		`review.${action}` as never,
		{ type: 'user', userId: actor.userId },
		{ type: 'review', id: reviewId },
		{ from: review.status, to: status, reason: actor.reason ?? null }
	);
	if (status === 'PUBLISHED') {
		await emit(review.tenantId, 'review.published', { id: row.id, rating: row.rating, tourId: row.tourId });
	}
	return row;
}

/* ----------------------------------------------------------------- reads ---- */

/** What the public may see. Never the token, the booking, or the customer's identity. */
export type PublicReview = {
	id: string;
	rating: number;
	title: string | null;
	body: string;
	/** "Pastory J." — never a full name, never contact details. */
	author: string;
	travelledOn: string | null;
	publishedAt: Date | null;
	edited: boolean;
	tour: { slug: string; title: string } | null;
	operatorResponse: string | null;
	operatorRespondedAt: Date | null;
	operatorName: string | null;
};

/**
 * A privacy-safe display name.
 *
 * First name and a surname initial, which is the convention this marketplace
 * uses on a public page. A customer with one name keeps it; a customer with
 * none becomes "A traveller" rather than an empty quotation mark.
 */
function displayName(first: string | null, last: string | null): string {
	const given = (first ?? '').trim();
	const family = (last ?? '').trim();
	if (given && family) return `${given} ${family[0].toUpperCase()}.`;
	if (given) return given;
	if (family) return family;
	return 'A traveller';
}

/** "August 2026" — the month, never the exact date the trip ran. */
function travelMonth(date: Date | null): string | null {
	if (!date) return null;
	return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const publicSelect = {
	id: schema.reviews.id,
	rating: schema.reviews.rating,
	title: schema.reviews.title,
	body: schema.reviews.body,
	publishedAt: schema.reviews.publishedAt,
	editedAt: schema.reviews.editedAt,
	operatorResponse: schema.reviews.operatorResponse,
	operatorRespondedAt: schema.reviews.operatorRespondedAt,
	firstName: schema.customers.firstName,
	lastName: schema.customers.lastName,
	startDate: schema.bookings.startDate,
	tourSlug: schema.tours.slug,
	tourTitle: schema.tours.title,
	operatorName: schema.operatorProfiles.displayName
};

type PublicRow = {
	id: string;
	rating: number;
	title: string | null;
	body: string;
	publishedAt: Date | null;
	editedAt: Date | null;
	operatorResponse: string | null;
	operatorRespondedAt: Date | null;
	firstName: string | null;
	lastName: string | null;
	startDate: Date | null;
	tourSlug: string | null;
	tourTitle: string | null;
	operatorName: string | null;
};

const toPublic = (r: PublicRow): PublicReview => ({
	id: r.id,
	rating: r.rating,
	title: r.title,
	body: r.body,
	author: displayName(r.firstName, r.lastName),
	travelledOn: travelMonth(r.startDate),
	publishedAt: r.publishedAt,
	edited: Boolean(r.editedAt),
	tour: r.tourSlug && r.tourTitle ? { slug: r.tourSlug, title: r.tourTitle } : null,
	operatorResponse: r.operatorResponse,
	operatorRespondedAt: r.operatorRespondedAt,
	operatorName: r.operatorName
});

const publicQuery = () =>
	db()
		.select(publicSelect)
		.from(schema.reviews)
		.innerJoin(schema.bookings, eq(schema.bookings.id, schema.reviews.bookingId))
		.leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
		.leftJoin(schema.tours, eq(schema.tours.id, schema.reviews.tourId))
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.reviews.tenantId));

/** PUBLISHED only, everywhere. Pending, hidden and rejected never leave the server. */
const published = () => eq(schema.reviews.status, 'PUBLISHED');

export type ReviewSummary = { average: number | null; count: number; distribution: Record<number, number> };

/**
 * An average computed from published rows at read time.
 *
 * Deliberately not a cached counter on tours or operator_profiles: a stored
 * average is wrong from the moment a review is hidden, and "recompute it
 * somewhere" is the bug nobody notices. One indexed aggregate is cheap, and the
 * partial index makes it read only the published rows.
 */
async function summaryWhere(where: ReturnType<typeof and>): Promise<ReviewSummary> {
	const rows = await db()
		.select({ rating: schema.reviews.rating, value: sql<number>`count(*)::int` })
		.from(schema.reviews)
		.where(where)
		.groupBy(schema.reviews.rating);

	const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	let total = 0;
	let sum = 0;
	for (const row of rows) {
		distribution[row.rating] = Number(row.value);
		total += Number(row.value);
		sum += row.rating * Number(row.value);
	}
	return { average: total ? Math.round((sum / total) * 10) / 10 : null, count: total, distribution };
}

export const getTourReviewSummary = (tourId: string) =>
	summaryWhere(and(published(), eq(schema.reviews.tourId, tourId)));

export const getOperatorReviewSummary = (tenantId: string) =>
	summaryWhere(and(published(), eq(schema.reviews.tenantId, tenantId)));

/** Summaries for many tours at once, for a listing page. */
export async function tourReviewSummaries(tourIds: string[]): Promise<Map<string, ReviewSummary>> {
	if (!tourIds.length) return new Map();
	const rows = await db()
		.select({
			tourId: schema.reviews.tourId,
			value: sql<number>`count(*)::int`,
			sum: sql<number>`sum(${schema.reviews.rating})::int`
		})
		.from(schema.reviews)
		.where(and(published(), inArray(schema.reviews.tourId, tourIds)))
		.groupBy(schema.reviews.tourId);

	const out = new Map<string, ReviewSummary>();
	for (const row of rows) {
		if (!row.tourId) continue;
		const count = Number(row.value);
		out.set(row.tourId, {
			average: count ? Math.round((Number(row.sum) / count) * 10) / 10 : null,
			count,
			distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
		});
	}
	return out;
}

export async function getPublicTourReviews(
	tourId: string,
	p: Pagination
): Promise<{ items: PublicReview[]; total: number; summary: ReviewSummary }> {
	const where = and(published(), eq(schema.reviews.tourId, tourId));
	const [rows, summary] = await Promise.all([
		publicQuery()
			.where(where)
			.orderBy(desc(schema.reviews.publishedAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		summaryWhere(where)
	]);
	return { items: rows.map(toPublic), total: summary.count, summary };
}

export async function getPublicOperatorReviews(
	tenantId: string,
	p: Pagination
): Promise<{ items: PublicReview[]; total: number; summary: ReviewSummary }> {
	const where = and(published(), eq(schema.reviews.tenantId, tenantId));
	const [rows, summary] = await Promise.all([
		publicQuery()
			.where(where)
			.orderBy(desc(schema.reviews.publishedAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		summaryWhere(where)
	]);
	return { items: rows.map(toPublic), total: summary.count, summary };
}

/* ------------------------------------------------------------- back office -- */

/** The operator's own list. Written reviews only — an unopened invite is not one. */
export async function listTenantReviews(
	tenantId: string,
	p: Pagination,
	filters: { status?: schema.Review['status']; awaitingResponse?: boolean } = {}
) {
	const conditions = [eq(schema.reviews.tenantId, tenantId), ne(schema.reviews.body, '')];
	if (filters.status) conditions.push(eq(schema.reviews.status, filters.status));
	if (filters.awaitingResponse) {
		conditions.push(published());
		conditions.push(isNull(schema.reviews.operatorResponse));
	}
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({
				...publicSelect,
				status: schema.reviews.status,
				submittedAt: schema.reviews.submittedAt,
				bookingReference: schema.bookings.bookingReference
			})
			.from(schema.reviews)
			.innerJoin(schema.bookings, eq(schema.bookings.id, schema.reviews.bookingId))
			.leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
			.leftJoin(schema.tours, eq(schema.tours.id, schema.reviews.tourId))
			.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.reviews.tenantId))
			.where(where)
			.orderBy(desc(schema.reviews.submittedAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: sql<number>`count(*)::int` }).from(schema.reviews).where(where)
	]);
	return { items, total: Number(total) };
}

/** The platform's moderation queue, across every tenant. */
export async function listReviewsForModeration(
	p: Pagination,
	filters: { status?: schema.Review['status'] } = {}
) {
	const conditions = [ne(schema.reviews.body, '')];
	if (filters.status) conditions.push(eq(schema.reviews.status, filters.status));
	const where = and(...conditions);

	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({
				id: schema.reviews.id,
				rating: schema.reviews.rating,
				title: schema.reviews.title,
				body: schema.reviews.body,
				status: schema.reviews.status,
				submittedAt: schema.reviews.submittedAt,
				editedAt: schema.reviews.editedAt,
				moderationReason: schema.reviews.moderationReason,
				operatorResponse: schema.reviews.operatorResponse,
				bookingReference: schema.bookings.bookingReference,
				customerFirst: schema.customers.firstName,
				customerLast: schema.customers.lastName,
				tourTitle: schema.tours.title,
				operatorName: schema.operatorProfiles.displayName,
				tenantName: schema.tenants.name
			})
			.from(schema.reviews)
			.innerJoin(schema.bookings, eq(schema.bookings.id, schema.reviews.bookingId))
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.reviews.tenantId))
			.leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
			.leftJoin(schema.tours, eq(schema.tours.id, schema.reviews.tourId))
			.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.reviews.tenantId))
			.where(where)
			.orderBy(asc(schema.reviews.submittedAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: sql<number>`count(*)::int` }).from(schema.reviews).where(where)
	]);
	return { items, total: Number(total) };
}

/** How many written reviews are waiting on the platform, for the admin badge. */
export async function pendingReviewCount(): Promise<number> {
	const [row] = await db()
		.select({ value: sql<number>`count(*)::int` })
		.from(schema.reviews)
		.where(and(eq(schema.reviews.status, 'PENDING'), ne(schema.reviews.body, ''), isNotNull(schema.reviews.body)));
	return Number(row?.value ?? 0);
}
