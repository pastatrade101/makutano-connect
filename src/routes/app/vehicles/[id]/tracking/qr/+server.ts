// The setup code as a QR image.
//
// Sensitive enrollment material: no-store, no referrer, and the same explicit
// guard as everything else here. Served as SVG so it stays crisp on the screen a
// driver is pointing a camera at.
import { requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { errorResponse, toAppError } from '$lib/server/errors';
import { canShowCode, configurationUri, enrollmentFor } from '$lib/server/tracking/enrollment';
import type { ProfileKey } from '$lib/server/tracking/enrollment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const tenant = requireTenantPermission(locals, 'vehicles:read');
		requirePermission(locals.permissions, 'vehicles:write');

		const { pending } = await enrollmentFor(tenant.id, params.id);
		/*
		 * PROVISIONED and unexpired, for this tenant's own vehicle. Everything
		 * else — still being prepared, activated, cancelled, expired, replaced,
		 * failed, or another tenant's — is a 404 with no hint that anything ever
		 * existed here.
		 *
		 * A refresh returns the SAME code, because the code lives on the ledger
		 * row rather than being minted per request. Reloading a page must never
		 * mint a second tracker identity.
		 */
		if (!canShowCode(pending)) return new Response('No setup in progress.', { status: 404 });

		const { toString } = await import('qrcode');
		const svg = await toString(configurationUri(pending.deviceRef, pending.profile as ProfileKey), {
			type: 'svg',
			// The driver is photographing a screen, often outdoors. Q tolerates a
			// quarter of the symbol being lost to glare or a thumb.
			errorCorrectionLevel: 'Q',
			margin: 1,
			width: 320
		});

		return new Response(svg, {
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'no-store, private',
				'Referrer-Policy': 'no-referrer'
			}
		});
	} catch (err) {
		return errorResponse(toAppError(err), locals.requestId);
	}
};
