// §4 invisible provisioning: an admin creates the tenant, assigns a plan and generates
// credentials. The client never registers.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { createApiKey } from '$lib/server/api-keys';
import { DEFAULT_PLANS } from '$lib/server/billing';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { setActiveTenant } from '$lib/server/auth/session';
import { provisionTenant } from '$lib/server/provisioning';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const tenants = await db()
		.select({
			tenant: schema.tenants,
			plan: schema.plans,
			requests: sql<number>`(select count(*) from booking_requests br where br.tenant_id = tenants.id)::int`,
			whatsapp: sql<
				string | null
			>`(select status::text from whatsapp_connections wc where wc.tenant_id = tenants.id limit 1)`,
			// Who owns this tenant, and did they arrive through signup or through us?
			ownerEmail: sql<string | null>`(
				select u.email from tenant_memberships tm
				join users u on u.id = tm.user_id
				where tm.tenant_id = tenants.id and tm.role = 'OWNER'
				order by tm.created_at limit 1
			)`,
			ownerVerified: sql<boolean | null>`(
				select u.email_verified_at is not null from tenant_memberships tm
				join users u on u.id = tm.user_id
				where tm.tenant_id = tenants.id and tm.role = 'OWNER'
				order by tm.created_at limit 1
			)`,
			// The operator's public mark and marketplace standing. Both are one join
			// away and neither was on a page called "Operators".
			logoUrl: sql<string | null>`(
				select m.url from operator_profiles p
				left join media m on m.id = p.logo_media_id
				where p.tenant_id = tenants.id limit 1
			)`,
			marketplaceVerified: sql<boolean | null>`(
				select p.is_verified from operator_profiles p where p.tenant_id = tenants.id limit 1
			)`,
			subscriptionStatus: sql<string | null>`(
				select s.status::text from subscriptions s
				where s.tenant_id = tenants.id order by s.created_at desc limit 1
			)`
		})
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.where(isNull(schema.tenants.deletedAt))
		.orderBy(desc(schema.tenants.createdAt));

	const source = url.searchParams.get('source')?.trim().toUpperCase() ?? '';
	const filtered = tenants
		.filter(
			(t) =>
				!q ||
				t.tenant.name.toLowerCase().includes(q) ||
				t.tenant.slug.toLowerCase().includes(q) ||
				(t.ownerEmail ?? '').toLowerCase().includes(q)
		)
		.filter((t) => !source || t.tenant.provisioningSource === source);

	const plans = await db().select().from(schema.plans).orderBy(schema.plans.sortOrder);
	return {
		tenants: filtered,
		q,
		source,
		plans: plans.length ? plans : DEFAULT_PLANS.map((p) => ({ ...p, id: p.code }))
	};
};

export const actions: Actions = {
	delete: async ({ locals, request }) => {
		const data = await request.formData();
		try {
			const { deleteTenant } = await import('$lib/server/admin/control-plane');
			const tenant = await deleteTenant(String(data.get('id') ?? ''), String(data.get('confirmSlug') ?? ''), {
				userId: locals.user!.id,
				requestId: locals.requestId
			});
			return { deleted: tenant.name };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	create: async ({ locals, request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const ownerEmail = String(data.get('ownerEmail') ?? '')
			.trim()
			.toLowerCase();
		if (!name) return fail(400, { message: 'Business name is required.' });

		try {
			// Exactly the same service the public signup uses — only the source and the
			// lifecycle differ (an admin-created tenant is ACTIVE from the first second).
			const { tenant, temporaryPassword } = await provisionTenant({
				name,
				slug: String(data.get('slug') ?? '') || name,
				planCode: String(data.get('planCode') ?? 'STARTER'),
				source: 'ADMIN',
				owner: ownerEmail ? { kind: 'email', email: ownerEmail } : undefined,
				country: String(data.get('country') ?? '') || null,
				currency: String(data.get('currency') ?? 'USD'),
				timezone: String(data.get('timezone') ?? 'Africa/Dar_es_Salaam'),
				bookingReferencePrefix: String(data.get('prefix') ?? '') || undefined,
				actor: { type: 'user', userId: locals.user!.id, ipHash: locals.ipHash, requestId: locals.requestId }
			});

			const key = await createApiKey({
				tenantId: tenant.id,
				name: 'Website integration',
				createdByUserId: locals.user!.id
			});

			// Credentials are surfaced once, right here — there is no way to read them back.
			return {
				created: {
					tenantId: tenant.id,
					name: tenant.name,
					slug: tenant.slug,
					apiKey: key.secret,
					ownerEmail: ownerEmail || null,
					temporaryPassword
				}
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Open a tenant's portal as a super admin. The tenant is written to the SESSION,
	 * never carried in a URL — so the elevated view still flows through the same
	 * resolveTenantForUser() check as everyone else, and is audited like any change.
	 */
	openPortal: async ({ locals, request }) => {
		const data = await request.formData();
		const tenantId = String(data.get('id') ?? '');
		const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
		if (!tenant) return fail(404, { message: 'Tenant not found.' });
		await setActiveTenant(locals.session!.sessionId, tenant.id);
		await audit(
			tenant.id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: tenant.id },
			{ action: 'super_admin_opened_portal' }
		);
		redirect(303, '/app');
	},

	setStatus: async ({ locals, request }) => {
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const status = String(data.get('status') ?? 'ACTIVE') as 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'TRIAL';
		await db().update(schema.tenants).set({ status, updatedAt: new Date() }).where(eq(schema.tenants.id, id));
		await audit(
			id,
			status === 'SUSPENDED' ? 'tenant.suspended' : 'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id }
		);
		return { success: true };
	}
};
