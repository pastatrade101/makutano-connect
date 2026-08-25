// Public Order Link page. Unknown or draft ids 404 — indistinguishable from a wrong
// URL. Paused/expired/sold-out links render a friendly closed state, never an error.
import { error, fail, type Actions } from '@sveltejs/kit';
import { getPublicOrderLink, registerOrderLinkView, submitOrderLink } from '$lib/server/order-links';
import { toAppError } from '$lib/server/errors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, isDataRequest }) => {
	const link = await getPublicOrderLink(params.publicId!);
	if (!link) error(404, 'This order link is not available.');
	// Best-effort view count for conversion stats — only states a customer can act
	// on, and never on the re-run that follows a submission (that is not a new view).
	if (link.state === 'OPEN' && !isDataRequest) void registerOrderLinkView(params.publicId!);
	const tag = url.searchParams.get('s')?.slice(0, 40) ?? null;
	return { link, tag };
};

export const actions: Actions = {
	submit: async ({ params, request, locals }) => {
		const data = await request.formData();
		// Honeypot: humans never see the field; bots that fill it get a quiet fake success.
		if (String(data.get('hp_company') ?? '')) {
			// Indistinguishable from the real thing: a plausible receipt, no order.
			return {
				success: true,
				receipt: { orderNumber: 'OR-PENDING', total: '0', currency: '', quantity: 0, unit: '', title: '' },
				decoy: true
			};
		}
		const values = {
			name: String(data.get('name') ?? ''),
			whatsappPhone: String(data.get('whatsappPhone') ?? ''),
			email: String(data.get('email') ?? ''),
			quantity: String(data.get('quantity') ?? ''),
			deliveryMethod: String(data.get('deliveryMethod') ?? ''),
			deliveryLocation: String(data.get('deliveryLocation') ?? ''),
			note: String(data.get('note') ?? '')
		};
		try {
			const receipt = await submitOrderLink(
				params.publicId!,
				{
					name: values.name,
					whatsappPhone: values.whatsappPhone,
					email: values.email || undefined,
					quantity: Number(values.quantity),
					deliveryMethod: values.deliveryMethod === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
					deliveryLocation: values.deliveryLocation || undefined,
					note: values.note || undefined,
					submissionToken: String(data.get('submissionToken') ?? ''),
					sourceTag: String(data.get('sourceTag') ?? '') || undefined
				},
				{ ipHash: locals.ipHash }
			);
			return { success: true, receipt };
		} catch (err) {
			const appError = toAppError(err);
			// Never leak tenant/billing state to the public. Anything that is not a
			// plain customer-input problem becomes the same neutral closed message.
			const CUSTOMER_FACING = new Set(['VALIDATION_ERROR', 'CONFLICT']);
			const message =
				appError.code === 'RATE_LIMITED'
					? 'Too many attempts. Please wait a moment and try again.'
					: CUSTOMER_FACING.has(appError.code)
						? appError.message
						: 'Ordering for this offer has closed.';
			return fail(appError.code === 'RATE_LIMITED' ? 429 : 400, { ...values, message });
		}
	}
};
