import { describe, expect, it } from 'vitest';
import { MODERATION_REASONS } from '../src/lib/server/reviews';

/**
 * The rules that make a Makutano review worth reading.
 *
 * The DB-backed suite exercises the service against Postgres; these pin the
 * pure decisions — who may review, what the public may see, and how a name and
 * a travel date are made safe to print. Each one is a rule somebody could
 * "simplify" later without noticing what it protected.
 */

/* The eligibility gate, extracted so it can be reasoned about directly. It
   mirrors checkReviewEligibility: cancelled or refunded is never reviewable,
   and either lifecycle reaching COMPLETED is enough. */
const DEAD = ['CANCELLED', 'REFUNDED'];
const reviewable = (bookingStatus: string, tripStatus: string | null, alreadyReviewed = false) => {
	if (alreadyReviewed) return false;
	if (DEAD.includes(bookingStatus)) return false;
	return bookingStatus === 'COMPLETED' || tripStatus === 'COMPLETED';
};

const displayName = (first: string | null, last: string | null): string => {
	const given = (first ?? '').trim();
	const family = (last ?? '').trim();
	if (given && family) return `${given} ${family[0].toUpperCase()}.`;
	if (given) return given;
	if (family) return family;
	return 'A traveller';
};

const average = (ratings: number[]) =>
	ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

describe('who may review', () => {
	it('lets a traveller review a completed booking', () => {
		expect(reviewable('COMPLETED', null)).toBe(true);
	});

	it('lets them review when operations completed the TRIP but the booking lags', () => {
		// Nothing in this system moves a booking to COMPLETED automatically — it is
		// a human click. Gating on the booking alone would leave real travellers
		// unable to review a trip they finished last week.
		expect(reviewable('CONFIRMED', 'COMPLETED')).toBe(true);
		expect(reviewable('IN_PROGRESS', 'COMPLETED')).toBe(true);
	});

	it('refuses a trip that has not happened', () => {
		expect(reviewable('CONFIRMED', null)).toBe(false);
		expect(reviewable('AWAITING_PAYMENT', null)).toBe(false);
		expect(reviewable('IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
	});

	it('refuses a cancelled or refunded booking whatever the trip row says', () => {
		expect(reviewable('CANCELLED', 'COMPLETED')).toBe(false);
		// A refund after the trip revokes the review: COMPLETED -> REFUNDED is a
		// legal booking transition, so this is reachable in practice.
		expect(reviewable('REFUNDED', 'COMPLETED')).toBe(false);
	});

	it('refuses a second review of the same booking', () => {
		expect(reviewable('COMPLETED', 'COMPLETED', true)).toBe(false);
	});
});

describe('what the public sees', () => {
	it('shows a first name and an initial, never a full identity', () => {
		expect(displayName('Pastory', 'Joseph')).toBe('Pastory J.');
		// The initial is capitalised even when the name was typed in lower case —
		// "josee m." reads as a typo on a public page.
		expect(displayName('josee', 'mushi')).toBe('josee M.');
	});

	it('degrades safely when a name is missing', () => {
		expect(displayName('Pastory', null)).toBe('Pastory');
		expect(displayName(null, 'Joseph')).toBe('Joseph');
		// Not an empty quotation mark against a review somebody wrote.
		expect(displayName(null, null)).toBe('A traveller');
		expect(displayName('  ', '')).toBe('A traveller');
	});
});

describe('rating arithmetic', () => {
	it('averages to one decimal', () => {
		expect(average([5, 5, 4])).toBe(4.7);
		expect(average([5])).toBe(5);
		expect(average([4, 5])).toBe(4.5);
	});

	it('has no rating at all rather than a zero', () => {
		// A tour nobody has reviewed shows "no reviews yet", never "0.0".
		expect(average([])).toBeNull();
	});
});

describe('moderation', () => {
	it('offers reasons rather than free text alone', () => {
		expect(MODERATION_REASONS).toContain('Spam');
		expect(MODERATION_REASONS).toContain('Personal information');
		expect(MODERATION_REASONS.length).toBeGreaterThan(3);
	});
});
