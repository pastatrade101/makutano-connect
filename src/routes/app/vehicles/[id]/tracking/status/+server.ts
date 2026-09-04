// Enrollment status, answered from the ledger alone.
//
// This endpoint used to ask the tracking provider whether the phone had reported
// yet, on a three-second timer, from the public request-serving process. First-fix
// detection now belongs to the worker, which writes the answer into the row — so
// this reads one table and makes NO provider call at all.
//
// Two consequences worth stating: a provider outage cannot make the setup screen
// hang, and the web process needs no provider credential of any kind to render
// enrollment status.
//
// The guard is written out here deliberately: a +server.ts does not run parent
// layout loads, so nothing above this file protects it.
import { json } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { errorResponse, toAppError } from '$lib/server/errors';
import { enrollmentStatus } from '$lib/server/tracking/enrollment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		requirePermission(locals.permissions, 'vehicles:write');

		// Scoped to this tenant AND this vehicle, so another tenant's vehicle id
		// resolves to NONE rather than to somebody else's enrollment.
		const state = await enrollmentStatus(tenant.id, params.id);
		// Never the reference, never the QR — the code is rendered once by the page
		// load, and a poll that re-served it would redistribute the credential
		// hundreds of times per enrollment.
		return json({ success: true, data: state }, { headers: { 'Cache-Control': 'no-store, private' } });
	} catch (err) {
		return errorResponse(toAppError(err), locals.requestId);
	}
};
