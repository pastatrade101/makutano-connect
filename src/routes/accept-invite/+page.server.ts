// Invitation acceptance (§2): single-use tenant-bound token → membership activated.
// A brand-new invitee sets their password here; an existing account just signs in.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { hashPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { consumeInviteToken } from '$lib/server/auth/verification';
import { db, schema } from '$lib/server/db';
import { checkPassword } from '$lib/server/signup';
import { getTenantById } from '$lib/server/tenants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// Presence check only — the token is spent on submit, so email scanners that
	// prefetch the link cannot burn the invitation.
	return { hasToken: !!url.searchParams.get('token') };
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
	default: async (event) => {
		const data = await event.request.formData();
		const token = String(data.get('token') ?? '');
		const password = String(data.get('password') ?? '');
		const confirm = String(data.get('confirmPassword') ?? '');

		const invite = await consumeInviteToken(token);
		if (!invite) return fail(400, { message: 'This invitation link has expired or was already used. Ask for a new one.' });
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
	}
};
