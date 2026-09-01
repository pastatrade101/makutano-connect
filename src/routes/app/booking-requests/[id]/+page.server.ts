import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { eq } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { addBookingRequestNote, getBookingRequestDetail, updateBookingRequest } from '$lib/server/booking-requests';
import { createQuotation, draftQuotationFor, sendQuotation } from '$lib/server/quotations';
import { isPrice, normalisePrice, quotationLines } from '$lib/quotation-lines';
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

	/*
	 * The quotation this enquiry would produce — the SAME draft the phone opens.
	 *
	 * Loaded here rather than fetched on click so the review panel is filled in
	 * the moment it opens, and so a page that can quote always knows what it
	 * would be quoting.
	 */
	const quoteDraft = locals.permissions.includes('quotations:write')
		? await draftQuotationFor(tenantId, idOf(params)).catch(() => null)
		: null;

	return { ...detail, travelers, messages, canSeeSensitive, quoteDraft };
};

export const actions: Actions = {
	/**
	 * One tap from enquiry to a draft quotation: items are copied across, the request
	 * moves to QUOTED, and the operator lands on the quote ready to price and send.
	 */
	createQuote: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'quotations:write');
		const tenantId = requireTenant(locals).id;
		const id = idOf(params);
		const data = await request.formData();
		const send = String(data.get('send') ?? '') === '1';
		let quotationId: string;
		let sent = false;
		try {
			const detail = await getBookingRequestDetail(tenantId, id);
			const draft = await draftQuotationFor(tenantId, id);

			/*
			 * The enquiry's own line items win where they exist — a request that
			 * already itemises flights and lodging must not be flattened into one
			 * line. Everything else is priced from the shared draft, which is what
			 * the phone shows, so the same enquiry produces the same quotation on
			 * either surface.
			 *
			 * The old fallback here invented a line called "Package" at the
			 * enquiry's estimate, which for a marketplace enquiry meant quoting a
			 * published safari as zero.
			 */
			const count = (field: string, fallback: number) => {
				const raw = Number(data.get(field));
				return Number.isFinite(raw) ? Math.max(0, Math.min(40, Math.trunc(raw))) : fallback;
			};
			/** What the operator typed, or the published figure when it is unusable. */
			const price = (field: string, fallback: string) => {
				const typed = normalisePrice(String(data.get(field) ?? ''));
				return isPrice(typed) ? typed : fallback;
			};

			const perGroup = draft.items[0]?.basis === 'per group';
			const published = draft.items[0]?.unitPrice ?? '0';
			const adults = count('adults', draft.enquiry.adults);
			const children = count('children', draft.enquiry.children);
			const adultPrice = price('adultPrice', published);
			// No invented child discount: it defaults to the adult rate, and only
			// the operator moves it.
			const childPrice = price('childPrice', adultPrice);
			const included = String(data.get('included') ?? '').trim();
			const message = String(data.get('message') ?? '').trim();
			const validUntil = String(data.get('validUntil') ?? '').trim();
			const title = String(data.get('title') ?? '').trim() || draft.tour?.title || 'Trip';

			// The shared money rule — the same call the phone's create endpoint makes.
			const priced = quotationLines({
				title,
				included,
				perGroup,
				adults,
				children,
				adultPrice,
				childPrice
			});

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
				: priced;

			const quotation = await createQuotation(
				tenantId,
				{
					bookingRequestId: id,
					conversationId: detail.request.conversationId,
					currency: draft.currency,
					// The party the operator just confirmed, not the one the enquiry
					// arrived with — those can differ, and the quotation should say
					// what is actually being quoted.
					adults,
					children,
					notes: message || null,
					validUntil: validUntil || null,
					items
				},
				locals.user!.id
			);
			/*
			 * The enquiry is NOT marked QUOTED here.
			 *
			 * A draft nobody has seen is not a quote the traveller has received,
			 * and sendQuotation() already moves the enquiry when it actually goes
			 * out. Marking it on create meant a saved draft silently took the
			 * enquiry off the work list — and the phone, which does not do this,
			 * disagreed with the portal about the same enquiry.
			 */
			quotationId = quotation.id;

			// Sending is its own step and allowed to fail on its own: the quotation
			// exists either way, and "created but not delivered" must not read as
			// "nothing happened".
			if (send) {
				try {
					await sendQuotation(tenantId, quotation.id, locals.user!.id);
					sent = true;
				} catch {
					sent = false;
				}
			}
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, `/app/quotations/${quotationId}?${send ? (sent ? 'sent=1' : 'sendfailed=1') : 'created=1'}`);
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
