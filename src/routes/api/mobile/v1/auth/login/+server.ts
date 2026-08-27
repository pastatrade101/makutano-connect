// Sign in from the app. Issues the same session a browser gets — the token simply
// travels in a header instead of a cookie, so revoking it anywhere revokes it here.
import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession } from '$lib/server/auth/session';
import { effectivePermissions } from '$lib/server/auth/permissions';
import { normalizeWorkspace } from '$lib/workspace';
import { personaFor } from '$lib/server/attention';
import { log } from '$lib/server/logger';

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
		.where(and(eq(schema.tenantMemberships.userId, user.id)))
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
