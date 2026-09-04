// Setting up tracking for one vehicle.
//
// Every action guards INSIDE itself. A layout load does not protect a form
// action, and a +server.ts does not run parent layout loads at all — a lesson
// this codebase has already paid for once.
import { fail } from '@sveltejs/kit';
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { toAppError } from '$lib/server/errors';
import { getVehicle } from '$lib/server/vehicles';
import {
	cancelEnrollment,
	configurationUri,
	enrollmentFor,
	extendEnrollment,
	PHONE_EXPIRY_MS,
	PROFILES,
	removeTracking,
	startEnrollment,
	type ProfileKey
} from '$lib/server/tracking/enrollment';
import { trackingEnabled } from '$lib/server/tracking';
import type { Actions, PageServerLoad } from './$types';

/** Read AND write: setting up a tracker changes what a vehicle is. */
function guard(locals: App.Locals) {
	const tenant = requireTenantPermission(locals, 'vehicles:read');
	requirePermission(locals.permissions, 'vehicles:write');
	return tenant;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const tenant = guard(locals);
	const vehicle = await getVehicle(tenant.id, params.id);
	const { active, pending, expired } = await enrollmentFor(tenant.id, params.id);

	return {
		trackingEnabled: trackingEnabled(),
		vehicle: { id: vehicle.id, name: vehicle.name, registration: vehicle.registration },
		profiles: Object.entries(PROFILES).map(([key, p]) => ({ key, label: p.label })),
		expiryMinutes: Math.round(PHONE_EXPIRY_MS / 60000),
		active: active
			? { id: active.id, label: active.label, boundAt: active.boundAt, since: active.createdAt }
			: null,
		expiredJustNow: Boolean(expired),
		/*
		 * The setup code and its QR are rendered ONCE, by this load, to the one
		 * authenticated operator who asked for it. The polling endpoint returns
		 * status only — re-serving the credential every three seconds would be six
		 * hundred redistributions of it per enrollment.
		 */
		pending: pending
			? {
					id: pending.id,
					deviceRef: pending.deviceRef,
					configurationUri: configurationUri(pending.deviceRef, pending.profile as ProfileKey),
					expiresAt: pending.expiresAt,
					profile: pending.profile
				}
			: null
	};
};

export const actions: Actions = {
	start: async ({ locals, params, request }) => {
		const tenant = guard(locals);
		const data = await request.formData();
		try {
			await startEnrollment({
				tenantId: tenant.id,
				vehicleId: params.id,
				userId: locals.user!.id,
				profile: (String(data.get('profile') ?? 'SAFARI') as ProfileKey),
				label: String(data.get('label') ?? '').trim() || null
			});
			return { started: true };
		} catch (err) {
			return fail(toAppError(err).status, { message: toAppError(err).message });
		}
	},

	cancel: async ({ locals, params, request }) => {
		const tenant = guard(locals);
		const data = await request.formData();
		await cancelEnrollment(tenant.id, String(data.get('enrollmentId') ?? ''));
		return { cancelled: true };
	},

	extend: async ({ locals, params, request }) => {
		const tenant = guard(locals);
		const data = await request.formData();
		try {
			await extendEnrollment(tenant.id, String(data.get('enrollmentId') ?? ''));
			return { extended: true };
		} catch (err) {
			return fail(toAppError(err).status, { message: toAppError(err).message });
		}
	},

	remove: async ({ locals, params }) => {
		const tenant = guard(locals);
		await removeTracking(tenant.id, params.id);
		return { removed: true };
	}
};
