import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { env } from '$lib/server/env';
import { toAppError } from '$lib/server/errors';
import { createForm, FORM_FIELD_CATALOG, getForm, listForms, regeneratePublicId, updateForm } from '$lib/server/forms';
import { listTours } from '$lib/server/tours';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantPermission(locals, 'forms:read');
	const tenantId = requireTenant(locals).id;
	const formsList = await listForms(tenantId);
	/*
	 * Published tours only, for the shareable link builder.
	 *
	 * A link pointing at a draft would render a form with no trip on it — the
	 * public page refuses to show an unpublished tour, and rightly — so the
	 * builder must not offer one.
	 */
	const tours = await listTours(tenantId, { page: 1, limit: 200, order: 'asc' }, { status: ['PUBLISHED'] }).catch(() => ({ items: [] as { title: string; slug: string }[] }));
	return {
		forms: formsList,
		tours: (tours.items ?? []).map((t) => ({ title: t.title, slug: t.slug })),
		fieldCatalog: FORM_FIELD_CATALOG,
		baseUrl: env().PUBLIC_APP_URL.replace(/\/+$/, '')
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'forms:write');
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const type = String(data.get('type') ?? 'BOOKING') as 'BOOKING' | 'ORDER' | 'QUOTE' | 'LEAD';
		if (!name) return fail(400, { message: 'Give the form a name.' });
		try {
			const created = await createForm(requireTenant(locals).id, { type, name });
			await audit(requireTenant(locals).id, 'form.created', { type: 'user', userId: locals.user!.id }, { type: 'form', id: created.id });
			return { success: true, editId: created.id };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	save: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'forms:write');
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		try {
			const form = await getForm(requireTenant(locals).id, id);
			const fields: Record<string, { enabled: boolean; required: boolean }> = {};
			for (const def of FORM_FIELD_CATALOG[form.type]) {
				fields[def.key] = {
					enabled: data.get(`field_${def.key}`) === 'on',
					required: data.get(`required_${def.key}`) === 'on'
				};
			}
			await updateForm(requireTenant(locals).id, id, {
				name: String(data.get('name') ?? form.name),
				heading: String(data.get('heading') ?? '') || null,
				description: String(data.get('description') ?? '') || null,
				ctaText: String(data.get('ctaText') ?? '') || null,
				successMessage: String(data.get('successMessage') ?? '') || null,
				fields,
				allowedOrigins: String(data.get('allowedOrigins') ?? '')
					.split(/[\n,]/)
					.map((s) => s.trim())
					.filter(Boolean),
				branding: { accentColor: String(data.get('accentColor') ?? '') || undefined }
			});
			await audit(requireTenant(locals).id, 'form.updated', { type: 'user', userId: locals.user!.id }, { type: 'form', id });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	toggle: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'forms:write');
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		await updateForm(requireTenant(locals).id, id, { isActive: String(data.get('isActive')) === 'true' });
		return { success: true };
	},

	regenerate: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'forms:write');
		const data = await request.formData();
		await regeneratePublicId(requireTenant(locals).id, String(data.get('id') ?? ''));
		await audit(requireTenant(locals).id, 'form.updated', { type: 'user', userId: locals.user!.id }, { type: 'form', id: String(data.get('id')) }, { action: 'public_id_regenerated' });
		return { success: true };
	}
};
