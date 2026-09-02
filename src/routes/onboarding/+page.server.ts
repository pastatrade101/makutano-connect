// Public self-signup, step 2: the business itself. Reaching this page means the user
// verified their address and does not yet own a tenant; submitting it provisions one
// through the same service Platform Admin uses.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { setActiveTenant } from '$lib/server/auth/session';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import {
	DEFAULT_SIGNUP_INDUSTRY,
	isSignupIndustry,
	SIGNUP_INDUSTRIES,
	defaultSignupPlanCode,
	planHighlights,
	provisionTenant,
	selectablePlans,
	signupEnabled,
	trialDays
} from '$lib/server/provisioning';
import { pathForStage, stageForUser } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

const COUNTRIES = [
	{ code: 'TZ', name: 'Tanzania' },
	{ code: 'KE', name: 'Kenya' },
	{ code: 'UG', name: 'Uganda' },
	{ code: 'RW', name: 'Rwanda' },
	{ code: 'BI', name: 'Burundi' },
	{ code: 'ZM', name: 'Zambia' },
	{ code: 'MW', name: 'Malawi' },
	{ code: 'MZ', name: 'Mozambique' },
	{ code: 'ZA', name: 'South Africa' },
	{ code: 'NG', name: 'Nigeria' },
	{ code: 'GH', name: 'Ghana' },
	{ code: 'AE', name: 'United Arab Emirates' },
	{ code: 'GB', name: 'United Kingdom' },
	{ code: 'US', name: 'United States' }
];

/** Sensible currency/timezone defaults so nobody has to think about them at signup. */
const LOCALE_DEFAULTS: Record<string, { currency: string; timezone: string }> = {
	TZ: { currency: 'TZS', timezone: 'Africa/Dar_es_Salaam' },
	KE: { currency: 'KES', timezone: 'Africa/Nairobi' },
	UG: { currency: 'UGX', timezone: 'Africa/Kampala' },
	RW: { currency: 'RWF', timezone: 'Africa/Kigali' },
	BI: { currency: 'BIF', timezone: 'Africa/Bujumbura' },
	ZM: { currency: 'ZMW', timezone: 'Africa/Lusaka' },
	MW: { currency: 'MWK', timezone: 'Africa/Blantyre' },
	MZ: { currency: 'MZN', timezone: 'Africa/Maputo' },
	ZA: { currency: 'ZAR', timezone: 'Africa/Johannesburg' },
	NG: { currency: 'NGN', timezone: 'Africa/Lagos' },
	GH: { currency: 'GHS', timezone: 'Africa/Accra' },
	AE: { currency: 'AED', timezone: 'Asia/Dubai' },
	GB: { currency: 'GBP', timezone: 'Europe/London' },
	US: { currency: 'USD', timezone: 'America/New_York' }
};

/*
 * ORDERS and HYBRID are gone with the industries that needed them. A tour
 * operator does not sell products, and offering a workspace nothing in the
 * marketplace feeds was a way to end up in the wrong half of the product on the
 * first screen.
 */
const GOAL_WORKSPACE = {
	BOOKINGS: 'BOOKINGS',
	SERVICE: 'SERVICE',
	PAYMENTS: 'SERVICE'
} as const;

const SYSTEM_SOURCES = new Set(['WEBSITE_CMS', 'BOOKING_SYSTEM', 'OTHER_SYSTEM', 'CONNECT_MANUAL']);

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const stage = await stageForUser(locals.user);
	if (stage !== 'BUSINESS') redirect(303, pathForStage(stage));

	const plans = await selectablePlans();
	return {
		fullName: locals.user.fullName,
		industries: SIGNUP_INDUSTRIES.map((i) => ({ value: i.value, label: i.label })),
		countries: COUNTRIES,
		plans: plans.map((p) => ({
			id: p.id,
			code: p.code,
			name: p.name,
			priceMonthly: Number(p.priceMonthly),
			currency: p.currency,
			// Presentation only. What the tenant may actually do is resolved server-side
			// from this plan's row on every request.
			highlights: planHighlights(
				(p.entitlements ?? {}) as Record<string, boolean | number>,
				(p.limits ?? {}) as Record<string, number>,
				(p.features ?? {}) as Record<string, boolean>
			)
		})),
		defaultPlanCode: defaultSignupPlanCode(),
		trialDays: trialDays(),
		signupEnabled: signupEnabled()
	};
};

