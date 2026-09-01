import { describe, expect, it } from 'vitest';
import { nextForBooking } from '../src/lib/next-action';

/**
 * Accepting a quotation now confirms its booking, which means CONFIRMED no
 * longer implies paid. These pin the consequence: money outstanding keeps the
 * next action on the money, whatever the status column says.
 */
const can = {
	orders: true,
	payments: true,
	verifyPayments: true,
	quotations: true,
	bookings: true,
	bookingsWrite: true,
	trips: true,
	tripsWrite: true
};

const booking = (over: Partial<Parameters<typeof nextForBooking>[0]> = {}) => ({
	id: 'b1',
	status: 'CONFIRMED',
	outstanding: 0,
	activeRequestStatus: null,
	hasTrip: false,
	...over
});

describe('a confirmed booking that has not been paid', () => {
	it('is not handed to operations while money is outstanding', () => {
		// The path this guards: accept → CONFIRMED, a payment request already out,
		// balance unpaid. Before, this said "Hand over to operations".
		const next = nextForBooking(booking({ outstanding: 5900, activeRequestStatus: 'REQUESTED' }), can);
		expect(next?.key).toBe('request_payment');
		expect(next?.label).toBe('Chase payment');
	});

	it('still asks for payment the first time, before anything has been sent', () => {
		const next = nextForBooking(booking({ outstanding: 5900 }), can);
		expect(next?.key).toBe('request_payment');
		expect(next?.label).toBe('Request payment');
	});

	it('hands over once the money has actually arrived', () => {
		expect(nextForBooking(booking(), can)?.key).toBe('hand_over_to_operations');
	});

	it('lets a reported payment be verified before anything else', () => {
		const next = nextForBooking(booking({ outstanding: 5900, activeRequestStatus: 'REPORTED' }), can);
		expect(next?.key).toBe('verify_payment');
	});

	it('has nothing left to say once a trip owns it', () => {
		expect(nextForBooking(booking({ hasTrip: true }), can)).toBeNull();
	});

	it('says nothing to somebody who cannot act on the balance', () => {
		const next = nextForBooking(booking({ outstanding: 5900, activeRequestStatus: 'REQUESTED' }), {
			...can,
			payments: false
		});
		// Emphatically NOT the handover. The rule is about the balance, not about
		// who is looking — an operations person without payment rights was
		// otherwise shown "hand over" on the very booking a salesperson was being
		// told to chase.
		expect(next).toBeNull();
	});
});
