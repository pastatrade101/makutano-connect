// Transactional email.
//
// There is deliberately no "pretend we sent it" path: when no provider is configured
// the send is reported as undelivered and logged at warn level, so a deployment that
// cannot mail its users is visible rather than quietly swallowing verification links.
import { emailReady, env, isProduction } from './env';
import { log } from './logger';

export type OutboundEmail = {
	to: string;
	subject: string;
	html: string;
	text: string;
};

export type SendResult = { delivered: boolean; provider: string; id?: string; reason?: string };

export async function sendEmail(message: OutboundEmail): Promise<SendResult> {
	const e = env();
	if (!emailReady()) {
		// In development the link is the only way to continue, so surface it locally.
		// Never in production: that would put a live credential into the log stream.
		log.warn('email_not_configured', {
			to: message.to,
			subject: message.subject,
			body: isProduction() ? undefined : message.text
		});
		return { delivered: false, provider: 'none', reason: 'EMAIL_NOT_CONFIGURED' };
	}

	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${e.EMAIL_PROVIDER_KEY}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				from: e.EMAIL_FROM,
				to: [message.to],
				subject: message.subject,
				html: message.html,
				text: message.text
			})
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			log.error('email_send_failed', { to: message.to, status: res.status, detail: detail.slice(0, 300) });
			return { delivered: false, provider: 'resend', reason: `HTTP_${res.status}` };
		}
		const body = (await res.json().catch(() => ({}))) as { id?: string };
		log.info('email_sent', { to: message.to, subject: message.subject, id: body.id });
		return { delivered: true, provider: 'resend', id: body.id };
	} catch (err) {
		log.error('email_send_error', { to: message.to, error: (err as Error)?.message });
		return { delivered: false, provider: 'resend', reason: 'NETWORK_ERROR' };
	}
}

/* ------------------------------------------------------------- templates ---- */

const WRAPPER = (title: string, body: string, cta?: { label: string; url: string }) => `
<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
	<div style="max-width:520px;margin:0 auto;padding:32px 20px">
		<div style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:20px">Makutano <span style="color:#4f7df3">Connect</span></div>
		<div style="background:#fff;border-radius:14px;padding:28px;border:1px solid #e6eaf2">
			<h1 style="margin:0 0 12px;font-size:17px;color:#1e293b">${title}</h1>
			<div style="font-size:14px;line-height:1.6;color:#54607a">${body}</div>
			${
				cta
					? `<a href="${cta.url}" style="display:inline-block;margin-top:20px;background:#4f7df3;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:600">${cta.label}</a>
			<p style="margin-top:18px;font-size:12px;color:#94a3b8;word-break:break-all">Or paste this link into your browser:<br>${cta.url}</p>`
					: ''
			}
		</div>
		<p style="margin-top:18px;font-size:11px;color:#94a3b8">You received this because someone used this address to sign up for Makutano Connect. If that was not you, no action is needed.</p>
	</div>
</body></html>`;

export function verificationEmail(link: string, expiresInHours: number): Omit<OutboundEmail, 'to'> {
	return {
		subject: 'Confirm your email · Makutano Connect',
		html: WRAPPER(
			'Confirm your email address',
			`Click the button below to confirm this address and finish setting up your account. The link expires in ${expiresInHours} hours and can only be used once.`,
			{ label: 'Confirm email', url: link }
		),
		text: `Confirm your email address to finish setting up your Makutano Connect account.\n\n${link}\n\nThis link expires in ${expiresInHours} hours and can only be used once.`
	};
}

/**
 * Sent when someone submits the signup form with an address that already has a working
 * account. It carries no token — the real owner is simply pointed at sign-in — so the
 * signup form cannot be used to mail live credentials to a stranger's inbox.
 */
export function existingAccountEmail(signInUrl: string, resetUrl: string): Omit<OutboundEmail, 'to'> {
	return {
		subject: 'You already have a Makutano Connect account',
		html: WRAPPER(
			'You already have an account',
			'Someone just tried to sign up with this email address. There is already an account here, so nothing has changed. Sign in below — and if the password has slipped your mind, you can reset it.',
			{ label: 'Sign in', url: signInUrl }
		) + `<div style="max-width:520px;margin:-20px auto 0;padding:0 20px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><p style="font-size:12px;color:#94a3b8">Forgot your password? <a href="${resetUrl}" style="color:#4f7df3">Reset it here</a>.</p></div>`,
		text: `Someone just tried to sign up for Makutano Connect with this email address. You already have an account, so nothing has changed.\n\nSign in: ${signInUrl}\nForgot your password: ${resetUrl}\n\nIf this was not you, you can safely ignore this email.`
	};
}

export function passwordResetEmail(link: string, expiresInHours: number): Omit<OutboundEmail, 'to'> {
	return {
		subject: 'Reset your password · Makutano Connect',
		html: WRAPPER(
			'Reset your password',
			`Use the button below to choose a new password. The link expires in ${expiresInHours} hour(s) and can only be used once. If you did not ask for this, ignore this email — your password stays unchanged.`,
			{ label: 'Choose a new password', url: link }
		),
		text: `Reset your Makutano Connect password:\n\n${link}\n\nThis link expires in ${expiresInHours} hour(s) and can only be used once. If you did not request it, ignore this email.`
	};
}
