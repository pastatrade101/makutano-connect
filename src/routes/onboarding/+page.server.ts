// Public self-signup, step 2: the business itself. Reaching this page means the user
// verified their address and does not yet own a tenant; submitting it provisions one
// through the same service Platform Admin uses.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { setActiveTenant } from '$lib/server/auth/session';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import {
	INDUSTRIES,
	defaultSignupPlanCode,
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

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const stage = await stageForUser(locals.user);
	if (stage !== 'BUSINESS') redirect(303, pathForStage(stage));

	const plans = await selectablePlans();
	return {
		fullName: locals.user.fullName,
		industries: INDUSTRIES.map((i) => ({ value: i.value, label: i.label })),
		countries: COUNTRIES,
		plans: plans.map((p) => ({
			id: p.id,
			code: p.code,
			name: p.name,
			priceMonthly: Number(p.priceMonthly),
			currency: p.currency,
			// Presentation only. What the tenant may actually do is resolved server-side
			// from this plan's row on every request.
			highlights: planHighlights(p.entitlements ?? {})
		})),
		defaultPlanCode: defaultSignupPlanCode(),
		trialDays: trialDays(),
		signupEnabled: signupEnabled()
	};
};

function planHighlights(entitlements: Record<string, boolean | number>): string[] {
	const out: string[] = [];
	const numbers = Number(entitlements['whatsapp.maxNumbers'] ?? 0);
	out.push(numbers === 0 ? 'Unlimited WhatsApp numbers' : `${numbers} WhatsApp number${numbers === 1 ? '' : 's'}`);
	const orders = Number(entitlements['orders.maxPerMonth'] ?? 0);
	if (entitlements['orders.enabled'] !== false) {
		out.push(orders === 0 ? 'Unlimited orders' : `${orders.toLocaleString()} orders / month`);
	}
	const requests = Number(entitlements['bookings.maxRequestsPerMonth'] ?? 0);
	if (entitlements['bookings.enabled'] !== false) {
		out.push(requests === 0 ? 'Unlimited enquiries' : `${requests.toLocaleString()} enquiries / month`);
	}
	if (entitlements['webhooks.enabled']) out.push('Webhooks');
	if (entitlements['payments.enabled']) out.push('Payments');
	return out.slice(0, 4);
}

export const actions: Actions = {
	default: async (event) => {
		if (!event.locals.user) redirect(303, '/login');

		// Re-derive the stage on submit: a verified user who already owns a tenant must
		// not be able to POST this form a second time and create another one.
		const stage = await stageForUser(event.locals.user);
		if (stage !== 'BUSINESS') redirect(303, pathForStage(stage));

		const data = await event.request.formData();
		const businessName = String(data.get('businessName') ?? '').trim();
		const industry = String(data.get('industry') ?? '').trim();
		const country = String(data.get('country') ?? '').trim().toUpperCase().slice(0, 2);
		const businessPhone = String(data.get('businessPhone') ?? '').trim();
		const websiteUrl = String(data.get('websiteUrl') ?? '').trim();
		const planId = String(data.get('planId') ?? '').trim();
		const values = { businessName, industry, country, businessPhone, websiteUrl, planId };

		if (!signupEnabled()) return fail(403, { ...values, message: 'Signup is currently closed.' });
		if (!businessName) return fail(400, { ...values, message: 'What is your business called?' });
		if (!INDUSTRIES.some((i) => i.value === industry)) return fail(400, { ...values, message: 'Choose the closest industry.' });
		if (!COUNTRIES.some((c) => c.code === country)) return fail(400, { ...values, message: 'Choose your country.' });
		if (!/^\+?[0-9 ()-]{7,20}$/.test(businessPhone)) {
			return fail(400, { ...values, message: 'Enter a valid business phone number.' });
		}
		if (websiteUrl && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(websiteUrl)) {
			return fail(400, { ...values, message: 'Enter the website as a full URL, e.g. https://example.com' });
		}

		const defaults = LOCALE_DEFAULTS[country] ?? { currency: 'USD', timezone: 'Africa/Dar_es_Salaam' };

		try {
			// planId is only a *selector*: provisionTenant looks the plan up and refuses
			// anything that is not an active plan, so a tampered id cannot buy features.
			const { tenant, reused } = await provisionTenant({
				name: businessName,
				planId: planId || undefined,
				planCode: planId ? undefined : defaultSignupPlanCode(),
				source: 'SELF_SERVICE',
				owner: { kind: 'existing', userId: event.locals.user.id },
				industry,
				country,
				currency: defaults.currency,
				timezone: defaults.timezone,
				businessPhone,
				websiteUrl: websiteUrl || null,
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
			log.error('signup_provision_failed', { requestId: event.locals.requestId, code: appError.code, message: appError.message });
			return fail(400, { ...values, message: appError.message });
		}

		redirect(303, '/app?welcome=1');
	}
};
