// Logging an enquiry by hand: the phone rings, someone walks in, a message arrives
// somewhere Connect cannot see. Until now the "+ New enquiry" action led to a list
// with no way to create anything — this is the missing screen, not a new feature.
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { createBookingRequest } from '$lib/server/booking-requests';
import { getConversation } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// A page load that throws a domain error renders a 500; someone simply lacking
	// permission deserves a plain 403 instead.
	try {
		requireTenantPermission(locals, 'booking_requests:write');
	} catch {
		error(403, 'You do not have permission to create enquiries.');
	}
	const tenantId = requireTenant(locals).id;
	const workspace = normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities);

	// Conversation → enquiry: carry the traveller across so nobody retypes a name and
	// a number that Connect already knows.
	let conversation: { id: string; name: string; phone: string | null } | null = null;
	const conversationId = url.searchParams.get('conversation');
	if (conversationId) {
		try {
			const conv = await getConversation(tenantId, conversationId);
			const customer = conv.customerId
				? (await db().select().from(schema.customers).where(eq(schema.customers.id, conv.customerId)).limit(1))[0]
				: null;
			conversation = {
				id: conv.id,
				name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' '),
				phone: customer?.whatsappPhone ?? conv.externalId
			};
		} catch {
			conversation = null;
		}
	}

	return { workspaceRelevant: moduleRelevant(workspace, 'enquiries'), conversation, workspace };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		requireTenantPermission(locals, 'booking_requests:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const values = {
			name,
			phone: String(data.get('phone') ?? '').trim(),
			email: String(data.get('email') ?? '').trim(),
			notes: String(data.get('notes') ?? '').trim(),
			startDate: String(data.get('startDate') ?? '').trim(),
			endDate: String(data.get('endDate') ?? '').trim(),
			adults: String(data.get('adults') ?? '').trim(),
			children: String(data.get('children') ?? '').trim(),
			estimatedTotal: String(data.get('estimatedTotal') ?? '').trim()
		};
		if (!name) return fail(400, { ...values, message: 'Who is this enquiry from?' });
		if (!values.phone && !values.email) {
			return fail(400, { ...values, message: 'Add a WhatsApp number or an email so you can reply.' });
		}

		const [firstName, ...rest] = name.split(/\s+/);
		try {
			const { request: created } = await createBookingRequest(tenantId, {
				customer: {
					firstName,
					lastName: rest.join(' '),
					whatsappPhone: values.phone || null,
					phone: values.phone || null,
					email: values.email || null
				},
				source: 'ADMIN',
				notes: values.notes || null,
				startDate: values.startDate || null,
				endDate: values.endDate || null,
				adults: values.adults ? Number(values.adults) : undefined,
				children: values.children ? Number(values.children) : undefined,
				estimatedTotal: values.estimatedTotal || null,
				// Logged by a person who is already talking to the customer: an automatic
				// "we received your enquiry" is only sent when they ask for it.
				sendAcknowledgement: data.get('acknowledge') === 'on'
			});
			redirect(303, `/app/booking-requests/${created.id}?created=1`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			return fail(400, { ...values, message: toAppError(err).message });
		}
	}
};
