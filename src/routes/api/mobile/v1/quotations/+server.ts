// Creating a quotation from the phone.
//
// Connect mirrors quotations written elsewhere as well, which is why the
// [id] route talks about "Connect's copy" — but a quotation raised HERE is an
// original, and it is the natural next step after a marketplace enquiry: the
// traveller asked about a published trip at a published price, and the
// operator answers with a number.
//
// The client sends lines and a currency. It does NOT send a total: the service
// computes that, so a phone with a stale draft or a rounding bug of its own
// cannot quote a figure the server disagrees with.
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { getBookingRequest } from '$lib/server/booking-requests';
import { createQuotation, sendQuotation } from '$lib/server/quotations';
import { quotationLines } from '$lib/quotation-lines';
import { AppError } from '$lib/server/errors';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	bookingRequestId: z.string().uuid().optional(),
	customerId: z.string().uuid().optional(),
	currency: z.string().trim().length(3).optional(),
	validUntil: z.string().trim().optional(),
	startDate: z.string().trim().optional(),
	endDate: z.string().trim().optional(),
	adults: z.coerce.number().int().min(0).max(40).optional(),
	children: z.coerce.number().int().min(0).max(40).optional(),
	notes: z.string().trim().max(4000).optional(),
	/** Sent in the same call, so the phone is one tap rather than two screens. */
	send: z.boolean().optional(),
	items: z
		.array(
			z.object({
				title: z.string().trim().min(1).max(200),
				description: z.string().trim().max(1000).optional(),
				quantity: z.coerce.number().int().min(1).max(999).default(1),
				unitPrice: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a number.')
			})
		)
		.min(1, 'A quotation needs at least one line.')
		.optional(),
	/**
	 * The phone's way in: a party and its rates, rather than pre-built lines.
	 *
	 * The lines are then composed HERE, by the same function the portal calls,
	 * so an adult/child split cannot come out differently on the two surfaces.
	 * `items` stays for anything that genuinely has its own line structure.
	 */
	party: z
		.object({
			title: z.string().trim().min(1).max(200),
			included: z.string().trim().max(1000).optional(),
			perGroup: z.boolean().optional(),
			adults: z.coerce.number().int().min(0).max(40),
			children: z.coerce.number().int().min(0).max(40),
			adultPrice: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a number.'),
			childPrice: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a number.').optional()
		})
		.optional()
});

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'quotations:write');

		let raw: unknown;
		try {
			raw = await event.request.json();
		} catch {
			throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
		}
		const parsed = bodySchema.safeParse(raw);
		if (!parsed.success) {
			throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the quotation and try again.');
		}
		const body = parsed.data;

		/*
		 * Fall back to the enquiry for anything the phone did not send.
		 *
		 * The web composer already does this; this endpoint did not, so a quotation
		 * raised on a phone silently dropped the travel date the traveller had
		 * given — and then the booking and the trip inherited the null, which is
		 * how a trip ends up reading "still needs travel dates" for a customer who
		 * supplied one. Traveller counts happened to survive because the app sends
		 * them; the date did not.
		 */
		let fallback: { startDate: Date | null; endDate: Date | null; adults: number | null; children: number | null } | null = null;
		if (body.bookingRequestId && (!body.startDate || !body.endDate || body.adults == null || body.children == null)) {
			const enquiry = await getBookingRequest(viewer.tenantId, body.bookingRequestId).catch(() => null);
			if (enquiry) {
				fallback = {
					startDate: enquiry.startDate ?? null,
					endDate: enquiry.endDate ?? null,
					adults: enquiry.adults ?? null,
					children: enquiry.children ?? null
				};
			}
		}
		const asDay = (v: Date | string | null | undefined) =>
			v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null;

		const lines = body.party ? quotationLines(body.party) : (body.items ?? []);
		if (!lines.length) throw new AppError('VALIDATION_ERROR', 'A quotation needs at least one line.');
		if (body.party && body.party.adults + body.party.children < 1) {
			throw new AppError('VALIDATION_ERROR', 'A quotation needs at least one traveller.');
		}

		const quotation = await createQuotation(
			viewer.tenantId,
			{
				bookingRequestId: body.bookingRequestId ?? null,
				customerId: body.customerId ?? null,
				currency: body.currency,
				validUntil: body.validUntil ?? null,
				startDate: body.startDate ?? asDay(fallback?.startDate),
				endDate: body.endDate ?? asDay(fallback?.endDate),
				adults: body.adults ?? fallback?.adults ?? undefined,
				children: body.children ?? fallback?.children ?? undefined,
				notes: body.notes ?? null,
				items: lines.map((line) => ({
					title: line.title,
					description: line.description ?? null,
					quantity: line.quantity,
					unitPrice: line.unitPrice
				}))
			},
			viewer.userId
		);

		await audit(
			viewer.tenantId,
			'quotation.created',
			{ type: 'user', userId: viewer.userId },
			{ type: 'quotation', id: quotation.id },
			{ reference: quotation.reference, via: 'mobile', fromEnquiry: body.bookingRequestId ?? null }
		);

		/*
		 * Sending is a separate service call and is allowed to fail on its own.
		 * The quotation already exists at this point, so a delivery problem must
		 * not read as "nothing happened" — the phone is told what was created AND
		 * whether it went out.
		 */
		let sent = false;
		let sendError: string | null = null;
		if (body.send) {
			try {
				await sendQuotation(viewer.tenantId, quotation.id, viewer.userId);
				sent = true;
			} catch (err) {
				sendError = err instanceof AppError ? err.message : 'The quotation was saved but could not be sent.';
			}
		}

		return ok({
			id: quotation.id,
			reference: quotation.reference,
			status: sent ? 'SENT' : quotation.status,
			total: quotation.total,
			currency: quotation.currency,
			sent,
			sendError
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
