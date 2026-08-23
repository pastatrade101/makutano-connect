import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { eq } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { addBookingRequestNote, getBookingRequestDetail, updateBookingRequest } from '$lib/server/booking-requests';
import { createQuotation } from '$lib/server/quotations';
import { db, schema } from '$lib/server/db';
import { listMessages } from '$lib/server/conversations';
import { queueMessage } from '$lib/server/whatsapp/messages';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

// A route parameter is untrusted input: validate its shape before it reaches a query,
// and note that it is never authorization — every lookup below is tenant-scoped.
const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'booking request id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'booking_requests:read');
	const tenantId = requireTenant(locals).id;

	let detail;
	try {
		detail = await getBookingRequestDetail(tenantId, idOf(params));
	} catch {
		error(404, 'Booking request not found');
	}

	// §17: show the request and its conversation together.
	const messages = detail.request.conversationId
		? (await listMessages(tenantId, detail.request.conversationId, { page: 1, limit: 50, order: 'desc' })).items
		: [];

	// Passport data is only rendered for roles that hold travelers:read_sensitive (§15).
	const canSeeSensitive = locals.permissions.includes('travelers:read_sensitive');
	const travelers = detail.travelers.map((t) =>
		canSeeSensitive ? t : { ...t, passportNumber: null, passportExpiry: null, dateOfBirth: null }
	);

	return { ...detail, travelers, messages, canSeeSensitive };
};

export const actions: Actions = {
	/**
	 * One tap from enquiry to a draft quotation: items are copied across, the request
	 * moves to QUOTED, and the operator lands on the quote ready to price and send.
	 */
	createQuote: async ({ locals, params }) => {
		requirePermission(locals.permissions, 'quotations:write');
		const tenantId = requireTenant(locals).id;
		const id = idOf(params);
		let quotationId: string;
		try {
			const detail = await getBookingRequestDetail(tenantId, id);
			const items = detail.items.length
				? detail.items.map((i) => ({
						type: i.type,
						title: i.title,
						description: i.description,
						quantity: i.quantity,
						unitPrice: i.unitPrice,
						startDate: i.startDate ? String(i.startDate).slice(0, 10) : null,
						endDate: i.endDate ? String(i.endDate).slice(0, 10) : null
					}))
				: [{ title: 'Package', quantity: 1, unitPrice: detail.request.estimatedTotal ?? '0' }];
			const quotation = await createQuotation(
				tenantId,
				{
					bookingRequestId: id,
					conversationId: detail.request.conversationId,
					currency: detail.request.currency ?? undefined,
					adults: detail.request.adults ?? undefined,
					children: detail.request.children ?? undefined,
					items
				},
				locals.user!.id
			);
			await updateBookingRequest(tenantId, id, { status: 'QUOTED' });
			quotationId = quotation.id;
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, `/app/quotations/${quotationId}`);
	},

	status: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'booking_requests:write');
		const data = await request.formData();
		try {
			await updateBookingRequest(requireTenant(locals).id, idOf(params), {
				status: String(data.get('status') ?? '') as never
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	assign: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'booking_requests:write');
		const data = await request.formData();
		await updateBookingRequest(requireTenant(locals).id, idOf(params), {
			assigneeUserId: String(data.get('assigneeUserId') ?? '') || null
		});
		return { success: true };
	},

	note: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'booking_requests:write');
		const data = await request.formData();
		const body = String(data.get('body') ?? '').trim();
		if (!body) return fail(400, { message: 'Write something first.' });
		await addBookingRequestNote(requireTenant(locals).id, idOf(params), body, locals.user!.id);
		return { success: true };
	},

	reply: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'whatsapp:send');
		const data = await request.formData();
		const text = String(data.get('text') ?? '').trim();
		if (!text) return fail(400, { message: 'Write a message first.' });

		const bookingRequest = (
			await db()
				.select()
				.from(schema.bookingRequests)
				.where(eq(schema.bookingRequests.id, idOf(params)))
				.limit(1)
		)[0];
		// Re-check tenancy explicitly: the id came from the URL, not from a credential.
		if (!bookingRequest || bookingRequest.tenantId !== requireTenant(locals).id)
			return fail(404, { message: 'Request not found.' });

		const customer = bookingRequest.customerId
			? (
					await db().select().from(schema.customers).where(eq(schema.customers.id, bookingRequest.customerId)).limit(1)
				)[0]
			: null;
		const to = customer?.whatsappPhone ?? customer?.phone;
		if (!to) return fail(400, { message: 'This traveller has no WhatsApp number.' });

		try {
			await queueMessage({
				tenantId: requireTenant(locals).id,
				to,
				content: { type: 'text', text },
				conversationId: bookingRequest.conversationId,
				customerId: customer?.id ?? null,
				sentByUserId: locals.user!.id
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
