// Hosted public form. Unknown or disabled ids 404 — indistinguishable from a wrong URL.
import { error } from '@sveltejs/kit';
import { publicFormConfig } from '$lib/server/forms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	try {
		const config = await publicFormConfig(params.publicId);
		return { config, embedded: url.searchParams.get('embed') === '1' };
	} catch {
		error(404, 'This form is not available.');
	}
};
