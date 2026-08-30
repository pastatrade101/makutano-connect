import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { getTripDetail, updateTrip } from '$lib/server/trips';
import { handle, ok, parseBody, parseUuid, requireApiScope } from '$lib/server/http';

const updateSchema = z
	.object({
		title: z.string().min(1).max(300),
		operationsUserId: z.string().uuid().nullable(),
		startDate: z.string().datetime().nullable(),
		endDate: z.string().datetime().nullable(),
		vehicle: z.string().max(200).nullable(),
		driver: z.string().max(200).nullable(),
		guide: z.string().max(200).nullable(),
		accommodation: z.string().max(500).nullable(),
		hotelConfirmed: z.boolean(),
		notes: z.string().max(4000).nullable()
	})
	.partial();

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:read');
		const id = parseUuid(event.params.id!, 'trip id');
		const detail = await getTripDetail(ctx.tenantId, id);

		// Passport numbers are the reason this gate exists. A trip is read by more
		// people than a booking is — drivers, guides, whoever is on the desk — so
		// the redaction has to hold here too, not only on the booking screen.
		const sensitive = ctx.scopes.includes('travelers:read_sensitive');

		// A trip carries its booking so operations can see whether money is
		// outstanding. It must not become a side door to the commercial record: a
		// key holding only trips:read gets the fact of a balance, not the pricing.
		const commercial = ctx.scopes.includes('bookings:read');
		const booking = commercial
			? detail.booking
			: {
					id: detail.booking.id,
					bookingReference: detail.booking.bookingReference,
					status: detail.booking.status,
					currency: detail.booking.currency,
					balanceDue: detail.booking.balanceDue
				};
		const customer = !detail.customer
			? null
			: ctx.scopes.includes('customers:read')
				? detail.customer
				: {
						id: detail.customer.id,
						firstName: detail.customer.firstName,
						lastName: detail.customer.lastName
					};

		return ok({
			...detail,
			booking,
			customer,
			travelers: detail.travelers.map((t) =>
				sensitive ? t : { ...t, passportNumber: null, passportExpiry: null, dateOfBirth: null }
			)
		});
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:write');
		const body = await parseBody(event, updateSchema);
		const id = parseUuid(event.params.id!, 'trip id');
		// Reassigning a trip is a different act from editing its set-up: it decides
		// whose problem the departure is.
		if (body.operationsUserId !== undefined) requireApiScope(event, 'trips:assign');
		const trip = await updateTrip(ctx.tenantId, id, body, { apiKeyId: ctx.apiKeyId });
		await audit(
			ctx.tenantId,
			'trip.updated',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'trip', id: trip.id },
			{ after: body }
		);
		return ok(trip);
	});
