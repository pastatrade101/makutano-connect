// Team moved into People (/app/crew), so "who works here" is one page rather
// than two under different parts of the nav. Kept as a redirect because this URL
// is bookmarked, is linked from Settings and the onboarding checklist, and has
// been the address of the team roster for the life of the product.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(308, '/app/crew');
};
