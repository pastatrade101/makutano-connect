// Settings → Team (§1): the office roster. Everything here is members:read/write
// gated server-side; the UI merely reflects it.
import { fail, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import {
	changeRole,
	teamWorkload,
	inviteMember,
	listTeam,
	PERMISSION_GROUPS,
	removeMember,
	resendInvite,
	resetPermissions,
	ROLE_OPTIONS,
	setMemberActive,
	setPermissionOverrides
} from '$lib/server/team';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantPermission(locals, 'members:read');
	const tenantId = requireTenant(locals).id;
	const [team, workload] = await Promise.all([listTeam(tenantId), teamWorkload(tenantId)]);
	return {
		workload,
		team,
		roleOptions: ROLE_OPTIONS,
		permissionGroups: PERMISSION_GROUPS,
		canManage: locals.permissions.includes('members:write'),
		myUserId: locals.user!.id
	};
};

export const actions: Actions = {
	invite: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			// The link and the delivery result both come back and both go to the page.
			// They were being discarded, so the admin saw "Invitation sent" whether or
			// not this deployment can send mail at all, and never got the link that
			// would have let them pass it on by WhatsApp instead.
			const result = await inviteMember(requireTenant(locals).id, {
				fullName: String(data.get('fullName') ?? ''),
				email: String(data.get('email') ?? ''),
				role: String(data.get('role') ?? 'SALES') as never,
				invitedByUserId: locals.user!.id
			});
			return { invited: true, inviteLink: result.inviteLink, emailed: result.emailed };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	resendInvite: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			const result = await resendInvite(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				{ userId: locals.user!.id }
			);
			return {
				resent: true,
				inviteLink: result.inviteLink,
				emailed: result.emailed,
				resentTo: result.email
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	role: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			await changeRole(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				String(data.get('role')) as never,
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	permissions: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			const overrides = JSON.parse(String(data.get('overrides') ?? '{}')) as Record<string, boolean>;
			await setPermissionOverrides(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				overrides,
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	resetPermissions: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			await resetPermissions(requireTenant(locals).id, parseUuid(String(data.get('membershipId') ?? ''), 'membership id'), {
				userId: locals.user!.id
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	setActive: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			await setMemberActive(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				String(data.get('active')) === '1',
				{ userId: locals.user!.id },
				{ reassignToUserId: String(data.get('reassignTo') ?? '') || null }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	remove: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'members:write');
		const data = await request.formData();
		try {
			await removeMember(requireTenant(locals).id, parseUuid(String(data.get('membershipId') ?? ''), 'membership id'), {
				userId: locals.user!.id
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
