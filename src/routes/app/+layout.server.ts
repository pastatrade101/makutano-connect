import { redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { approachingLimits, effectiveEntitlements } from '$lib/server/entitlements';
import { membershipsForUser } from '$lib/server/tenants';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	if (!locals.tenant) {
		// A super admin with no tenant selected belongs in the admin area, not here.
		redirect(303, locals.user.isSuperAdmin ? '/admin' : '/login');
	}

	const [unread, memberships, entitlements, nearLimits] = await Promise.all([
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
		approachingLimits(locals.tenant.id)
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
			capabilities: String((locals.tenant.settings as Record<string, unknown>)?.capabilities ?? 'BOTH') as
				| 'BOOKINGS'
				| 'ORDERS'
				| 'BOTH'
		},
		role: locals.role,
		permissions: locals.permissions,
		unreadCount: unread.length,
		// Presentation only — every one of these is independently enforced server-side.
		entitlements: Object.fromEntries(Object.values(entitlements.resolved).map((r) => [r.key, r.effective])),
		planName: entitlements.planName,
		tenantSuspended: entitlements.tenantStatus === 'SUSPENDED',
		nearLimits: nearLimits.map((l) => ({ label: l.label, used: l.used, limit: l.limit, percent: l.percent })),
		tenants: memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name }))
	};
};
