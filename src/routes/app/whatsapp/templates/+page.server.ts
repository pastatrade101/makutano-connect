import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { eq, and } from 'drizzle-orm';
import { requirePermission } from '$lib/server/auth/permissions';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { enqueue } from '$lib/server/jobs/queue';
import { listTemplates } from '$lib/server/whatsapp/templates';
import {
	createTemplateDraft,
	NOTIFY_EVENTS,
	submitTemplateToMeta,
	TEMPLATE_VARIABLES
} from '$lib/server/whatsapp/template-engine';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantPermission(locals, 'whatsapp:read');
	const templates = await listTemplates(requireTenant(locals).id);
	return {
		templates,
		events: NOTIFY_EVENTS,
		variables: Object.entries(TEMPLATE_VARIABLES).map(([key, v]) => ({ key, label: v.label }))
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		try {
			let buttons: Array<{ type: 'QUICK_REPLY' | 'URL'; text: string; url?: string }> = [];
			const buttonsRaw = String(data.get('buttons') ?? '').trim();
			if (buttonsRaw) {
				// One per line: "Quick reply text" or "Button text | https://url"
				buttons = buttonsRaw
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
					.slice(0, 3)
					.map((line) => {
						const [text, url] = line.split('|').map((s) => s.trim());
						return url ? { type: 'URL' as const, text, url } : { type: 'QUICK_REPLY' as const, text };
					});
			}
			await createTemplateDraft(requireTenant(locals).id, {
				name: String(data.get('name') ?? ''),
				language: String(data.get('language') ?? 'en'),
				category: String(data.get('category') ?? 'UTILITY') as 'UTILITY' | 'MARKETING',
				headerText: String(data.get('headerText') ?? '') || null,
				bodyText: String(data.get('bodyText') ?? ''),
				footerText: String(data.get('footerText') ?? '') || null,
				buttons,
				eventKey: (String(data.get('eventKey') ?? '') || null) as never
			});
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	submit: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		try {
			await submitTemplateToMeta(requireTenant(locals).id, String(data.get('id') ?? ''));
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	map: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		await db()
			.update(schema.whatsappTemplates)
			.set({ eventKey: String(data.get('eventKey') ?? '') || null, updatedAt: new Date() })
			.where(and(eq(schema.whatsappTemplates.id, String(data.get('id') ?? '')), eq(schema.whatsappTemplates.tenantId, requireTenant(locals).id)));
		return { success: true };
	},

	toggle: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		const data = await request.formData();
		await db()
			.update(schema.whatsappTemplates)
			.set({ enabled: String(data.get('enabled')) === 'true', updatedAt: new Date() })
			.where(and(eq(schema.whatsappTemplates.id, String(data.get('id') ?? '')), eq(schema.whatsappTemplates.tenantId, requireTenant(locals).id)));
		return { success: true };
	},

	sync: async ({ locals }) => {
		requirePermission(locals.permissions, 'whatsapp:connect');
		await enqueue('whatsapp.templates.sync', { tenantId: requireTenant(locals).id }, { tenantId: requireTenant(locals).id });
		return { success: true };
	}
};
