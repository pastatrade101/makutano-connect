import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { currentPeriod } from '$lib/server/billing';
import { effectiveEntitlements, invalidateEntitlements, usageSummary } from '$lib/server/entitlements';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'tenant:read');
	const tenantId = requireTenant(locals).id;

	const [ent, usage, members] = await Promise.all([
		effectiveEntitlements(tenantId),
		usageSummary(tenantId),
		db()
			.select({ membership: schema.tenantMemberships, user: schema.users })
			.from(schema.tenantMemberships)
			.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
			.where(eq(schema.tenantMemberships.tenantId, tenantId)),
	]);

	return {
		settings: {
			capabilities: String((tenant.settings as Record<string, unknown>)?.capabilities ?? 'BOTH'),
			name: tenant.name,
			slug: tenant.slug,
			timezone: tenant.timezone,
			currency: tenant.currency,
			country: tenant.country,
			locale: tenant.locale,
			logoUrl: tenant.logoUrl,
			bookingReferencePrefix: tenant.bookingReferencePrefix,
			quotationPrefix: tenant.quotationPrefix
		},
		plan: { code: ent.planCode, name: ent.planName, status: ent.subscriptionStatus },
		period: currentPeriod(),
		// Used / limit for every metered entitlement, so the tenant sees headroom.
		usage: usage.map((u) => ({ label: u.label, used: u.used, limit: u.unlimited ? null : u.limit, percent: u.percent })),
		members: members.map((m) => ({
			id: m.membership.id,
			role: m.membership.role,
			email: m.user.email,
			fullName: m.user.fullName
		}))
	};
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Business name is required.' });

		const capabilities = String(data.get('capabilities') ?? 'BOTH');
		const tenant = requireTenant(locals);
		await db()
			.update(schema.tenants)
			.set({
				settings: {
					...((tenant.settings as Record<string, unknown>) ?? {}),
					capabilities: ['BOOKINGS', 'ORDERS', 'BOTH'].includes(capabilities) ? capabilities : 'BOTH'
				},
				name,
				timezone: String(data.get('timezone') ?? tenant.timezone),
				currency: String(data.get('currency') ?? tenant.currency)
					.toUpperCase()
					.slice(0, 3),
				country:
					String(data.get('country') ?? '')
						.toUpperCase()
						.slice(0, 2) || null,
				locale: String(data.get('locale') ?? 'en'),
				logoUrl: String(data.get('logoUrl') ?? '') || null,
				// Changing a prefix only affects NEW references; existing ones are immutable.
				bookingReferencePrefix:
					String(data.get('bookingReferencePrefix') ?? 'MKT')
						.toUpperCase()
						.replace(/[^A-Z0-9]/g, '')
						.slice(0, 8) || 'MKT',
				quotationPrefix:
					String(data.get('quotationPrefix') ?? 'QT')
						.toUpperCase()
						.replace(/[^A-Z0-9]/g, '')
						.slice(0, 8) || 'QT',
				updatedAt: new Date()
			})
			.where(eq(schema.tenants.id, requireTenant(locals).id));

		invalidateEntitlements(requireTenant(locals).id);
		await audit(
			requireTenant(locals).id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: requireTenant(locals).id }
		);
		return { success: true };
	}
};
