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

/* --------------------------------------------------- traveller templates ---- */

/**
 * Everything above this line is addressed to an OPERATOR, and wears Connect's
 * branding because that is the product they signed up to.
 *
 * A quotation is the other direction: it lands in a traveller's inbox, and that
 * person has never heard of Connect. They know the marketplace they browsed and
 * the operator they asked. So this wrapper carries Makutano Journeys' identity
 * and the operator's own name and logo, and Connect appears nowhere in it.
 */
const ACCENT = '#b4532a';
const INK = '#2b2b28';
const MUTED = '#6f6a63';

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Cormorant Garamond and Manrope are the marketplace's faces, and mail clients
 * will not load either. The stacks below degrade to a serif display face and a
 * system sans, which keeps the same shape — a quiet serif over plain text —
 * rather than pretending the webfonts arrived.
 */
const DISPLAY = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const BODY = "'Manrope', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

type OperatorBrand = { name: string; logoUrl?: string | null; location?: string | null; verified?: boolean };

const operatorHeader = (operator: OperatorBrand) => {
	const initials = operator.name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('');
	// A logo when there is one, initials when there is not. Never a broken image:
	// a missing crest in the header of a price is a bad first impression.
	const mark = operator.logoUrl
		? `<img src="${escapeHtml(operator.logoUrl)}" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border-radius:50%;object-fit:cover;border:1px solid #e7e2d9">`
		: `<div style="width:46px;height:46px;border-radius:50%;background:${ACCENT};color:#fff;font:600 16px/46px ${BODY};text-align:center">${escapeHtml(initials || 'M')}</div>`;
	return `
	<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
		<tr>
			<td width="46" style="padding-right:12px;vertical-align:middle">${mark}</td>
			<td style="vertical-align:middle">
				<div style="font:600 15px/1.3 ${BODY};color:${INK}">${escapeHtml(operator.name)}</div>
				<div style="font:400 12px/1.5 ${BODY};color:${MUTED}">${[
					operator.location ? escapeHtml(operator.location) : '',
					operator.verified ? 'Verified by Makutano Journeys' : ''
				]
					.filter(Boolean)
					.join(' · ')}</div>
			</td>
		</tr>
	</table>`;
};

const TRAVELLER_WRAPPER = (args: {
	preheader: string;
	operator: OperatorBrand;
	title: string;
	body: string;
	cta: { label: string; url: string };
	footnote?: string;
}) => `
<!doctype html><html><body style="margin:0;background:#f7f5f1;font-family:${BODY};-webkit-font-smoothing:antialiased">
	<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(args.preheader)}</div>
	<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f7f5f1">
		<tr><td align="center" style="padding:28px 16px 34px">
			<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:collapse">
				<tr><td style="padding-bottom:16px;text-align:center">
					<span style="font:600 20px/1 ${DISPLAY};color:${INK};letter-spacing:.4px">Makutano</span>
					<span style="font:400 20px/1 ${DISPLAY};color:${ACCENT};letter-spacing:.4px"> Journeys</span>
				</td></tr>
				<tr><td style="background:#fff;border:1px solid #e7e2d9;border-radius:16px;overflow:hidden">
					<div style="padding:20px 26px;border-bottom:1px solid #efeae1;background:#fdfcfa">${operatorHeader(args.operator)}</div>
					<div style="padding:28px 26px">
						<h1 style="margin:0 0 14px;font:400 26px/1.25 ${DISPLAY};color:${INK}">${escapeHtml(args.title)}</h1>
						<div style="font:400 14px/1.65 ${BODY};color:#4a453e">${args.body}</div>
						<div style="padding-top:24px">
							<a href="${args.cta.url}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font:600 14px/1 ${BODY}">${escapeHtml(args.cta.label)}</a>
						</div>
						<p style="margin:18px 0 0;font:400 12px/1.6 ${BODY};color:${MUTED};word-break:break-all">Or open this link:<br>${escapeHtml(args.cta.url)}</p>
					</div>
				</td></tr>
				<tr><td style="padding:16px 8px 0;text-align:center;font:400 11px/1.7 ${BODY};color:#9a9289">
					${args.footnote ? `${escapeHtml(args.footnote)}<br>` : ''}
					Makutano Journeys · Tanzania
				</td></tr>
			</table>
		</td></tr>
	</table>
</body></html>`;

