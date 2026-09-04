import { redirect } from '@sveltejs/kit';
import { planHighlights, selectablePlans, signupEnabled, trialDays } from '$lib/server/provisioning';
import { pathForStage, stageForUser, landingPathFor } from '$lib/server/signup';
import { env } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Operators keep their muscle memory: a signed-in visit to the root still lands in
	// the portal (or wherever their signup left off). Only anonymous visitors see the
	// public product site.
	if (locals.user) {
		if (locals.user.isSuperAdmin && !locals.tenant) redirect(303, '/admin');
		redirect(303, await landingPathFor(locals.user));
	}

	// Real plans, straight from the same source signup uses — the marketing page never
	// promises entitlements the platform does not resolve.
	const plans = await selectablePlans().catch(() => []);
	const e = env();
	return {
		signupEnabled: signupEnabled(),
		// Configured, never hardcoded: the page links the marketplace by config so a
		// staging deploy cannot advertise production to travellers.
		marketplaceUrl: e.MARKETPLACE_URL,
		// Empty until the apps ship. The page hides every store badge and every
		// "available on iPhone and Android" claim while these are blank, so it can
		// never advertise a listing that does not exist.
		appStoreUrl: e.APP_STORE_URL,
		playStoreUrl: e.PLAY_STORE_URL,
		// The page states the trial length as a commercial promise, so it comes from
		// the same function signup uses rather than being typed into the markup —
		// changing SIGNUP_TRIAL_DAYS must not leave the marketing page lying.
		trialDays: trialDays(),
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
