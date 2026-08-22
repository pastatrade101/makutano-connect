// §34 transition endpoint: a legacy backend mirrors its quotations here, state-as-is.
// Idempotent upsert on externalReference — safe to call on every lifecycle event and
// safe to replay for backfills. Deliberately does NOT convert accepted quotations into
// bookings: the legacy system's "acceptance is agreement, a human confirms" semantics
// are preserved.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireFeature } from '$lib/server/billing';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';
import { upsertQuotationMirror } from '$lib/server/quotations';

const mirrorSchema = z.object({
	externalReference: z.string().min(1).max(200),
	externalSource: z.string().min(1).max(100),
	customer: z
		.object({
			firstName: z.string().max(120).optional(),
			lastName: z.string().max(120).optional(),
			email: z.string().email().optional().nullable(),
			phone: z.string().max(40).optional().nullable(),
			whatsappPhone: z.string().max(40).optional().nullable()
		})
		.optional()
		.nullable(),
	legacyBookingRequestId: z.string().max(100).optional().nullable(),
	title: z.string().max(300).optional().nullable(),
	status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED']),
	currency: z.string().length(3),
	total: z.string().regex(/^\d+(\.\d{1,2})?$/),
	items: z.array(z.object({ label: z.string().max(300).optional(), title: z.string().max(300).optional(), amount: z.union([z.number(), z.string()]).optional() })).max(100).optional().nullable(),
	adults: z.number().int().min(0).max(200).optional(),
	children: z.number().int().min(0).max(200).optional(),
	travelDate: z.string().optional().nullable(),
	validUntil: z.string().optional().nullable(),
	notes: z.string().max(10000).optional().nullable(),
	sentAt: z.string().optional().nullable(),
	viewedAt: z.string().optional().nullable(),
	acceptedAt: z.string().optional().nullable(),
	declinedAt: z.string().optional().nullable(),
	declineReason: z.string().max(500).optional().nullable(),
	createdAt: z.string().optional().nullable()
});

export const PUT: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'quotations:write');
		await requireFeature(ctx.tenantId, 'quotations');
		const body = await parseBody(event, mirrorSchema);
		const quotation = await upsertQuotationMirror(ctx.tenantId, body);
		return ok({ id: quotation.id, reference: quotation.reference, status: quotation.status, externalReference: body.externalReference });
	});
