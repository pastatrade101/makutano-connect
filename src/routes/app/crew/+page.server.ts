import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { can } from '$lib/server/auth/permissions';
import { createCrew, getCrew, listCrew, updateCrew } from '$lib/server/crew';
import { inviteMember } from '$lib/server/team';
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
		canWrite: can(locals.permissions, 'crew:write'),
		// Inviting is a members:write act, not a crew one — giving somebody a login
		// is a different decision from writing down who drives.
		canInvite: can(locals.permissions, 'members:write')
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

	/**
	 * Give a driver or guide the app.
	 *
	 * They become a CREW member — the one role whose reads are row-limited, so
	 * they see the trips they are personally on and nothing else. Requires an
	 * email and consumes a plan seat, which is exactly why crew are NOT users by
	 * default: most of them never need this.
	 */
	invite: async ({ locals, request }) => {
		requireTenantPermission(locals, 'crew:write');
		requireTenantPermission(locals, 'members:write');
		const tenantId = requireTenant(locals).id;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const email = String(form.get('email') ?? '').trim();
		try {
			const person = await getCrew(tenantId, id);
			const invited = await inviteMember(tenantId, {
				fullName: person.name,
				email,
				role: 'CREW',
				invitedByUserId: locals.user!.id
			});
			// Link the account back to the crew record — that link is what the trip
			// scope resolves, so without it they would log in and see nothing.
			await updateCrew(tenantId, id, { email, userId: invited.userId ?? null });
			await audit(
				tenantId,
				'crew.updated',
				{ type: 'user', userId: locals.user?.id },
				{ type: 'crew', id },
				{ after: { invitedAs: 'CREW', email } }
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
