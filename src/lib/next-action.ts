// The ONE place that answers "what happens next?" for a transaction.
//
// Five screens used to answer this independently — the order page, the thread, the
// payments queue, the enquiry and the quotation — and they disagreed. This module
// holds the precedence once, so a customer who says they have paid is chased the same
// way whether staff are looking at the order, the chat or the payments queue.
//
// Nothing here is authorization or a state transition: it decides which EXISTING
// action to put forward. The action itself still runs through the domain service,
// which re-checks permissions, entitlements and the transition's own rules.
//
// Keep this dependency-free — it is imported by both server loads and components.

export type NextActionKey =
	| 'verify_payment'
	| 'confirm_order'
	| 'request_payment'
	| 'create_quotation'
	| 'send_quotation'
	| 'accept_quotation'
	| 'confirm_booking'
	| 'start_trip'
	| 'complete_booking'
	| 'hand_over_to_operations'
	| 'complete_trip_setup'
	| 'mark_trip_ready'
	| 'depart_trip'
	| 'complete_trip'
	| 'mark_ready'
	| 'dispatch_order'
	| 'mark_delivered'
	| 'open_booking';

export type NextAction = {
	key: NextActionKey;
	/** Business language, imperative, exactly what the button will say. */
	label: string;
	href: string;
	/** One line of why, for surfaces with room for it (success panels). */
	hint?: string;
};

/**
 * Money first, then the promise, then the work. A customer waiting to be believed
 * outranks a parcel waiting to be packed.
 */
const RANK: Record<NextActionKey, number> = {
	verify_payment: 10,
	confirm_order: 20,
	request_payment: 30,
	create_quotation: 40,
	send_quotation: 50,
	accept_quotation: 55,
	confirm_booking: 25,
	// Operations outranks the tail of the commercial flow: a trip that cannot leave
	// is more urgent than a booking waiting to be marked complete. It sits below
	// money, because a customer waiting to be believed still outranks a driver.
	hand_over_to_operations: 32,
	complete_trip_setup: 34,
	mark_trip_ready: 36,
	depart_trip: 38,
	complete_trip: 78,
	start_trip: 65,
	complete_booking: 75,
	mark_ready: 60,
	dispatch_order: 70,
	mark_delivered: 80,
	open_booking: 90
};

/** What the viewer is allowed to do — resolved by the caller from real permissions. */
export type NextActionAbility = {
	orders?: boolean;
	payments?: boolean;
	verifyPayments?: boolean;
	quotations?: boolean;
	/** May open a booking (read). */
	bookings?: boolean;
	/** May move a booking along (write). */
	bookingsWrite?: boolean;
	/** May see trips. */
	trips?: boolean;
	/** May prepare and move a trip. */
	tripsWrite?: boolean;
};

const OVER = ['CANCELLED', 'REFUNDED', 'COMPLETED', 'DELIVERED'];

export type OrderLike = {
	id: string;
	status: string;
	/** total − paid, already computed by the caller in its own currency. */
	outstanding: number;
	/** Status of the payment request currently in flight, if any. */
	activeRequestStatus?: string | null;
};

export function nextForOrder(order: OrderLike, can: NextActionAbility): NextAction | null {
	const href = `/app/orders/${order.id}`;
	if (order.activeRequestStatus === 'REPORTED') {
		return can.verifyPayments
			? {
					key: 'verify_payment',
					label: 'Verify payment',
					href: `/app/payments?verify=1`,
					hint: 'The customer says they have paid — check it actually arrived.'
				}
			: null;
	}
	if (OVER.includes(order.status)) return null;
	if (['DRAFT', 'PENDING_CONFIRMATION'].includes(order.status)) {
		return can.orders
			? { key: 'confirm_order', label: 'Confirm order', href, hint: 'Tell the customer you can fulfil it.' }
			: null;
	}
	if (order.outstanding > 0 && !order.activeRequestStatus && can.payments) {
		return { key: 'request_payment', label: 'Request payment', href, hint: 'Send them how to pay, on WhatsApp.' };
	}
	if (!can.orders) return null;
	if (['CONFIRMED', 'PROCESSING'].includes(order.status)) {
		return { key: 'mark_ready', label: 'Mark ready', href, hint: 'The order is packed and ready to go.' };
	}
	if (order.status === 'READY') return { key: 'dispatch_order', label: 'Dispatch order', href };
	if (order.status === 'DISPATCHED') return { key: 'mark_delivered', label: 'Mark delivered', href };
	return null;
}

export type BookingLike = {
	id: string;
	status: string;
	outstanding: number;
	activeRequestStatus?: string | null;
	/** Whether this sale has already been handed to operations. */
	hasTrip?: boolean;
};

