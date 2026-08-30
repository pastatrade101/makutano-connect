import { fail } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { can } from '$lib/server/auth/permissions';
import { createCrew, getCrew, listCrew, updateCrew } from '$lib/server/crew';
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
};
