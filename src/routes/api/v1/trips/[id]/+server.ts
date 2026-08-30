import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { getTripDetail, updateTrip } from '$lib/server/trips';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

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
		const detail = await getTripDetail(ctx.tenantId, event.params.id);

		// Passport numbers are the reason this gate exists. A trip is read by more
		// people than a booking is — drivers, guides, whoever is on the desk — so
		// the redaction has to hold here too, not only on the booking screen.
		const sensitive = ctx.scopes.includes('travelers:read_sensitive');
		return ok({
			...detail,
			travelers: detail.travelers.map((t) =>
				sensitive ? t : { ...t, passportNumber: null, passportExpiry: null, dateOfBirth: null }
			)
		});
	});

export const PATCH: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:write');
		const body = await parseBody(event, updateSchema);
		const trip = await updateTrip(ctx.tenantId, event.params.id, body, { apiKeyId: ctx.apiKeyId });
		await audit(
			ctx.tenantId,
			'trip.updated',
			{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
			{ type: 'trip', id: trip.id },
			{ after: body }
		);
		return ok(trip);
	});