/** The money line, rendered as a table so it survives Outlook. */
const quoteLines = (
	items: { title: string; quantity: number; unitPrice: string; total: string }[],
	currency: string,
	total: string
) => `
	<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0 4px">
		${items
			.map(
				(line) => `<tr>
			<td style="padding:9px 0;border-bottom:1px solid #efeae1;font:400 14px/1.5 ${BODY};color:${INK}">${escapeHtml(line.title)}${
				line.quantity > 1
					? `<div style="font:400 12px/1.5 ${BODY};color:${MUTED}">${line.quantity} × ${escapeHtml(currency)} ${escapeHtml(line.unitPrice)}</div>`
					: ''
			}</td>
			<td align="right" style="padding:9px 0;border-bottom:1px solid #efeae1;font:400 14px/1.5 ${BODY};color:${INK};white-space:nowrap">${escapeHtml(currency)} ${escapeHtml(line.total)}</td>
		</tr>`
			)
			.join('')}
		<tr>
			<td style="padding:14px 0 0;font:600 15px/1.4 ${BODY};color:${INK}">Total</td>
			<td align="right" style="padding:14px 0 0;font:700 18px/1.4 ${BODY};color:${ACCENT};white-space:nowrap">${escapeHtml(currency)} ${escapeHtml(total)}</td>
		</tr>
	</table>`;

export function quotationEmail(args: {
	operator: OperatorBrand;
	customerFirstName?: string | null;
	reference: string;
	currency: string;
	total: string;
	/** Line totals come from the server, never multiplied again here. */
	items: { title: string; quantity: number; unitPrice: string; total: string }[];
	notes?: string | null;
	validUntil?: Date | null;
	url: string;
}): Omit<OutboundEmail, 'to'> {
	const greeting = args.customerFirstName ? `Hello ${escapeHtml(args.customerFirstName)},` : 'Hello,';
	const trip = args.items[0]?.title ?? 'your trip';
	const expiry = args.validUntil
		? `<p style="margin:16px 0 0;font:400 13px/1.6 ${BODY};color:${MUTED}">This price holds until ${args.validUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`
		: '';

	const body = `
		<p style="margin:0 0 12px">${greeting}</p>
		<p style="margin:0">${escapeHtml(args.operator.name)} has priced ${escapeHtml(trip)} for you.</p>
		${quoteLines(args.items, args.currency, args.total)}
		${args.notes ? `<p style="margin:18px 0 0;padding:14px 16px;background:#faf8f4;border-radius:10px;font:400 13px/1.65 ${BODY};color:#4a453e">${escapeHtml(args.notes)}</p>` : ''}
		${expiry}`;

	return {
		subject: `Your quote from ${args.operator.name} — ${args.currency} ${args.total}`,
		html: TRAVELLER_WRAPPER({
			preheader: `${args.currency} ${args.total} for ${trip}`,
			operator: args.operator,
			title: 'Your trip, priced',
			body,
			cta: { label: 'View your quote', url: args.url },
			footnote: `Quote ${args.reference}`
		}),
		text: [
			greeting,
			'',
			`${args.operator.name} has priced ${trip} for you.`,
			'',
			...args.items.map((l) => `${l.title} — ${l.quantity} × ${args.currency} ${l.unitPrice}`),
			`Total: ${args.currency} ${args.total}`,
			...(args.notes ? ['', args.notes] : []),
			'',
			`View your quote: ${args.url}`,
			'',
			`Quote ${args.reference} · Makutano Journeys`
		].join('\n')
	};
}

/**
 * The review invitation.
 *
 * Same traveller-facing wrapper as the quotation: the reader met Makutano
 * Journeys and an operator, and has never heard of Connect. Deliberately short —
 * it asks one question and carries one link.
 */
export function reviewInviteEmail(args: {
	operator: OperatorBrand;
	customerFirstName?: string | null;
	tourTitle?: string | null;
	travelledOn?: string | null;
	url: string;
}): Omit<OutboundEmail, 'to'> {
	const greeting = args.customerFirstName ? `Hello ${escapeHtml(args.customerFirstName)},` : 'Hello,';
	const trip = args.tourTitle ?? 'your trip';
	const when = args.travelledOn ? ` in ${escapeHtml(args.travelledOn)}` : '';

	const body = `
		<p style="margin:0 0 12px">${greeting}</p>
		<p style="margin:0">You travelled with ${escapeHtml(args.operator.name)}${when}. Would you tell other
		travellers how it went? It takes a minute, and it is the most useful thing a future traveller reads.</p>
		<p style="margin:16px 0 0;font:400 13px/1.6 ${BODY};color:${MUTED}">
			Only people who actually travelled can review on Makutano Journeys, which is why this link is
			just for you. Please do not forward it.
		</p>`;

	return {
		subject: `How was ${trip}?`,
		html: TRAVELLER_WRAPPER({
			preheader: `Tell other travellers about ${trip}`,
			operator: args.operator,
			title: 'How was your journey?',
			body,
			cta: { label: 'Write your review', url: args.url },
			footnote: 'Only travellers who booked can review.'
		}),
		text: [
			greeting,
			'',
			`You travelled with ${args.operator.name}${args.travelledOn ? ` in ${args.travelledOn}` : ''}. Would you tell other travellers how it went?`,
			'',
			`Write your review: ${args.url}`,
			'',
			'This link is just for you — please do not forward it.',
			'Makutano Journeys'
		].join('\n')
	};
}
