// §4 invisible provisioning: an admin creates the tenant, assigns a plan and generates
// credentials. The client never registers.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { createApiKey } from '$lib/server/api-keys';
import { hashPassword } from '$lib/server/auth/password';
import { DEFAULT_PLANS } from '$lib/server/billing';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { setActiveTenant } from '$lib/server/auth/session';
import { provisionTenant, slugify } from '$lib/server/tenants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const tenants = await db()
		.select({
			tenant: schema.tenants,
			plan: schema.plans,
			requests: sql<number>`(select count(*) from booking_requests br where br.tenant_id = ${schema.tenants.id})::int`,
			whatsapp: sql<
				string | null
			>`(select status::text from whatsapp_connections wc where wc.tenant_id = ${schema.tenants.id} limit 1)`
		})
		.from(schema.tenants)
		.leftJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
		.orderBy(desc(schema.tenants.createdAt));

	const filtered = q
		? tenants.filter((t) => t.tenant.name.toLowerCase().includes(q) || t.tenant.slug.toLowerCase().includes(q))
		: tenants;

	const plans = await db().select().from(schema.plans).orderBy(schema.plans.sortOrder);
	return { tenants: filtered, q, plans: plans.length ? plans : DEFAULT_PLANS.map((p) => ({ ...p, id: p.code })) };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const ownerEmail = String(data.get('ownerEmail') ?? '')
			.trim()
			.toLowerCase();
		if (!name) return fail(400, { message: 'Business name is required.' });

		try {
			const tenant = await provisionTenant({
				name,
				slug: slugify(String(data.get('slug') ?? '') || name),
				planCode: String(data.get('planCode') ?? 'STARTER'),
				country:
					String(data.get('country') ?? '')
						.toUpperCase()
						.slice(0, 2) || undefined,
				currency: String(data.get('currency') ?? 'USD')
					.toUpperCase()
					.slice(0, 3),
				timezone: String(data.get('timezone') ?? 'Africa/Dar_es_Salaam'),
				bookingReferencePrefix: String(data.get('prefix') ?? '') || undefined
			});

			// Optional owner account, created with a temporary password the admin passes on.
			let temporaryPassword: string | null = null;
			if (ownerEmail) {
				const existing = (await db().select().from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1))[0];
				let userId = existing?.id;
				if (!userId) {
					temporaryPassword = `mk-${crypto.randomUUID().slice(0, 12)}`;
					const [created] = await db()
						.insert(schema.users)
						.values({ email: ownerEmail, passwordHash: await hashPassword(temporaryPassword), fullName: '' })
						.returning({ id: schema.users.id });
					userId = created.id;
				}
				await db()
					.insert(schema.tenantMemberships)
					.values({ tenantId: tenant.id, userId, role: 'OWNER', acceptedAt: new Date() })
					.onConflictDoNothing();
				await audit(tenant.id, 'user.invited', { type: 'user', userId: locals.user!.id }, { type: 'user', id: userId });
			}

			const key = await createApiKey({
				tenantId: tenant.id,
				name: 'Website integration',
				createdByUserId: locals.user!.id
			});
			await audit(
				tenant.id,
				'tenant.created',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'tenant', id: tenant.id },
				{ name }
			);

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
