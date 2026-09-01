// A traveller asking an operator about a tour.
//
// This is the most security-sensitive route in the marketplace, and the reason is
// one sentence: it is the only unauthenticated endpoint that WRITES, and what it
// writes belongs to a tenant. So the tenant is never something the caller can
// influence — the browser names a TOUR, and the server resolves who owns it.
//
// Deliberately NOT a new "marketplace lead" type. It creates the same
// booking_request the website form creates, which is why the Flutter app, the
// portal, the reports and the WhatsApp flow all keep working with no change.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createBookingRequest } from '$lib/server/booking-requests';
import { resolveOperatorOwner, resolveTourOwner } from '$lib/server/marketplace';
import { AppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { handlePublic, preflight, publicJson } from '$lib/server/public-api';

/**
 * Acquisition context, allow-listed.
 *
 * Every value here is attacker-controlled, so the shape is fixed and each field
 * is short: nobody gets to stuff a megabyte of anything into a tenant's row via
 * an anonymous endpoint. Unknown keys are dropped rather than rejected — a
 * marketing tool adding a parameter should not break an enquiry.
 */
const attributionSchema = z
	.object({
		utmSource: z.string().trim().max(120).optional(),
		utmMedium: z.string().trim().max(120).optional(),
		utmCampaign: z.string().trim().max(200).optional(),
		utmContent: z.string().trim().max(200).optional(),
		utmTerm: z.string().trim().max(200).optional(),
		referrer: z.string().trim().max(500).optional(),
		landingPage: z.string().trim().max(500).optional(),
		sourcePage: z.string().trim().max(500).optional(),
		sessionId: z.string().trim().max(120).optional()
	})
	.partial()
	.strip();

const bodySchema = z.object({
	/*
	 * One of these two decides ownership, and nothing else does.
	 *
	 * `tour` is an enquiry about a specific listing. `operator` is an enquiry
	 * from a storefront — "help me plan something" — where there is no tour yet.
	 * Both are PUBLIC slugs, and both are resolved server-side; neither is a
	 * tenant id, and the schema still has no field that could carry one.
	 */
	tour: z.string().trim().min(1).max(200).optional(),
	operator: z.string().trim().min(1).max(200).optional(),

	firstName: z.string().trim().min(1).max(120),
	lastName: z.string().trim().max(120).optional(),
	email: z.string().trim().email().max(320).optional(),
	phone: z.string().trim().max(40).optional(),
	whatsappPhone: z.string().trim().max(40).optional(),
	country: z.string().trim().max(120).optional(),

	startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	adults: z.coerce.number().int().min(1).max(40).default(2),
	children: z.coerce.number().int().min(0).max(40).default(0),
	message: z.string().trim().max(4000).optional(),

	attribution: attributionSchema.optional()
});

export const POST: RequestHandler = async (event) =>
	// Tighter than the read endpoints: this one writes, and writes cost the tenant
	// a row and a notification.
	handlePublic(event, { scope: 'pub-enquiry', limit: 10, windowSeconds: 600 }, async () => {
		let raw: unknown;
		try {
			raw = await event.request.json();
		} catch {
			throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
		}

		const parsed = bodySchema.safeParse(raw);
		if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Please check the form and try again.');
		const body = parsed.data;

		// A traveller must leave SOME way to be answered. Requiring both an email
		// and a phone loses enquiries; requiring neither produces a lead nobody can
		// reply to.
		if (!body.email && !body.phone && !body.whatsappPhone) {
			throw new AppError('VALIDATION_ERROR', 'Please leave an email address or a phone number.');
		}

		/*
		 * OWNERSHIP. Note what is NOT read here: the body's tenantId, or any header
		 * claiming one. `bodySchema` does not even define such a field, so a
		 * malicious `{"tenantId": "..."}` is dropped by the parse before this line
		 * runs.
		 *
		 * A tour resolves the tenant, and resolveTourOwner only answers for a
		 * PUBLISHED, non-deleted listing — so an enquiry cannot be attached to a
		 * draft, an archived listing, or a tour that does not exist. An operator
		 * slug resolves it the same way, and only for an ACTIVE profile on an
		 * active tenant.
		 *
		 * The tour wins when both are sent: it is the more specific of the two,
		 * and it already carries the operator with it.
		 */
		if (!body.tour && !body.operator) {
			throw new AppError('VALIDATION_ERROR', 'Tell us which trip or operator this is about.');
		}

		let tenantId: string;
		let tourId: string | null = null;
		if (body.tour) {
			const owner = await resolveTourOwner(body.tour);
			if (!owner) throw new AppError('NOT_FOUND', 'That tour is no longer available.');
			tenantId = owner.tenantId;
			tourId = owner.tourId;
		} else {
			const owner = await resolveOperatorOwner(body.operator!);
			if (!owner) throw new AppError('NOT_FOUND', 'That operator is no longer available.');
			tenantId = owner.tenantId;
		}

		const { request } = await createBookingRequest(tenantId, {
			customer: {
				firstName: body.firstName,
				lastName: body.lastName ?? '',
				email: body.email ?? null,
				phone: body.phone ?? null,
				whatsappPhone: body.whatsappPhone ?? null,
				country: body.country ?? null
			},
			source: 'MARKETPLACE',
			tourId,
			startDate: body.startDate ?? null,
			endDate: body.endDate ?? null,
			adults: body.adults,
			children: body.children,
			notes: body.message ?? null,
			// Acquisition context, not lifecycle state — so it lives in metadata and
			// never becomes a column the business logic can accidentally branch on.
			metadata: body.attribution ? { marketplace: body.attribution } : {}
		});

		// Deliberately no tenant id, no tour id, no customer id, no internal status.
		// A reference is all the traveller needs, and all they should be given.
		log.info('marketplace_enquiry_created', { reference: request.reference, tourId });

		return publicJson(
			{
				reference: request.reference,
				message: 'Thank you — the operator has your request and will reply directly.'
			},
			'no-store'
		);
	});

/**
 * GET is not a thing here.
 *
 * Without this a GET would fall through to SvelteKit's 405, which is fine — but
 * being explicit keeps the "this endpoint writes and nothing else" statement in
 * the file rather than in the framework.
 */
export const GET: RequestHandler = async () => {
	throw new AppError('NOT_FOUND', 'Not found.');
};

export const OPTIONS: RequestHandler = async () => preflight();
