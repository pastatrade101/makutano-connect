import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { can } from '$lib/server/auth/permissions';
import { createCrew, getCrew, listCrew, updateCrew } from '$lib/server/crew';
import {
	changeRole,
	inviteMember as inviteUser,
	listTeam,
	PERMISSION_GROUPS,
	removeMember,
	resendInvite,
	resetPermissions,
	ROLE_OPTIONS,
	setMemberActive,
	setPermissionOverrides,
	teamWorkload
} from '$lib/server/team';
import { parseUuid } from '$lib/server/http';
import { inviteMember } from '$lib/server/team';
import { AppError } from '$lib/server/errors';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';
import { sendEventTemplate } from '$lib/server/whatsapp/template-engine';
import { normalizePhone } from '$lib/server/phone';
import { log } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';
import type { Crew } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const workspaceRelevant = moduleRelevant(
		normalizeWorkspace((locals.tenant?.settings as Record<string, unknown>)?.capabilities),
		'trips'
	);
	/*
	 * One page, two halves, each behind its OWN permission.
	 *
	 * Guarding the page on members:read would take it away from drivers: CREW is
	 * ['trips:read','trips:write','crew:read'] — the only role in the matrix
	 * without members:read — and every role including VIEWER has crew:read. So the
	 * page is reachable on crew:read, and the app-access half simply is not built
	 * for somebody who may not see it. A section the viewer cannot have is absent,
	 * not disabled: an empty table they cannot explain is worse than no table.
	 */
	requireTenantPermission(locals, 'crew:read');
	const tenantId = requireTenant(locals).id;
	const seesUsers = can(locals.permissions, 'members:read');

	const [rows, team, workload] = await Promise.all([
		listCrew(tenantId),
		seesUsers ? listTeam(tenantId) : Promise.resolve([]),
		seesUsers
			? teamWorkload(tenantId)
			: Promise.resolve({ open_total: 0, open_unassigned: 0, replies_today: 0 })
	]);

	return {
		workspaceRelevant,
		crew: rows,
		canWrite: can(locals.permissions, 'crew:write'),
		// Giving somebody a login is a different decision from writing down who
		// drives, and a different permission. Only OWNER and ADMIN hold it.
		canInvite: can(locals.permissions, 'members:write'),
		seesUsers,
		team,
		workload,
		canManageUsers: can(locals.permissions, 'members:write'),
		roleOptions: ROLE_OPTIONS,
		permissionGroups: PERMISSION_GROUPS,
		myUserId: locals.user!.id
	};
};

/** How a crew role reads in a message to the person themselves. */
const CREW_ROLE_LABEL: Record<Crew['type'], string> = {
	DRIVER: 'a driver',
	GUIDE: 'a guide',
	SPECIALIST: 'a specialist'
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
	 * Give a driver, guide or specialist the app.
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
			// Then WhatsApp, which is where these people actually are.
			//
			// This is best-effort on purpose: the account already exists and the
			// link is already returned below, so a WABA that is not connected, a
			// crew_invite template Meta has not approved yet, or a number that is
			// not on WhatsApp must not turn a successful invite into an error.
			// The UI says which of those happened rather than claiming a send.
			const tenant = requireTenant(locals);
			const phone = normalizePhone(person.phone, (tenant.settings as Record<string, unknown>)?.country as string);
			let whatsapp: 'sent' | 'no_phone' | 'not_delivered' = phone ? 'not_delivered' : 'no_phone';
			if (phone) {
				try {
					const sent = await sendEventTemplate(
						tenantId,
						'CREW_INVITE',
						phone,
						{
							business: { name: tenant.name },
							crew: { name: person.name, roleLabel: CREW_ROLE_LABEL[person.type] },
							invite: { link: invited.inviteLink }
						},
						// One send per issued invite: re-inviting mints a new token and
						// so deserves a new message, but a double-submit must not.
						`crew-invite:${id}:${invited.userId}`
					);
					if (sent) whatsapp = 'sent';
				} catch (err) {
					log.warn('crew_invite_whatsapp_failed', { tenantId, error: (err as Error)?.message });
				}
			}

			// Hand the link back regardless. WhatsApp is the best channel, not a
			// guaranteed one, and a link nobody can copy is a dead end.
			return {
				success: true,
				invite: {
					name: person.name,
					phone: person.phone,
					link: invited.inviteLink,
					emailed: invited.emailed,
					email,
					whatsapp
				}
			};
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
,

	/* ----------------------------------------------------- app access ----- */
	//
	// Moved here from /app/settings/team so that "who works here" is one page
	// rather than two, under two different parts of the nav. Every one of these
	// gates on members:write, which only OWNER and ADMIN hold — a Manager can add
	// a driver to the roster but cannot hand anyone a login.

	inviteUser: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			const result = await inviteUser(requireTenant(locals).id, {
				fullName: String(data.get('fullName') ?? ''),
				email: String(data.get('email') ?? ''),
				role: String(data.get('role') ?? 'SALES') as never,
				invitedByUserId: locals.user!.id
			});
			return { invited: true, inviteLink: result.inviteLink, emailed: result.emailed };
		} catch (error) {
			return asFailure(error);
		}
	},

	resendInvite: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
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
		} catch (error) {
			return asFailure(error);
		}
	},

	role: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			await changeRole(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				String(data.get('role') ?? '') as never,
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	permissions: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			// Only the keys the form actually carried: an absent group must mean
			// "unchanged", never "revoke everything in it".
			const overrides: Record<string, boolean> = {};
			for (const [key, value] of data.entries()) {
				if (key.startsWith('perm:')) overrides[key.slice(5)] = value === 'on' || value === 'true';
			}
			await setPermissionOverrides(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				overrides,
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	resetPermissions: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			await resetPermissions(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	setActive: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			await setMemberActive(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				String(data.get('active') ?? '') === '1',
				{ userId: locals.user!.id },
				// Deactivating hands the person's open conversations somewhere, or
				// they are simply unassigned. The option, not a bare id.
				{ reassignToUserId: String(data.get('reassignTo') ?? '') || null }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	},

	removeUser: async ({ locals, request }) => {
		requireTenantPermission(locals, 'members:write');
		const data = await request.formData();
		try {
			await removeMember(
				requireTenant(locals).id,
				parseUuid(String(data.get('membershipId') ?? ''), 'membership id'),
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (error) {
			return asFailure(error);
		}
	}
};