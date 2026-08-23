import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { createCustomer, listCustomers } from '$lib/server/customers';
import { toAppError } from '$lib/server/errors';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'customers:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listCustomers(requireTenant(locals).id, pagination);
	return { items, total, pagination, openNew: url.searchParams.get('new') === '1' };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'customers:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'What is the customer called?' });
		const [firstName, ...rest] = name.split(/\s+/);
		const phone = String(data.get('phone') ?? '').trim() || undefined;
		try {
			await createCustomer(
				tenant.id,
				{
					firstName,
					lastName: rest.join(' '),
					phone,
					whatsappPhone: phone,
					email: String(data.get('email') ?? '').trim() || undefined,
					source: 'ADMIN'
				},
				tenant.country
			);
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
		redirect(303, '/app/customers');
	}
};
