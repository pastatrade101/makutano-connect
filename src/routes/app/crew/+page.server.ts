import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { can } from '$lib/server/auth/permissions';
import { createCrew, listCrew, updateCrew } from '$lib/server/crew';
import { AppError } from '$lib/server/errors';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import type { Actions, PageServerLoad } from './$types';
import type { Crew } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'trips'
	);
	requireTenantPermission(locals, 'crew:read');
	const rows = await listCrew(requireTenant(locals).id);
	return {
		workspaceRelevant,
		crew: rows,
		canWrite: can(locals.permissions, 'crew:write')
	};
};

const asFailure = (error: unknown) =>
	error instanceof AppError
		? fail(400, { error: error.message })
		: fail(500, { error: 'Something went wrong. Please try again.' });

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requireTenantPermission(locals, 'crew:write');
		const tenantId = requireTenant(locals).id;
		const form = await request.formData();
		const text = (k: string) => String(form.get(k) ?? '').trim() || null;
		try {
			const row = await createCrew(tenantId, {
				type: (String(form.get('type') ?? 'DRIVER') as Crew['type']) || 'DRIVER',
				name: String(form.get('name') ?? ''),
				phone: text('phone'),
				licenceNumber: text('licenceNumber')
			});
			await audit(
				tenantId,
				'crew.created',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'crew', id: row.id },
				{ after: { name: row.name, type: row.type } }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	toggle: async ({ locals, request }) => {
		requireTenantPermission(locals, 'crew:write');
		const tenantId = requireTenant(locals).id;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const isActive = form.get('isActive') === 'on';
		try {
			// Deactivated, never deleted: a trip that ran last year still names the
			// driver who ran it.
			await updateCrew(tenantId, id, { isActive });
			await audit(
				tenantId,
				'crew.updated',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'crew', id },
				{ after: { isActive } }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	}
};
