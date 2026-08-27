// Log an enquiry from the phone — the primary create for a tour or service business.
// Straight through createBookingRequest, so references, leads, the conversation link
// and the acknowledgement rules are the ones the rest of Connect already uses.
import type { RequestHandler } from '@sveltejs/kit';
import { createBookingRequest } from '$lib/server/booking-requests';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import { AppError } from '$lib/server/errors';
import { ok, problem, requirePermissionOrThrow, requireViewer } from '$lib/server/mobile';

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		requirePermissionOrThrow(viewer, 'booking_requests:write');
		const workspace = normalizeWorkspace((event.locals.tenant?.settings as Record<string, unknown>)?.capabilities);
		if (!moduleRelevant(workspace, 'enquiries')) {
			throw new AppError('VALIDATION_ERROR', 'This workspace does not take enquiries.');
		}

		const body = (await event.request.json().catch(() => ({}))) as {
			name?: string;
			phone?: string;
			email?: string;
			notes?: string;
			adults?: number;
			children?: number;
			startDate?: string;
			acknowledge?: boolean;
		};
		const name = String(body.name ?? '').trim();
		if (!name) throw new AppError('VALIDATION_ERROR', 'Who is this enquiry from?');
		const phone = String(body.phone ?? '').trim();
		const email = String(body.email ?? '').trim();
		if (!phone && !email) {
			throw new AppError('VALIDATION_ERROR', 'Add a WhatsApp number or an email so you can reply.');
		}

		const [firstName, ...rest] = name.split(/\s+/);
		const { request } = await createBookingRequest(viewer.tenantId, {
			customer: {
				firstName,
				lastName: rest.join(' '),
				whatsappPhone: phone || null,
				phone: phone || null,
				email: email || null
			},
			source: 'ADMIN',
			notes: String(body.notes ?? '').trim() || null,
			startDate: body.startDate || null,
			adults: body.adults,
			children: body.children,
			sendAcknowledgement: body.acknowledge === true
		});

		return ok({ id: request.id, reference: request.reference, conversationId: request.conversationId });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
