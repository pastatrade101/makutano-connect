// Has the phone reported yet?
//
// Polled every few seconds while the setup screen is open, and it returns STATUS
// ONLY — never the reference, never the QR. The code is rendered once by the
// page load; re-serving it on a three-second timer would redistribute the
// credential hundreds of times per enrollment.
//
// The guard is written out here deliberately: a +server.ts does not run parent
// layout loads, so nothing above this file protects it.
import { json } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { errorResponse, toAppError } from '$lib/server/errors';
import { checkForFirstFix, enrollmentFor } from '$lib/server/tracking/enrollment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		requirePermission(locals.permissions, 'vehicles:write');

		const { active, pending } = await enrollmentFor(tenant.id, params.id);
		if (active) return json({ success: true, data: { status: 'ACTIVE', firstFixAt: active.firstFixAt } });
		if (!pending) return json({ success: true, data: { status: 'NONE' } });

		const result = await checkForFirstFix(tenant.id, pending.id);
		return json({ success: true, data: result }, { headers: { 'Cache-Control': 'no-store, private' } });
	} catch (err) {
		return errorResponse(toAppError(err), locals.requestId);
	}
};
