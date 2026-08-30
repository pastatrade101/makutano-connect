// Trips: list them, and hand a booking over to operations.
//
// There is no "create a trip from nothing" here on purpose. A trip always comes
// from a booking — that is what makes it possible to keep the commercial record
// as the single truth about what was sold.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { createTripFromBooking, listTrips } from '$lib/server/trips';
import {
	handle,
	idempotencyKeyOf,
	listResponse,
	ok,
	paginationFrom,
	parseBody,
	parseQuery,
	requireApiScope
} from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';

const TRIP_STATUS = ['PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

const handoverSchema = z.object({
	bookingId: z.string().uuid(),
	/** Who is getting this out of the door. */
	operationsUserId: z.string().uuid().optional().nullable(),
	title: z.string().max(300).optional().nullable(),
	notes: z.string().max(4000).optional().nullable()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:read');
		const pagination = paginationFrom(event.url);
		const filters = parseQuery(
			event.url,
			z
				.object({
					status: z.enum(TRIP_STATUS).optional(),
					operationsUserId: z.string().uuid().optional(),
					bookingId: z.string().uuid().optional(),
					customerId: z.string().uuid().optional()
				})
				.partial()
		);
		const { items, total } = await listTrips(
			ctx.tenantId,
			{ ...filters, status: filters.status ? [filters.status] : undefined },
			pagination
		);
		return listResponse(items, total, pagination);
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'trips:write');
		const body = await parseBody(event, handoverSchema);
		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/trips',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const trip = await createTripFromBooking(
					ctx.tenantId,
					body.bookingId,
					{ operationsUserId: body.operationsUserId, title: body.title, notes: body.notes },
					{ apiKeyId: ctx.apiKeyId }
				);
				await audit(
					ctx.tenantId,
					'trip.created',
					{ type: 'api_key', apiKeyId: ctx.apiKeyId, requestId: ctx.requestId },
					{ type: 'trip', id: trip.id }
				);
				return { status: 201, body: trip as unknown as Record<string, unknown> };
			}
		);
		return ok(outcome.body, undefined, {
			status: outcome.status,
			headers: outcome.replayed ? { 'idempotent-replayed': 'true' } : undefined
		});
	});
