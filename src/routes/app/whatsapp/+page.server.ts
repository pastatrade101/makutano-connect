import { fail, type Actions } from '@sveltejs/kit';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { can } from '$lib/server/entitlements';
import { embeddedSignupReady } from '$lib/server/env';
import { enqueue } from '$lib/server/jobs/queue';
import { disconnect, getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import { listTemplates, setTemplateEvent, TEMPLATE_EVENTS } from '$lib/server/whatsapp/templates';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePermission(locals.permissions, 'whatsapp:read');
	const tenantId = locals.tenant!.id;
	const [connection, templates, enabled] = await Promise.all([
		getConnectionForTenant(tenantId),
		listTemplates(tenantId),
		can(tenantId, 'whatsapp.enabled')
	]);
	return {
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
	disconnect: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const connection = await disconnect(locals.tenant!.id);
		if (!connection) return fail(404, { message: 'No WhatsApp connection to disconnect.' });
		await audit(
			locals.tenant!.id,
			'whatsapp.disconnected',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'whatsapp_connection', id: connection.id }
		);
		return { success: true };
	},

	sync: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		await enqueue('whatsapp.templates.sync', { tenantId: locals.tenant!.id }, { tenantId: locals.tenant!.id });
		return { success: true, queued: true };
	},

	mapTemplate: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		const templateId = String(data.get('templateId') ?? '');
		const eventKey = String(data.get('eventKey') ?? '') || null;
		await setTemplateEvent(locals.tenant!.id, templateId, eventKey as never);
		return { success: true };
	}
};
