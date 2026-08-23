// A blocked account deserves a straight answer, not a generic 403 on every click.
import { redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { and, desc, eq } from 'drizzle-orm';
import { membershipsForUser } from '$lib/server/tenants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');

	const memberships = await membershipsForUser(locals.user.id);
	const tenant = memberships.find((m) => m.tenant.id === locals.tenant?.id)?.tenant ?? memberships[0]?.tenant;
	if (!tenant) redirect(303, '/app');

	// Only PENDING/SUSPENDED/CANCELLED belong here; anyone else gets their portal back.
	if (tenant.status === 'ACTIVE' || tenant.status === 'TRIAL') redirect(303, '/app');

	const subscription = (
		await db()
			.select()
			.from(schema.subscriptions)
			.where(eq(schema.subscriptions.tenantId, tenant.id))
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
	)[0];

	const owner = (
		await db()
			.select({ email: schema.users.email, fullName: schema.users.fullName })
			.from(schema.tenantMemberships)
			.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
			.where(and(eq(schema.tenantMemberships.tenantId, tenant.id), eq(schema.tenantMemberships.role, 'OWNER')))
			.limit(1)
	)[0];

	return {
		tenant: { name: tenant.name, status: tenant.status },
		subscriptionStatus: subscription?.status ?? null,
		isOwner: owner?.email === locals.user.email
	};
};
