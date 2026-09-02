// Sign in from the app. Issues the same session a browser gets — the token simply
// travels in a header instead of a cookie, so revoking it anywhere revokes it here.
import { json, type RequestHandler } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession } from '$lib/server/auth/session';
import { effectivePermissions } from '$lib/server/auth/permissions';
import { normalizeWorkspace } from '$lib/workspace';
import { personaFor } from '$lib/server/attention';
import { log } from '$lib/server/logger';
import { enforce } from '$lib/server/rate-limit';
import { toAppError } from '$lib/server/errors';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string; device?: string };
	const email = String(body.email ?? '')
		.trim()
		.toLowerCase();
	const password = String(body.password ?? '');

	if (!email || !password) {
		return json(
			{ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter your email and password.' } },
			{ status: 400 }
		);
	}

	/*
	 * The same brute-force ceiling the browser login has had all along.
	 *
	 * Without it this endpoint was an unthrottled password oracle against the very
	 * same users table — and a quieter one, because it answers in JSON and leaves
	 * no failed-login page in anyone's way. Keyed on the client, not globally, so
	 * one attacker cannot lock every operator out of their own app.
	 */
	try {
		await enforce(`mobile-login:${locals.ipHash ?? 'unknown'}`, 10, 300);
	} catch (err) {
		if (toAppError(err).code === 'RATE_LIMITED') {
			return json(
				{ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } },
				{ status: 429 }
			);
		}
		log.error('mobile_login_rate_limit_failed', { requestId: locals.requestId, message: (err as Error)?.message });
		return json(
			{ success: false, error: { code: 'INTERNAL_ERROR', message: 'Sign-in is temporarily unavailable.' } },
			{ status: 503 }
		);
	}


	const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
	const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
	if (!valid) {
		log.info('mobile_login_rejected', { email });
		return json(
			{ success: false, error: { code: 'UNAUTHORIZED', message: 'Those credentials did not work.' } },
			{ status: 401 }
		);
	}
	if (!user.emailVerifiedAt) {
		return json(
			{ success: false, error: { code: 'UNAUTHORIZED', message: 'Verify your email address first.' } },
			{ status: 401 }
		);
	}

	// The workspace this person actually belongs to — the app is single-tenant per login.
	const [membership] = await db()
		.select({
			tenant: schema.tenants,
			role: schema.tenantMemberships.role,
			overrides: schema.tenantMemberships.permissionOverrides
		})
		.from(schema.tenantMemberships)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
		/*
		 * A per-tenant deactivation removes ACCESS while history stays intact, and
		 * the browser path honours that (resolveTenantForUser filters disabledAt).
		 * This one did not, so somebody removed from a workspace kept a working app.
		 *
		 * Ordered as well as filtered: with two memberships the row returned was
		 * whichever Postgres felt like, so the same person could open the app into a
		 * different workspace on different days.
		 */
		.where(
			and(
				eq(schema.tenantMemberships.userId, user.id),
				isNull(schema.tenantMemberships.disabledAt),
				// membershipsForUser filters this too (tenants.ts). Without it a member of
				// a SOFT-DELETED workspace is refused in the browser and still gets a
				// working app — with that dead tenant written into their session.
				isNull(schema.tenants.deletedAt)
			)
		)
		.orderBy(asc(schema.tenantMemberships.createdAt))
		.limit(1);
	if (!membership) {
		return json(
			{ success: false, error: { code: 'TENANT_NOT_FOUND', message: 'This account has no workspace yet.' } },
			{ status: 404 }
		);
	}

	const { token, expiresAt } = await createSession(user.id, {
		activeTenantId: membership.tenant.id,
		userAgent: String(body.device ?? 'Makutano mobile').slice(0, 300),
		ipHash: locals.ipHash
	});
	const permissions = effectivePermissions(membership.role, membership.overrides);

	return json({
		success: true,
		data: {
			token,
			expiresAt: expiresAt.toISOString(),
			user: { id: user.id, name: user.fullName, email: user.email },
			tenant: {
				id: membership.tenant.id,
				name: membership.tenant.name,
				workspace: normalizeWorkspace((membership.tenant.settings as Record<string, unknown>)?.capabilities),
				currency: membership.tenant.currency
			},
			role: membership.role,
			persona: personaFor(permissions),
			permissions
		}
	});
};
