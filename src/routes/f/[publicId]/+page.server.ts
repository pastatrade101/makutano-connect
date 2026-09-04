// Hosted public form. Unknown or disabled ids 404 — indistinguishable from a wrong URL.
import { error } from '@sveltejs/kit';
import { publicFormConfig, resolvePublicForm } from '$lib/server/forms';
import { resolveTourOwner, publicTourCard } from '$lib/server/marketplace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	try {
		const config = await publicFormConfig(params.publicId);

		/*
		 * ?tour= turns a generic form into a specific one.
		 *
		 * The operator shares a link for ONE tour — in a WhatsApp broadcast, an
		 * Instagram story — and the enquiry arrives attached to that tour, which is
		 * what lets the quotation price itself instead of starting blank. Without
		 * it the visitor types "safari" into a box and the operator retypes
		 * everything.
		 *
		 * Scoped hard: the tour must belong to the same tenant as the form, and be
		 * published. Otherwise a link could quietly attach one operator's enquiry
		 * to another operator's tour just by editing the query string.
		 */
		const slug = url.searchParams.get('tour')?.trim();
		let tour = null;
		if (slug) {
			const { form } = await resolvePublicForm(params.publicId);
			const owner = await resolveTourOwner(slug);
			if (owner && owner.tenantId === form.tenantId) {
				tour = await publicTourCard(owner.tourId);
			}
		}

		/*
		 * ?offer= is the campaign line — "15% off October departures".
		 *
		 * Free text on purpose: an offer is a sentence the operator wants to make,
		 * not an entity the system prices. It is carried onto the enquiry so the
		 * operator SEES what was promised before they quote — a discount shown to a
		 * visitor and invisible to the person writing the quotation is exactly the
		 * kind of claim the product rule forbids.
		 *
		 * Anyone can edit it in the URL. That only misleads the person editing it:
		 * the operator still sets the price, and the enquiry records what was
		 * claimed, so an invented "90% off" arrives visible and refusable.
		 */
		const offer = url.searchParams.get('offer')?.trim().slice(0, 120) || null;

		return { config, tour, offer, embedded: url.searchParams.get('embed') === '1' };
	} catch {
		error(404, 'This form is not available.');
	}
};
