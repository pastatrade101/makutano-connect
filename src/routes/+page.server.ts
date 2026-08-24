import { redirect } from '@sveltejs/kit';
import { planHighlights, selectablePlans, signupEnabled } from '$lib/server/provisioning';
import { pathForStage, stageForUser } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Operators keep their muscle memory: a signed-in visit to the root still lands in
	// the portal (or wherever their signup left off). Only anonymous visitors see the
	// public product site.
	if (locals.user) {
		if (locals.user.isSuperAdmin && !locals.tenant) redirect(303, '/admin');
		redirect(303, pathForStage(await stageForUser(locals.user)));
	}

	// Real plans, straight from the same source signup uses — the marketing page never
	// promises entitlements the platform does not resolve.
	const plans = await selectablePlans().catch(() => []);
	return {
		signupEnabled: signupEnabled(),
		plans: plans.map((p) => ({
			code: p.code,
			name: p.name,
			priceMonthly: Number(p.priceMonthly),
			currency: p.currency,
			highlights: planHighlights(
				(p.entitlements ?? {}) as Record<string, boolean | number>,
				(p.limits ?? {}) as Record<string, number>,
				(p.features ?? {}) as Record<string, boolean>
			)
		}))
	};
};
