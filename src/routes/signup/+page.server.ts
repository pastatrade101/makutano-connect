// Public self-signup, step 1: the account only. Business details, plan and WhatsApp
// all come later — asking for them here is what makes people abandon the form.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { sendExistingAccountNotice, sendVerificationEmail } from '$lib/server/auth/verification';
import { emailReady } from '$lib/server/env';
import { toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { marketplaceScale } from '$lib/server/marketplace';
import { signupEnabled } from '$lib/server/provisioning';
import {
	assertTermsAccepted,
	checkPassword,
	createAccount,
	limitSignupAttempts,
	pathForStage,
	stageForUser,
	turnstileEnabled,
	turnstileSiteKey,
	verifyTurnstile, landingPathFor } from '$lib/server/signup';
import type { PageServerLoad } from './$types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, await landingPathFor(locals.user));
	if (!signupEnabled()) redirect(303, '/login');
	// The panel's numbers are counted, never written down. Null when the count
	// fails — the panel then shows no numbers rather than wrong ones.
	return {
		turnstileSiteKey: turnstileEnabled() ? turnstileSiteKey() : null,
		scale: await marketplaceScale()
	};
};

export const actions: Actions = {
	default: async (event) => {
		if (!signupEnabled()) return fail(403, { message: 'Signup is currently closed.' });

		const data = await event.request.formData();
		const fullName = String(data.get('fullName') ?? '').trim();
		const email = String(data.get('email') ?? '').trim().toLowerCase();
		const password = String(data.get('password') ?? '');
		const confirm = String(data.get('confirmPassword') ?? '');
		const terms = data.get('terms') === 'on';
		const values = { fullName, email };

		if (!fullName) return fail(400, { ...values, message: 'Tell us your name.' });
		if (!EMAIL_RE.test(email)) return fail(400, { ...values, message: 'Enter a valid work email address.' });
		if (password !== confirm) return fail(400, { ...values, message: 'Those passwords do not match.' });

		const strength = checkPassword(password, email);
		if (!strength.ok) return fail(400, { ...values, message: strength.message });

		try {
			assertTermsAccepted(terms);
		} catch (err) {
			return fail(400, { ...values, message: toAppError(err).message });
		}

		// Rate limit before any database write, so a script cannot churn accounts.
		try {
			await limitSignupAttempts(event.locals.ipHash);
		} catch (err) {
			if (toAppError(err).code === 'RATE_LIMITED') {
				return fail(429, { ...values, message: 'Too many signups from this network. Please try again later.' });
			}
			log.error('signup_rate_limit_failed', { requestId: event.locals.requestId });
			return fail(500, { ...values, message: 'Signup is temporarily unavailable.' });
		}

		if (!(await verifyTurnstile(String(data.get('cf-turnstile-response') ?? '') || null, null))) {
			return fail(400, { ...values, message: 'Please complete the verification challenge.' });
		}

		const { user, created } = await createAccount({
			email,
			fullName,
			password,
			ipHash: event.locals.ipHash,
			requestId: event.locals.requestId,
			termsAcceptedAt: new Date()
		});

		if (!created) {
			// The address already belongs to a usable account. Say nothing that would
			// confirm it: mail the real owner a token-free notice, and show this visitor
			// exactly the screen everyone else sees.
			log.info('signup_existing_account', { requestId: event.locals.requestId });
			await sendExistingAccountNotice(email).catch(() => {});
			redirect(303, '/verify-email?sent=1&pending=1');
		}

		await sendVerificationEmail(user, event.locals.ipHash);

		// Sign them in immediately: the session is useless until the address is verified
		// (every gate checks emailVerifiedAt), but it means the resend button works and
		// a closed tab does not strand them.
		const { token, expiresAt } = await createSession(user.id, {
			userAgent: event.request.headers.get('user-agent'),
			ipHash: event.locals.ipHash
		});
		setSessionCookie(event.cookies, token, expiresAt);

		if (!emailReady()) {
			log.error('signup_email_not_configured', { userId: user.id });
		}
		redirect(303, '/verify-email?sent=1');
	}
};
