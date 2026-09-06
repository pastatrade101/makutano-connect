// Trusted server-to-server page-view ingestion. The public browser never receives
// the shared secret, and it cannot name a tenant: only a published public slug.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { AppError } from '$lib/server/errors';
import { recordMarketplacePageView } from '$lib/server/marketplace-analytics';
import { handlePublic, requireTrustedOrigin } from '$lib/server/public-api';

const bodySchema = z
	.object({
		kind: z.enum(['TOUR', 'PROFILE']),
		slug: z
			.string()
			.trim()
			.min(1)
			.max(120)
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
		sessionId: z.string().trim().min(20).max(160)
	})
	.strict();

export const POST: RequestHandler = async (event) =>
	handlePublic(event, { scope: 'pub-marketplace-view', limit: 240, windowSeconds: 60 }, async () => {
		requireTrustedOrigin(event);
		const parsed = bodySchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid view event.');
		await recordMarketplacePageView(parsed.data);
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	});
