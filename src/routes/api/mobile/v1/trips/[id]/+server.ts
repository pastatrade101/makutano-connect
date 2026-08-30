// One trip, and the set-up edits an operations person makes in the field.
//
// Everything is the same service the portal calls, so a driver assigned from a
// Land Cruiser in the Serengeti goes through the same membership check, the same
// readiness re-check and the same audit trail as one assigned from a desk.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { getTripDetail, updateTrip } from '$lib/server/trips';
import { listTeam, roleLabel } from '$lib/server/team';
import { blockerLabel, statusLabel } from '$lib/labels';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

const updateSchema = z
	.object({
		title: z.string().min(1).max(300),
		operationsUserId: z.string().uuid().nullable(),
		vehicle: z.string().max(200).nullable(),
		driver: z.string().max(200).nullable(),
		guide: z.string().max(200).nullable(),
		accommodation: z.string().max(500).nullable(),
		hotelConfirmed: z.boolean(),
		notes: z.string().max(4000).nullable()
	})
	.partial();

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'trips:read');
		const detail = await getTripDetail(viewer.tenantId, event.params.id!);

		const sensitive = viewer.permissions.includes('travelers:read_sensitive');
		const commercial = viewer.permissions.includes('bookings:read');

		// Who this trip can be handed to. Only fetched for somebody who may assign
		// it, and only people who are actually here — handing a departure to a
		// deactivated account is a quiet way to lose it.
		const team = viewer.permissions.includes('trips:assign') ? await listTeam(viewer.tenantId) : [];

		return ok({
			trip: {
				id: detail.trip.id,
				reference: detail.trip.tripReference,
				title: detail.trip.title,
				status: detail.trip.status,
				statusLabel: statusLabel(detail.trip.status),
				startDate: detail.trip.startDate?.toISOString() ?? null,
				endDate: detail.trip.endDate?.toISOString() ?? null,
				adults: detail.trip.adults,
				children: detail.trip.children,
				accommodation: detail.trip.accommodation,
				vehicle: detail.trip.vehicle,
				driver: detail.trip.driver,
				guide: detail.trip.guide,
				hotelConfirmed: detail.trip.hotelConfirmed,
				operationsUserId: detail.trip.operationsUserId,
				notes: detail.trip.notes
			},
			readiness: {
				percent: detail.readiness.percent,
				canBeReady: detail.readiness.canBeReady,
				checks: detail.readiness.checks,
				// Pre-worded here so the app never has to know that a check's checklist
				// name and its blocker name are different words.
				blocking: detail.readiness.missing.filter((c) => c.critical).map((c) => blockerLabel(c))
			},
			customer: detail.customer
				? {
						id: detail.customer.id,
						name: [detail.customer.firstName, detail.customer.lastName].filter(Boolean).join(' ').trim() || null,
						phone: detail.customer.phone ?? null
					}
				: null,
			booking: {
				id: detail.booking.id,
				reference: detail.booking.bookingReference,
				status: detail.booking.status,
				currency: detail.booking.currency,
				hasBalance: Number(detail.booking.balanceDue ?? 0) > 0,
				balanceDue: commercial ? detail.booking.balanceDue : null
			},
			// The itinerary as operations sees it: what happens, on which day.
			items: detail.items.map((i) => ({
				id: i.id,
				type: i.type,
				title: i.title,
				description: i.description,
				dayNumber: i.dayNumber,
				confirmed: i.confirmed
			})),
			travelers: detail.travelers.map((t) => ({
				id: t.id,
				name: [t.firstName, t.lastName].filter(Boolean).join(' ').trim(),
				nationality: t.nationality,
				dietaryRequirements: t.dietaryRequirements,
				// Passports are gated on the phone exactly as on the desk. A trip is
				// read by more people than a booking is, which is the reason, not an
				// excuse to relax it because the screen is small.
				passportNumber: sensitive ? t.passportNumber : null,
				hasPassport: Boolean(t.passportNumber)
			})),
			// What Connect already knows about this trip, offered as choices rather
			// than made somebody retype it. The hotel is usually already on the
			// booking — it was sold to the traveller — so the operations person
			// picking accommodation should be picking, not transcribing.
			suggestions: {
				accommodation: [
					...new Set(
						detail.items
							.filter((i) => i.type === 'HOTEL' || i.type === 'ROOM')
							.map((i) => i.title.trim())
							.filter(Boolean)
					)
				],
				transfer: [
					...new Set(
						detail.items
							.filter((i) => i.type === 'TRANSFER')
							.map((i) => i.title.trim())
							.filter(Boolean)
					)
				]
			},
			members: team
				.filter((m) => m.status === 'Active')
				.map((m) => ({ id: m.userId, name: m.fullName || m.email, role: roleLabel(m.role) })),
			can: {
				write: viewer.permissions.includes('trips:write'),
				assign: viewer.permissions.includes('trips:assign'),
				seeSensitive: sensitive
			}
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'trips:write');
		const body = updateSchema.parse(await event.request.json());
		// Deciding whose problem a departure is, separately from preparing it.
		if (body.operationsUserId !== undefined) requirePermissionOrThrow(viewer, 'trips:assign');

		const trip = await updateTrip(viewer.tenantId, event.params.id!, body, { userId: viewer.userId });
		await audit(
			viewer.tenantId,
			'trip.updated',
			{ type: 'user', userId: viewer.userId },
			{ type: 'trip', id: trip.id },
			{ after: body, via: 'mobile' }
		);
		// Return the fresh verdict: the app should never recompute readiness itself.
		const detail = await getTripDetail(viewer.tenantId, trip.id);
		return ok({
			trip: { id: trip.id, status: detail.trip.status, statusLabel: statusLabel(detail.trip.status) },
			readiness: {
				percent: detail.readiness.percent,
				canBeReady: detail.readiness.canBeReady,
				blocking: detail.readiness.missing.filter((c) => c.critical).map((c) => blockerLabel(c))
			}
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
