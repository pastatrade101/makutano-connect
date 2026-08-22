import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// There is no marketing site here — Makutano Connect is infrastructure (§40). Land
	// operators where they can actually work.
	if (!locals.user) redirect(303, '/login');
	redirect(303, locals.user.isSuperAdmin && !locals.tenant ? '/admin' : '/app');
};
