// Remove one image from a listing.
import type { RequestHandler } from './$types';
import { getTourDetail, setTourGallery, updateTour } from '$lib/server/tours';
import { deleteMedia } from '$lib/server/media';
import { handle, ok, requireApiScope } from '$lib/server/http';

export const DELETE: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const tourId = event.params.id!;
		const mediaId = event.params.mediaId!;

		const detail = await getTourDetail(ctx.tenantId, tourId);

		// If this image was the hero, clear that first — a tour pointing at a
		// deleted image is a broken card on a public page.
		if (detail.tour.heroMediaId === mediaId) {
			await updateTour(ctx.tenantId, tourId, { heroMediaId: null }, { apiKeyId: ctx.apiKeyId });
		}

		// Drop the gallery link, then the asset. deleteMedia is scoped to this
		// tenant inside its own delete, so another tenant's id simply is not found.
		const remaining = detail.gallery.filter((m) => m.id !== mediaId).map((m) => m.id);
		await setTourGallery(ctx.tenantId, tourId, remaining, { apiKeyId: ctx.apiKeyId });
		await deleteMedia(mediaId, { kind: 'tenant', tenantId: ctx.tenantId });

		return ok({ deleted: true });
	});
