import { describe, expect, it } from 'vitest';
import { eventsForWorkspace } from '../src/lib/server/whatsapp/template-engine';

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

	it('hybrid still sees everything', () => {
		expect(eventsForWorkspace('HYBRID')).toHaveLength(16);
	});
});
