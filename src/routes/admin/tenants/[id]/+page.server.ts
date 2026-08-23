import { error, fail, type Actions } from '@sveltejs/kit';
import {
	changeTenantPlan,
	clearEntitlementOverride,
	setEntitlementOverride,
	setTenantStatus,
	tenantControlCenter,
	updateSubscription
} from '$lib/server/admin/control-plane';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { audit } from '$lib/server/audit';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'tenant id');

export const load: PageServerLoad = async ({ params }) => {
	try {
		return await tenantControlCenter(idOf(params));
	} catch {
		error(404, 'Tenant not found');
	}
};

export const actions: Actions = {
	/** Change the tenant's workspace (§18). UI relevance only — never entitlements. */
	workspace: async ({ locals, params, request }) => {
		const data = await request.formData();
		const value = String(data.get('workspace') ?? '');
		if (!['BOOKINGS', 'ORDERS', 'SERVICE', 'HYBRID'].includes(value)) {
			return fail(400, { message: 'Invalid workspace.' });
		}
		const tenantId = parseUuid(params.id ?? '', 'tenant id');
		try {
			const before = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
			if (!before) return fail(404, { message: 'Tenant not found.' });
			await db()
				.update(schema.tenants)
				.set({
					settings: sql`jsonb_set(coalesce(${schema.tenants.settings}, '{}'::jsonb), '{capabilities}', to_jsonb(${value}::text), true)`,
					updatedAt: new Date()
				})
				.where(eq(schema.tenants.id, tenantId));
			await audit(
				tenantId,
				'tenant.updated',
				{ type: 'user', userId: locals.user!.id, requestId: locals.requestId },
				{ type: 'tenant', id: tenantId },
				{ workspace: { from: (before.settings as Record<string, unknown>)?.capabilities ?? null, to: value } }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	status: async ({ locals, params, request }) => {
		const data = await request.formData();
		try {
			await setTenantStatus(
				idOf(params),
				String(data.get('status')) as never,
				{ userId: locals.user!.id, requestId: locals.requestId },
				String(data.get('reason') ?? '') || undefined
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	plan: async ({ locals, params, request }) => {
		const data = await request.formData();
		try {
			await changeTenantPlan(idOf(params), String(data.get('planId') ?? ''), { userId: locals.user!.id, requestId: locals.requestId });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	subscription: async ({ locals, params, request }) => {
		const data = await request.formData();
		try {
			await updateSubscription(
				idOf(params),
				{
					status: (String(data.get('status') ?? '') || undefined) as never,
					extendDays: Number(data.get('extendDays') ?? 0) || undefined
				},
				{ userId: locals.user!.id, requestId: locals.requestId }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	override: async ({ locals, params, request }) => {
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const kind = String(data.get('kind') ?? 'number');
		const raw = String(data.get('value') ?? '');
		try {
			await setEntitlementOverride(
				idOf(params),
				key,
				kind === 'boolean' ? raw === 'true' : Number(raw),
				{ userId: locals.user!.id, requestId: locals.requestId }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	resetOverride: async ({ locals, params, request }) => {
		const data = await request.formData();
		try {
			await clearEntitlementOverride(idOf(params), String(data.get('key') ?? ''), { userId: locals.user!.id, requestId: locals.requestId });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
