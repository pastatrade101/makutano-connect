import { describe, expect, it } from 'vitest';
import { eventsForWorkspace, NOTIFY_EVENTS } from '../src/lib/server/whatsapp/template-engine';

describe('template events follow the workspace', () => {
	it('a shop is never offered a trip reminder', () => {
		const orders = eventsForWorkspace('ORDERS');
		expect(orders).not.toContain('TRIP_REMINDER');
		expect(orders).not.toContain('BOOKING_CONFIRMED');
		expect(orders).toContain('ORDER_DISPATCHED');
		expect(orders).toContain('PAYMENT_REQUESTED'); // money is universal
	});

	it('a tour operator is never offered order events', () => {
		const bookings = eventsForWorkspace('BOOKINGS');
		expect(bookings).not.toContain('ORDER_DISPATCHED');
		expect(bookings).toContain('BOOKING_CONFIRMED');
		expect(bookings).toContain('QUOTATION_READY');
	});

	it('a service business gets neither orders nor bookings', () => {
		const service = eventsForWorkspace('SERVICE');
		expect(service).not.toContain('ORDER_RECEIVED');
		expect(service).not.toContain('TRIP_REMINDER');
		expect(service).toContain('QUOTATION_READY');
		expect(service).toContain('PAYMENT_RECEIVED');
	});

	it('keeps an event that is already mapped, so it can still be cleared', () => {
		// A tenant that moved ORDERS → SERVICE must not be left with a live mapping
		// the dropdown refuses to show.
		const service = eventsForWorkspace('SERVICE', ['ORDER_DISPATCHED']);
		expect(service).toContain('ORDER_DISPATCHED');
		expect(service).not.toContain('ORDER_READY');
	});

	it('hybrid still sees everything', () => {
		// Derived, not a literal: a hard-coded count means every new event fails a
		// test that has nothing to say about it, and the failure teaches nobody
		// anything except which number to retype.
		expect(eventsForWorkspace('HYBRID')).toHaveLength(NOTIFY_EVENTS.length);
	});
});
