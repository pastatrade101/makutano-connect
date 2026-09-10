import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { toAppError } from '$lib/server/errors';
import { can } from '$lib/server/entitlements';
import { embeddedSignupReady } from '$lib/server/env';
import { enqueue } from '$lib/server/jobs/queue';
import { disconnect, getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { listTemplates, setTemplateEvent, syncTemplates, TEMPLATE_EVENTS } from '$lib/server/whatsapp/templates';
import { applyTemplatePack, packNeedsSetup, packState, PACK_VERSION } from '$lib/server/whatsapp/template-packs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantPermission(locals, 'whatsapp:read');
	const tenantId = requireTenant(locals).id;
	const [connection, templates, enabled] = await Promise.all([
		getConnectionForTenant(tenantId),
		listTemplates(tenantId),
		can(tenantId, 'whatsapp.enabled')
	]);
	const tenant = requireTenant(locals);
	const pack = packState(tenant.settings as Record<string, unknown>);
	return {
		templatePack: pack,
		packNeedsSetup: packNeedsSetup({
			pack,
			templateCount: templates.length,
			liveWabaId: connection?.wabaId ?? null
		}),
		// The version the code ships, so the page can tell "never set up" from
		// "set up, but there are newer templates since".
		packVersion: PACK_VERSION,
		connection: connection ? toSafeConnection(connection) : null,
		templates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			language: t.language,
			status: t.status,
			category: t.category,
			eventKey: t.eventKey,
			lastSyncedAt: t.lastSyncedAt
		})),
		templateEvents: TEMPLATE_EVENTS,
		signupReady: embeddedSignupReady(),
		featureEnabled: enabled
	};
};

export const actions: Actions = {
	/** One tap: draft + submit the workspace-relevant template pack to this WABA. */
	setupTemplates: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:templates');
		try {
			const result = await applyTemplatePack(requireTenant(locals).id, { userId: locals.user!.id });
			return {
				pack: {
					submitted: result.submitted.length,
					skipped: result.skippedExisting.length,
					failed: result.failed.length
				}
			};
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	disconnect: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const connection = await disconnect(requireTenant(locals).id);
		if (!connection) return fail(404, { message: 'No WhatsApp connection to disconnect.' });
		await audit(
			requireTenant(locals).id,
			'whatsapp.disconnected',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'whatsapp_connection', id: connection.id }
		);
		return { success: true };
	},

	/**
	 * Sync, and say what actually happened.
	 *
	 * This used to enqueue a job and return { success: true } unconditionally — so it
	 * reported success whether the sync found twelve templates, found none, or never
	 * ran at all because the tenant has no WABA (syncTemplates returns 0 for that,
	 * quietly). An operator whose templates were stuck pressed this, was told it
	 * worked, and watched nothing change, with no way to tell the difference between
	 * "Meta says they are still pending" and "we never asked Meta anything".
	 *
	 * It is one Graph GET, so it is awaited rather than queued: the answer is worth
	 * more than the few hundred milliseconds.
	 */
	sync: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const tenantId = requireTenant(locals).id;
		try {
			const count = await syncTemplates(tenantId);
			if (count === 0) {
				return {
					success: true,
					notice:
						'Meta returned no templates for this number. Nothing here was changed — templates that have never been submitted stay as they are.'
				};
			}
			return { success: true, notice: `Synced ${count} template${count === 1 ? '' : 's'} from Meta.` };
		} catch (err) {
			return fail(502, { message: toAppError(err).message });
		}
	},

	mapTemplate: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		const templateId = String(data.get('templateId') ?? '');
		const eventKey = String(data.get('eventKey') ?? '') || null;
		await setTemplateEvent(requireTenant(locals).id, templateId, eventKey as never);
		return { success: true };
	}
};
