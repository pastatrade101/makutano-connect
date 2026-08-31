// A listing's photographs.
//
// Bytes are proxied through here rather than uploaded straight to R2 from the
// browser: minting a signed write URL would put a bucket credential in a page,
// and the object key has to be generated from the RESOLVED owner, never from a
// path the client chose.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getTourDetail, setTourGallery } from '$lib/server/tours';
import { MAX_BYTES, publicMedia, uploadMedia } from '$lib/server/media';
import { AppError } from '$lib/server/errors';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

const ORDER = z.object({ mediaIds: z.array(z.string().uuid()).max(40) });

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:read');
		const detail = await getTourDetail(ctx.tenantId, event.params.id!);
		// publicMedia, not the row: objectKey is the handle that can destroy an
		// object and has no business leaving the server.
		return ok(detail.gallery.map((m) => publicMedia(m)));
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const tourId = event.params.id!;
		// Ownership first: an upload must not reach storage before we know the
		// caller owns the tour it claims to belong to.
		await getTourDetail(ctx.tenantId, tourId);

		const contentType = event.request.headers.get('content-type') ?? '';
		let bytes: Uint8Array;
		let mime: string;
		let altText: string | null = null;

		if (contentType.includes('multipart/form-data')) {
			const form = await event.request.formData();
			const file = form.get('file');
			if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'Attach a file.');
			if (file.size > MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'That image is too large.');
			bytes = new Uint8Array(await file.arrayBuffer());
			mime = file.type;
			altText = (form.get('altText') as string) || null;
		} else {
			const body = await parseBody(
				event,
				z.object({
					data: z.string().min(1),
					contentType: z.string().min(1).max(100),
					altText: z.string().max(300).optional().nullable()
				})
			);
			// Bounded before decoding: base64 inflates by 4/3, so the encoded
			// ceiling is what actually caps memory.
			if (body.data.length > Math.ceil((MAX_BYTES * 4) / 3) + 1024) {
				throw new AppError('VALIDATION_ERROR', 'That image is too large.');
			}
			bytes = Uint8Array.from(Buffer.from(body.data, 'base64'));
			mime = body.contentType;
			altText = body.altText ?? null;
		}

		const media = await uploadMedia({ kind: 'tour-gallery', tenantId: ctx.tenantId, tourId }, bytes, mime, {
			altText
		});
		return ok(publicMedia(media), undefined, { status: 201 });
	});

/** Reorder the gallery. The browser knows the final order, so it sends it whole. */
export const PUT: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const { mediaIds } = await parseBody(event, ORDER);
		await setTourGallery(ctx.tenantId, event.params.id!, mediaIds, { apiKeyId: ctx.apiKeyId });
		const detail = await getTourDetail(ctx.tenantId, event.params.id!);
		return ok(detail.gallery.map((m) => publicMedia(m)));
	});