export function nextForBooking(booking: BookingLike, can: NextActionAbility): NextAction | null {
	if (booking.activeRequestStatus === 'REPORTED') {
		return can.verifyPayments
			? {
					key: 'verify_payment',
					label: 'Verify payment',
					href: `/app/payments?verify=1`,
					hint: 'The traveller says they have paid — check it actually arrived.'
				}
			: null;
	}
	if (OVER.includes(booking.status)) return null;
	const href = `/app/bookings/${booking.id}`;

	// Money that has actually arrived turns a held booking into a confirmed one, so
	// confirming outranks asking again.
	if (booking.outstanding <= 0 && ['PENDING', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'].includes(booking.status)) {
		return can.bookingsWrite
			? {
					key: 'confirm_booking',
					label: 'Confirm booking',
					href,
					hint: 'Paid up — tell the traveller it is confirmed.'
				}
			: null;
	}
	if (booking.outstanding > 0 && !booking.activeRequestStatus && can.payments) {
		return { key: 'request_payment', label: 'Request payment', href, hint: 'Send them how to pay, on WhatsApp.' };
	}
	// Once trips exist, a confirmed booking's next step is the handover, not a
	// booking-level "Start trip" — that button only ever flipped a commercial
	// status, and having it sit next to a real Trip domain is the kind of
	// near-synonym that makes staff guess. Departure belongs to the trip.
	if (can.tripsWrite && !booking.hasTrip && booking.status === 'CONFIRMED') {
		return {
			key: 'hand_over_to_operations',
			label: 'Hand over to operations',
			href,
			hint: 'Sold. Now somebody has to get it out of the door.'
		};
	}
	if (!can.bookingsWrite) return null;
	if (booking.status === 'CONFIRMED') {
		// Kept for tenants not running trips at all. Where a trip exists it owns
		// departure, so the booking stops offering it.
		if (booking.hasTrip || can.tripsWrite) return null;
		return { key: 'start_trip', label: 'Start trip', href, hint: 'They are travelling — mark the trip under way.' };
	}
	if (booking.status === 'IN_PROGRESS') return { key: 'complete_booking', label: 'Complete', href };
	return null;
}

export type QuotationLike = { id: string; status: string; convertedBookingId?: string | null };

export function nextForQuotation(quotation: QuotationLike, can: NextActionAbility): NextAction | null {
	const href = `/app/quotations/${quotation.id}`;
	if (quotation.status === 'DRAFT') {
		return can.quotations
			? { key: 'send_quotation', label: 'Send quotation', href, hint: 'The traveller has not seen it yet.' }
			: null;
	}
	// Deliberately NOT "request payment": money is asked for on the booking, and the
	// quotation screen has no payment control. Pointing there would be a dead end.
	if (['SENT', 'VIEWED'].includes(quotation.status) && can.quotations) {
		return {
			key: 'accept_quotation',
			label: 'Accept & convert',
			href,
			hint: 'Traveller said yes? Turn it into a booking, then ask for the deposit.'
		};
	}
	if (quotation.status === 'CONVERTED' && quotation.convertedBookingId && can.bookings) {
		return { key: 'open_booking', label: 'Open booking', href: `/app/bookings/${quotation.convertedBookingId}` };
	}
	return null;
}

export type EnquiryLike = { id: string; status: string; hasQuotation?: boolean };

export function nextForEnquiry(enquiry: EnquiryLike, can: NextActionAbility): NextAction | null {
	if (!can.quotations) return null;
	if (enquiry.hasQuotation) return null;
	if (!['NEW', 'UNDER_REVIEW', 'CONTACTED'].includes(enquiry.status)) return null;
	return {
		key: 'create_quotation',
		label: 'Create quotation',
		href: `/app/booking-requests/${enquiry.id}`,
		hint: 'Price what they asked for and send it.'
	};
}

export type TripLike = {
	id: string;
	status: string;
	/** Critical checks still outstanding, from readinessFor(). */
	missingCritical: number;
	/** Days until departure; negative once it has passed. Null when undated. */
	daysToDeparture?: number | null;
};

/**
 * What operations should do next with a trip.
 *
 * Note what is NOT here: nothing about money. A trip with an outstanding balance
 * is the booking's problem, and pointing operations at a payment screen they
 * cannot act on is the dead end this module exists to prevent.
 */
export function nextForTrip(trip: TripLike, can: NextActionAbility): NextAction | null {
	if (['COMPLETED', 'CANCELLED'].includes(trip.status)) return null;
	const href = `/app/trips/${trip.id}`;
	if (!can.tripsWrite) return can.trips ? { key: 'complete_trip_setup', label: 'Open trip', href } : null;

	if (trip.status === 'PREPARING') {
		return trip.missingCritical > 0
			? {
					key: 'complete_trip_setup',
					label: 'Complete setup',
					href,
					hint: `${trip.missingCritical} thing${trip.missingCritical === 1 ? '' : 's'} still stopping this trip leaving.`
				}
			: { key: 'mark_trip_ready', label: 'Mark ready', href, hint: 'Everything is in place — say so.' };
	}
	if (trip.status === 'READY') {
		// Only offer departure once it is actually due. "Start trip" on a trip three
		// weeks out is an invitation to a mistake nobody can undo cleanly.
		const due = trip.daysToDeparture == null || trip.daysToDeparture <= 0;
		return due ? { key: 'depart_trip', label: 'Start trip', href, hint: 'They are on their way.' } : null;
	}
	if (trip.status === 'IN_PROGRESS') {
		return { key: 'complete_trip', label: 'Complete trip', href, hint: 'They are home — close it off.' };
	}
	return null;
}

/**
 * A confirmed booking with no trip behind it is the handover this whole domain
 * exists for, so it is asked for on the BOOKING, where the person who closed the
 * sale is already standing.
 */
export function handoverForBooking(
	booking: { id: string; status: string; hasTrip?: boolean },
	can: NextActionAbility
): NextAction | null {
	if (!can.tripsWrite) return null;
	if (booking.hasTrip) return null;
	if (!['CONFIRMED', 'PARTIALLY_PAID', 'AWAITING_PAYMENT', 'IN_PROGRESS'].includes(booking.status)) return null;
	return {
		key: 'hand_over_to_operations',
		label: 'Hand over to operations',
		href: `/app/bookings/${booking.id}`,
		hint: 'Sold. Now somebody has to get it out of the door.'
	};
}

/** Highest-priority action across everything a customer currently has open. */
export function pickNext(candidates: Array<NextAction | null | undefined>): NextAction | null {
	const real = candidates.filter((a): a is NextAction => Boolean(a));
	if (!real.length) return null;
	return real.sort((a, b) => RANK[a.key] - RANK[b.key])[0];
}
