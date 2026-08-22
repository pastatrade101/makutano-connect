import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// Super admin is a property of the user, never of a tenant membership (§3).
	if (!locals.user.isSuperAdmin) error(403, 'This area is restricted.');
	return { user: { id: locals.user.id, email: locals.user.email, fullName: locals.user.fullName, isSuperAdmin: true } };
};
