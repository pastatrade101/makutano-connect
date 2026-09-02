import { fail, type Actions } from '@sveltejs/kit';
import { listPlans, updatePlan } from '$lib/server/admin/control-plane';
import { ENTITLEMENTS } from '$lib/server/entitlements';
import { toAppError } from '$lib/server/errors';
import { db, schema } from '$lib/server/db';
import { eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const plans = await listPlans();
	const counts = (await db().execute(sql`
		select p.id, count(t.id)::int as tenants
		from plans p left join tenants t on t.plan_id = p.id and t.deleted_at is null
		group by p.id
	`)) as unknown as Array<{ id: string; tenants: number }>;
	const tenantsByPlan = Object.fromEntries(counts.map((c) => [c.id, Number(c.tenants)]));
	return { plans, entitlements: ENTITLEMENTS, tenantsByPlan };
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const data = await request.formData();
		const planId = String(data.get('planId') ?? '');
		const entitlements: Record<string, boolean | number> = {};
		for (const definition of ENTITLEMENTS) {
			if (definition.kind === 'boolean') {
				entitlements[definition.key] = data.get(`e_${definition.key}`) === 'on';
			} else {
				/*
				 * An empty field means "not set", not "zero".
				 *
				 * 0 means UNLIMITED here (see isUnlimited), and this loop ran over EVERY
				 * entitlement on every save while updatePlan REPLACES the object rather
				 * than merging it. So a key the form did not carry was written as 0, and
				 * one click on Save to correct a plan's PRICE could quietly grant that
				 * plan unlimited API throughput. Skipping leaves the key absent, and the
				 * registry fallback applies as it is meant to.
				 */
				const raw = data.get(`e_${definition.key}`);
				if (raw === null || String(raw).trim() === '') continue;
				const n = Number(raw);
				if (!Number.isFinite(n) || n < 0) {
					return fail(400, { message: `${definition.label} must be a number of zero or more.` });
				}
				entitlements[definition.key] = n;
			}
		}
		try {
			await updatePlan(
				planId,
				{
					name: String(data.get('name') ?? ''),
					isActive: data.get('isActive') === 'on',
					priceMonthly: String(data.get('priceMonthly') ?? '0').trim(),
					currency: String(data.get('currency') ?? 'USD')
						.trim()
						.toUpperCase(),
					entitlements
				},
				{ userId: locals.user!.id, requestId: locals.requestId }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
