// The customer's view of a quotation (/q/<token>).
//
// No session, no tenant in the URL, no quotation id — the unguessable token is
// the only key, exactly as /o/<publicId> works for order links. What the loader
// returns is a projection built in getPublicQuotation: internal notes, the
// owning user and the version history never leave the building.
import { error, fail } from '@sveltejs/kit';
import { acceptPublicQuotation, declinePublicQuotation, getPublicQuotation } from '$lib/server/quotations';
import { toAppError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const quotation = await getPublicQuotation(params.token);
	// A wrong token and a deleted quotation look identical on purpose: telling a
	// stranger which of the two it was is how a token becomes guessable.
	if (!quotation) error(404, 'This quotation is not available.');
	return { quotation };
};

const asFailure = (err: unknown) => {
	const e = toAppError(err);
	return fail(400, { error: e.message });
};

export const actions: Actions = {
	accept: async ({ params }) => {
		try {
			await acceptPublicQuotation(params.token);
			return { accepted: true };
		} catch (err) {
			return asFailure(err);
		}
	},

	decline: async ({ params, request }) => {
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '').trim() || undefined;
		try {
			await declinePublicQuotation(params.token, reason);
			return { declined: true };
		} catch (err) {
			return asFailure(err);
		}
	}
};
