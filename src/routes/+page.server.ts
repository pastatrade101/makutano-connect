import { redirect } from '@sveltejs/kit';
import { pathForStage, stageForUser } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// There is no marketing site here — Makutano Connect is infrastructure (§40). Land
	// operators where they can actually work, or where their signup left off.
	if (!locals.user) redirect(303, '/login');
	if (locals.user.isSuperAdmin && !locals.tenant) redirect(303, '/admin');
	redirect(303, pathForStage(await stageForUser(locals.user)));
};