export const actions: Actions = {
	default: async (event) => {
		if (!event.locals.user) redirect(303, '/login');

		// Re-derive the stage on submit: a verified user who already owns a tenant must
		// not be able to POST this form a second time and create another one.
		const stage = await stageForUser(event.locals.user);
		if (stage !== 'BUSINESS') redirect(303, pathForStage(stage));

		const data = await event.request.formData();
		const businessName = String(data.get('businessName') ?? '').trim();
		/*
		 * Whatever the browser sent is checked, not trusted. This field had no
		 * validation whatsoever — any string posted here was written to the tenant —
		 * so hiding the other options in the markup would have restricted nothing.
		 * Blank is normal now that signup offers a single industry and stops asking.
		 */
		const submittedIndustry = String(data.get('industry') ?? '').trim();
		const industry = submittedIndustry || DEFAULT_SIGNUP_INDUSTRY;
		const country = String(data.get('country') ?? '')
			.trim()
			.toUpperCase()
			.slice(0, 2);
		const businessPhone = String(data.get('businessPhone') ?? '').trim();
		const websiteUrl = String(data.get('websiteUrl') ?? '').trim();
		const planId = String(data.get('planId') ?? '').trim();
		const primaryGoal = String(data.get('primaryGoal') ?? '').trim() as keyof typeof GOAL_WORKSPACE;
		const mainUse = GOAL_WORKSPACE[primaryGoal];
		const systemSource = String(data.get('systemSource') ?? '').trim();
		const values = { businessName, industry, country, businessPhone, websiteUrl, planId, primaryGoal, systemSource };

		/*
		 * Only two answers are genuinely needed to open an account: what the business
		 * is called, and which plan. provisionTenant requires nothing else — every
		 * other field here was a survey question standing between an operator and
		 * the product, and each one is a chance to abandon.
		 *
		 * The rest is defaulted and finished later in Settings. A default the
		 * operator can change beats a question they must answer to continue.
		 */
		if (!signupEnabled()) return fail(403, { ...values, message: 'Signup is currently closed.' });
		if (!isSignupIndustry(industry)) {
			return fail(400, {
				...values,
				message: 'Makutano Connect is for tour and travel operators. Please contact us if you run a different kind of business.'
			});
		}
		if (primaryGoal && !(primaryGoal in GOAL_WORKSPACE)) {
			return fail(400, { ...values, message: 'Please choose how you plan to use Connect.' });
		}
		if (!businessName) return fail(400, { ...values, message: 'What is your business called?' });

		// Optional means "may be blank", NEVER "may be malformed" — a broken phone
		// or URL saved now is a broken link on their public profile later.
		if (businessPhone && !/^\+?[0-9 ()-]{7,20}$/.test(businessPhone)) {
			return fail(400, { ...values, message: 'That phone number does not look right — or leave it blank for now.' });
		}
		if (websiteUrl && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(websiteUrl)) {
			return fail(400, { ...values, message: 'Enter the website as a full URL, e.g. https://example.com — or leave it blank.' });
		}

		// Connect now leads with tour operators, so BOOKINGS — enquiry, quote,
		// booking, payment — is the right shape to open with. It is a UI preference
		// only and Settings can change it.
		const workspace = mainUse ?? 'BOOKINGS';
		// Already allowlisted above; this is the belt to that braces.
		const resolvedIndustry = isSignupIndustry(industry) ? industry : DEFAULT_SIGNUP_INDUSTRY;
		const resolvedCountry = COUNTRIES.some((c) => c.code === country) ? country : 'TZ';

		const defaults = LOCALE_DEFAULTS[resolvedCountry] ?? { currency: 'USD', timezone: 'Africa/Dar_es_Salaam' };

		try {
			// planId is only a *selector*: provisionTenant looks the plan up and refuses
			// anything that is not an active plan, so a tampered id cannot buy features.
			const { tenant, reused } = await provisionTenant({
				name: businessName,
				planId: planId || undefined,
				planCode: planId ? undefined : defaultSignupPlanCode(),
				source: 'SELF_SERVICE',
				owner: { kind: 'existing', userId: event.locals.user.id },
				industry: resolvedIndustry,
				capabilities: workspace,
				country: resolvedCountry,
				currency: defaults.currency,
				timezone: defaults.timezone,
				businessPhone,
				websiteUrl: websiteUrl || null,
				onboardingProfile: {
					primaryGoal,
					systemSource: SYSTEM_SOURCES.has(systemSource) ? (systemSource as never) : undefined
				},
				actor: {
					type: 'user',
					userId: event.locals.user.id,
					ipHash: event.locals.ipHash,
					requestId: event.locals.requestId
				}
			});

			if (event.locals.session) await setActiveTenant(event.locals.session.sessionId, tenant.id);
			log.info('signup_completed', { tenantId: tenant.id, reused });
		} catch (err) {
			const appError = toAppError(err);
			log.error('signup_provision_failed', {
				requestId: event.locals.requestId,
				code: appError.code,
				message: appError.message
			});
			return fail(400, { ...values, message: appError.message });
		}

		redirect(303, '/app?welcome=1');
	}
};
