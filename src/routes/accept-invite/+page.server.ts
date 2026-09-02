// Invitation acceptance (§2): single-use tenant-bound token → membership activated.
// A brand-new invitee sets their password here; an existing account just signs in.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { hashPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { consumeInviteToken, inviteTokenOwner } from '$lib/server/auth/verification';
import { db, schema } from '$lib/server/db';
import { limitResend } from '$lib/server/signup';
import { checkPassword } from '$lib/server/signup';
import { resendInviteToUser } from '$lib/server/team';
import { emailReady } from '$lib/server/env';
import { toAppError } from '$lib/server/errors';
import { getTenantById } from '$lib/server/tenants';
import type { PageServerLoad } from './$types';

/** Show only enough of an address to recognise it: a****@example.com. */
function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!domain) return email;
	return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token');
	if (!token) return { state: 'missing' as const, email: null, emailConfigured: emailReady() };

	/*
	 * Read-only, never consuming. The token is still spent on submit, so an email
	 * scanner prefetching this page cannot burn the invitation.
	 *
	 * The point of looking at all is that a DEAD link used to render the ordinary
	 * form with an error inside it, so the only button on screen resubmitted the
	 * same dead token forever. Knowing it is dead lets the page say so and offer
	 * the one thing that helps.
	 */
	const owner = await inviteTokenOwner(token);
	if (!owner) return { state: 'unknown' as const, email: null, emailConfigured: emailReady() };

	const dead = !!owner.consumedAt || owner.expiresAt.getTime() <= Date.now();
	return {
		state: dead ? ('dead' as const) : ('live' as const),
		email: maskEmail(owner.user.email),
		emailConfigured: emailReady()
	};
};

async function activate(userId: string, tenantId: string) {
	const [membership] = await db()
		.update(schema.tenantMemberships)
		.set({ acceptedAt: new Date(), disabledAt: null, updatedAt: new Date() })
		.where(and(eq(schema.tenantMemberships.userId, userId), eq(schema.tenantMemberships.tenantId, tenantId)))
		.returning();
	return membership ?? null;
}

export const actions: Actions = {
	accept: async (event) => {
		const data = await event.request.formData();
		const token = String(data.get('token') ?? '');
		const password = String(data.get('password') ?? '');
		const confirm = String(data.get('confirmPassword') ?? '');

		const invite = await consumeInviteToken(token);
		if (!invite) return fail(400, { dead: true, message: 'This invitation link has expired or was already used.' });
		const { user, tenantId } = invite;

		// New accounts choose a password now; existing accounts keep theirs.
		if (!user.passwordHash) {
			if (!password) return fail(400, { needsPassword: true, message: 'Choose a password to finish setting up your account.' });
			if (password !== confirm) return fail(400, { needsPassword: true, message: 'Those passwords do not match.' });
			const strength = checkPassword(password, user.email);
			if (!strength.ok) return fail(400, { needsPassword: true, message: strength.message });
			await db()
				.update(schema.users)
				.set({ passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date(), updatedAt: new Date() })
				.where(eq(schema.users.id, user.id));
		} else if (!user.emailVerifiedAt) {
			// Receiving the invite email proves the address.
			await db().update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
		}

		const membership = await activate(user.id, tenantId);
		if (!membership) return fail(400, { message: 'This invitation is no longer valid — the seat may have been removed.' });

		await audit(tenantId, 'user.invite_accepted', { type: 'user', userId: user.id, ipHash: event.locals.ipHash }, { type: 'user', id: user.id }, {
			role: membership.role
		});

		const session = await createSession(user.id, {
			activeTenantId: tenantId,
			userAgent: event.request.headers.get('user-agent'),
			ipHash: event.locals.ipHash
		});
		setSessionCookie(event.cookies, session.token, session.expiresAt);
		const tenant = await getTenantById(tenantId);
		return { accepted: true, tenantName: tenant?.name ?? 'the team' };
	},

	/**
	 * "Send me a new link", pressed by whoever is holding a dead invitation.
	 *
	 * Safe without authentication because it is gated on POSSESSION of a real
	 * TEAM_INVITE token: the caller cannot name an address, and the fresh link is
	 * emailed to the invited address whatever they do. A leaked stale link
	 * therefore buys an attacker nothing but sending mail to the rightful
	 * recipient — which is why the two rate limits below exist.
	 *
	 * The reply is deliberately identical whether or not anything was sent. A seat
	 * that was removed, an invitation already accepted and a live token all say the
	 * same sentence, so this cannot be used to learn who is on which team.
	 */
	requestNewLink: async (event) => {
		const data = await event.request.formData();
		const owner = await inviteTokenOwner(String(data.get('token') ?? ''));
		const done = { requested: true } as const;
		if (!owner) return done;

		try {
			await limitResend(owner.user.id);
			await limitResend(event.locals.ipHash ?? 'unknown');
		} catch (err) {
			if (toAppError(err).code === 'RATE_LIMITED') {
				return fail(429, {
					message: 'A new link was requested recently. Please wait a little before trying again.'
				});
			}
			return fail(500, { message: 'Could not send a new link right now.' });
		}

		await resendInviteToUser(owner.tenantId, owner.user.id);
		return done;
	}
};
