import { error, fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { changeBookingStatus, getBooking, getBookingDetail } from '$lib/server/bookings';
import { createPayment } from '$lib/server/payments';
import { createTripFromBooking } from '$lib/server/trips';
import { db, schema } from '$lib/server/db';
import { and, eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { handoverForBooking } from '$lib/next-action';
import {
	createPaymentRequest,
	isUsablePaymentMethod,
	methodInstructions,
	paymentMethods,
	paymentRequestTemplateReady,
	remindPaymentRequest,
	requestsForTransaction
} from '$lib/server/payment-requests';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'booking id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'bookings:read');
	try {
		const tenant = requireTenant(locals);
		const detail = await getBookingDetail(tenant.id, idOf(params));
		const [methods, paymentRequestRows, requestTemplateReady] = await Promise.all([
			Promise.resolve(
				paymentMethods(tenant.settings as Record<string, unknown>)
					.filter(isUsablePaymentMethod)
					.map((method) => ({ ...method, summary: methodInstructions(method) }))
			),
			requestsForTransaction(tenant.id, { bookingId: idOf(params) }),
			paymentRequestTemplateReady(tenant.id)
		]);
		// §15: passport fields carry stricter access controls than the rest of a booking.
		const canSeeSensitive = locals.permissions.includes('travelers:read_sensitive');
		const [trip] = locals.permissions.includes('trips:read')
			? await db()
					.select()
					.from(schema.trips)
					.where(and(eq(schema.trips.tenantId, tenant.id), eq(schema.trips.bookingId, idOf(params))))
					.limit(1)
			: [];
		return {
			...detail,
			payMethods: methods,
			requestTemplateReady,
			paymentRequests: paymentRequestRows,
			travelers: detail.travelers.map((t) =>
				canSeeSensitive ? t : { ...t, passportNumber: null, passportExpiry: null }
			),
			canSeeSensitive,
			// The operational half, if it has been handed over. A booking that already
			// has a trip links to it; one that does not offers the handover.
			trip: trip ?? null,
			handover: handoverForBooking(
				{ id: detail.booking.id, status: detail.booking.status, hasTrip: Boolean(trip) },
				{ tripsWrite: locals.permissions.includes('trips:write') }
			)
		};
	} catch {
		error(404, 'Booking not found');
	}
};

export const actions: Actions = {
	/**
	 * Hand the sale over to operations.
	 *
	 * This is where the commercial record stops and the operational one starts. It
	 * is offered on the BOOKING because that is where the person who closed the
	 * sale is already standing — making them navigate to a Trips screen to create
	 * the thing they just sold is the friction this whole domain exists to remove.
	 */
	handOver: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'trips:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const operationsUserId = String(data.get('operationsUserId') ?? '').trim() || null;
		try {
			const trip = await createTripFromBooking(tenantId, idOf(params), { operationsUserId }, { userId: locals.user?.id });
			await audit(
				tenantId,
				'trip.created',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'trip', id: trip.id },
				{ after: { bookingId: idOf(params), operationsUserId } }
			);
			return { success: true, tripId: trip.id };
		} catch (error) {
			return fail(400, { error: toAppError(error).message });
		}
	},

	/** The confirm-step "Request payment": creates the request (which messages the
	 *  customer with instructions) and moves the booking to AWAITING_PAYMENT. */
	requestPayment: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'payments:request');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		try {
			const bookingId = idOf(params);
			const {
				request: pr,
				reused,
				notificationQueued
			} = await createPaymentRequest(tenantId, {
				bookingId,
				amount: String(data.get('amount') ?? '') || undefined,
				methodKey: String(data.get('methodKey') ?? '') || null,
				note: String(data.get('note') ?? '') || null,
				requestedByUserId: locals.user!.id
			});
			// The booking follows its own rules; already-awaiting is fine.
			const booking = await getBooking(tenantId, bookingId);
			if (booking.status === 'DRAFT' || booking.status === 'PENDING') {
				if (booking.status === 'DRAFT') {
					await changeBookingStatus(tenantId, bookingId, 'PENDING', { userId: locals.user!.id });
				}
				await changeBookingStatus(
					tenantId,
					bookingId,
					'AWAITING_PAYMENT',
					{ userId: locals.user!.id },
					'Payment requested'
				);
			}
			return {
				success: true,
				requested: { amount: pr.amountRequested, currency: pr.currency, reused, notificationQueued },
				...(!notificationQueued
					? {
							warning:
								'The payment request was recorded, but WhatsApp could not be queued. Check the connection, entitlement and compliance status.'
						}
					: {})
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	remindPayment: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'payments:request');
		const data = await request.formData();
		try {
			const queued = await remindPaymentRequest(
				requireTenant(locals).id,
				parseUuid(String(data.get('requestId') ?? ''), 'request id'),
				{
					userId: locals.user!.id
				}
			);
			return queued
				? { success: true, reminded: true }
				: fail(400, { message: 'No approved payment reminder template is ready to send.' });
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	status: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'bookings:write');
		const data = await request.formData();
		try {
			await changeBookingStatus(
				requireTenant(locals).id,
				idOf(params),
				String(data.get('status')) as never,
				{ userId: locals.user!.id },
				String(data.get('reason') ?? '') || undefined
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	payment: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'payments:write');
		const data = await request.formData();
		const amount = String(data.get('amount') ?? '');
		if (!/^\d+(\.\d{1,2})?$/.test(amount)) return fail(400, { message: 'Enter a valid amount.' });
		try {
			// Recording a payment recomputes the booking balance and may confirm it (§19).
			await createPayment(
				requireTenant(locals).id,
				{
					bookingId: idOf(params),
					amount,
					provider: String(data.get('provider') ?? 'MANUAL'),
					description: String(data.get('description') ?? '') || null
				},
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
