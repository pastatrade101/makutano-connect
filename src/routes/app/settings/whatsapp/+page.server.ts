import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { toAppError } from '$lib/server/errors';
import { can } from '$lib/server/entitlements';
import { embeddedSignupReady } from '$lib/server/env';
import { enqueue } from '$lib/server/jobs/queue';
import { disconnect, getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { listTemplates, setTemplateEvent, TEMPLATE_EVENTS } from '$lib/server/whatsapp/templates';
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
			return { pack: { submitted: result.submitted.length, skipped: result.skippedExisting.length, failed: result.failed.length } };
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

	sync: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		await enqueue('whatsapp.templates.sync', { tenantId: requireTenant(locals).id }, { tenantId: requireTenant(locals).id });
		return { success: true, queued: true };
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
