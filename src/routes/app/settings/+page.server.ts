import { fail, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { effectivePlan, invalidatePlanCache, currentPeriod, usageFor } from '$lib/server/billing';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePermission(locals.permissions, 'tenant:read');
	const tenantId = locals.tenant!.id;

	const [plan, members, apiRequests, waOut, requests] = await Promise.all([
		effectivePlan(tenantId),
		db()
			.select({ membership: schema.tenantMemberships, user: schema.users })
			.from(schema.tenantMemberships)
			.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
			.where(eq(schema.tenantMemberships.tenantId, tenantId)),
		usageFor(tenantId, 'api_requests'),
		usageFor(tenantId, 'whatsapp_outbound'),
		usageFor(tenantId, 'booking_requests')
	]);

	return {
		settings: {
			capabilities: String((locals.tenant!.settings as Record<string, unknown>)?.capabilities ?? 'BOTH'),
			name: locals.tenant!.name,
			slug: locals.tenant!.slug,
			timezone: locals.tenant!.timezone,
			currency: locals.tenant!.currency,
			country: locals.tenant!.country,
			locale: locals.tenant!.locale,
			logoUrl: locals.tenant!.logoUrl,
			bookingReferencePrefix: locals.tenant!.bookingReferencePrefix,
			quotationPrefix: locals.tenant!.quotationPrefix
		},
		plan,
		period: currentPeriod(),
		usage: { apiRequests, whatsappOutbound: waOut, bookingRequests: requests },
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
		await db()
			.update(schema.tenants)
			.set({
				settings: {
					...((locals.tenant!.settings as Record<string, unknown>) ?? {}),
					capabilities: ['BOOKINGS', 'ORDERS', 'BOTH'].includes(capabilities) ? capabilities : 'BOTH'
				},
				name,
				timezone: String(data.get('timezone') ?? locals.tenant!.timezone),
				currency: String(data.get('currency') ?? locals.tenant!.currency)
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
			.where(eq(schema.tenants.id, locals.tenant!.id));

		invalidatePlanCache(locals.tenant!.id);
		await audit(
			locals.tenant!.id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: locals.tenant!.id }
		);
		return { success: true };
	}
};
