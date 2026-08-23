import { redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { approachingLimits, effectiveEntitlements } from '$lib/server/entitlements';
import { membershipsForUser } from '$lib/server/tenants';
import { pathForStage, stageForUser } from '$lib/server/signup';
import { normalizeWorkspace } from '$lib/workspace';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	if (!locals.tenant) {
		// A super admin with no tenant selected belongs in the admin area, not here.
		if (locals.user.isSuperAdmin) redirect(303, '/admin');
		// Everyone else is mid-signup: send them to the step they have not finished.
		redirect(303, pathForStage(await stageForUser(locals.user)));
	}
	// A blocked account gets one honest explanation instead of a wall of failed actions.
	// Super admins are exempt: inspecting a suspended tenant's portal is exactly how
	// support works out what went wrong, and reads were never the thing being blocked.
	const blocked = ['SUSPENDED', 'CANCELLED', 'PENDING'].includes(locals.tenant.status);
	if (blocked && !locals.user.isSuperAdmin) redirect(303, '/suspended');

	const [unread, memberships, entitlements, nearLimits, trialEndsAt] = await Promise.all([
		db()
			.select({ id: schema.notifications.id })
			.from(schema.notifications)
			.where(
				and(
					eq(schema.notifications.tenantId, locals.tenant.id),
					eq(schema.notifications.channel, 'IN_APP'),
					isNull(schema.notifications.readAt)
				)
			)
			.limit(50),
		membershipsForUser(locals.user.id),
		effectiveEntitlements(locals.tenant.id),
		approachingLimits(locals.tenant.id),
		db()
			.select({ trialEndsAt: schema.subscriptions.trialEndsAt })
			.from(schema.subscriptions)
			.where(eq(schema.subscriptions.tenantId, locals.tenant.id))
			.limit(1)
			.then((rows) => rows[0]?.trialEndsAt ?? null)
	]);

	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			fullName: locals.user.fullName,
			isSuperAdmin: locals.user.isSuperAdmin
		},
		tenant: {
			id: locals.tenant.id,
			name: locals.tenant.name,
			slug: locals.tenant.slug,
			timezone: locals.tenant.timezone,
			currency: locals.tenant.currency,
			capabilities: normalizeWorkspace((locals.tenant.settings as Record<string, unknown>)?.capabilities)
		},
		role: locals.role,
		permissions: locals.permissions,
		unreadCount: unread.length,
		// Presentation only — every one of these is independently enforced server-side.
		entitlements: Object.fromEntries(Object.values(entitlements.resolved).map((r) => [r.key, r.effective])),
		planName: entitlements.planName,
		tenantSuspended: entitlements.tenantStatus === 'SUSPENDED',
		trial:
			entitlements.tenantStatus === 'TRIAL' || entitlements.subscriptionStatus === 'TRIALING'
				? { endsAt: trialEndsAt?.toISOString() ?? null }
				: null,
		nearLimits: nearLimits.map((l) => ({ label: l.label, used: l.used, limit: l.limit, percent: l.percent })),
		tenants: memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name }))
	};
};
