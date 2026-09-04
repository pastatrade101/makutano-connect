// Live fleet positions, for the map's poll.
//
// Guarded here explicitly: a +server.ts does not run parent layout loads, so
// nothing above this file protects it. One provider call for the whole fleet,
// scoped by the provider to this tenant's devices.
import { json } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { errorResponse, toAppError } from '$lib/server/errors';
import { listVehicles } from '$lib/server/vehicles';
import { fleetSnapshot, TRACKING_LABEL, trackingEnabled, type TrackingState } from '$lib/server/tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	try {
		const vehicles = await listVehicles(tenant.id);
		const live = trackingEnabled() ? await fleetSnapshot(tenant.id) : new Map();

		return json(
			{
				success: true,
				data: {
					// When the SERVER last asked. The age of a fix and the age of our
					// knowledge are different numbers and the UI shows them apart.
					checkedAt: new Date().toISOString(),
					vehicles: vehicles.map((v) => {
						const snap = live.get(v.id);
						const state: TrackingState = !v.trackerDeviceRef
							? 'NOT_CONFIGURED'
							: (snap?.state ?? 'NOT_CONFIGURED');
						return {
							id: v.id,
							state,
							label: TRACKING_LABEL[state],
							recordedAt: snap?.position?.recordedAt ?? null,
							speedKph: snap?.position?.speedKph ?? null,
							latitude: snap?.position?.latitude ?? null,
							longitude: snap?.position?.longitude ?? null
						};
					})
				}
			},
			{ headers: { 'Cache-Control': 'no-store, private' } }
		);
	} catch (err) {
		return errorResponse(toAppError(err), locals.requestId);
	}
};
