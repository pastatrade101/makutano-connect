/**
 * Smaller copies of an uploaded image.
 *
 * WHY THIS EXISTS. The bucket holds camera originals. A real row is 7360x4912
 * at 1.4MB, and every surface serves it at full resolution into a box 240px
 * wide — one fifteen-day itinerary is 9.4MB of photographs for about 3,600px of
 * screen. Cloudflare's managed r2.dev domain cannot resize on the fly and the
 * paid Image Resizing product needs a custom domain on the zone, so the copies
 * are made once, here, at upload time.
 *
 * THE FORMAT IS NEVER CHANGED. A derivative comes out in the same format as the
 * original — avif from avif, jpeg from jpeg — because `srcset` is not a
 * negotiation: whatever the browser picks is what it must be able to decode.
 * Re-encoding the 79 JPEG rows as AVIF would hand an old Safari a picture it
 * cannot render, in place of one it can. The 137 AVIF rows carry 58 of the 73MB
 * in the bucket, so keeping formats costs nothing that matters.
 *
 * EVERYTHING HERE FAILS SAFE. A width larger than the original is skipped rather
 * than upscaled; a derivative that comes out no smaller than the original is
 * thrown away rather than stored; and a decode that throws returns no
 * derivatives at all, leaving the caller to store the original exactly as it
 * does today. There is no state in which this makes a page worse than before it.
 */
import sharp, { type Sharp } from 'sharp';
import { log } from './logger';

/**
 * The widths worth keeping.
 *
 * Chosen against what this marketplace actually renders: a 42px stay thumbnail
 * and a 240px itinerary photo (320 covers both, even at 2x), a card and a
 * two-column body (640), a full-width phone hero (1024), and a desktop hero
 * (1600). Past that the original is a better answer than another copy of it.
 */
export const DERIVATIVE_WIDTHS = [320, 640, 1024, 1600] as const;

/** Quality per format. AVIF and WebP take a lower number for the same picture. */
const QUALITY = { avif: 58, webp: 74, jpeg: 78, png: undefined } as const;

export type Derivative = { w: number; bytes: Uint8Array; contentType: string };
export type Derived = {
	/** The original's own pixel size, which nothing has ever recorded. */
	width: number | null;
	height: number | null;
	derivatives: Derivative[];
};

/** sharp's format name for a mime type we accept, or null when we should not touch it. */
function formatOf(contentType: string): 'avif' | 'webp' | 'jpeg' | 'png' | null {
	if (contentType === 'image/avif') return 'avif';
	if (contentType === 'image/webp') return 'webp';
	if (contentType === 'image/jpeg') return 'jpeg';
	if (contentType === 'image/png') return 'png';
	return null;
}

const encode = (pipeline: Sharp, format: 'avif' | 'webp' | 'jpeg' | 'png') => {
	switch (format) {
		case 'avif':
			return pipeline.avif({ quality: QUALITY.avif, effort: 4 });
		case 'webp':
			return pipeline.webp({ quality: QUALITY.webp });
		case 'jpeg':
			// Progressive, and mozjpeg's tables: the same picture, a few percent
			// smaller, and it paints top-down on a slow connection instead of
			// arriving all at once at the end.
			return pipeline.jpeg({ quality: QUALITY.jpeg, progressive: true, mozjpeg: true });
		case 'png':
			return pipeline.png({ compressionLevel: 9 });
	}
};

/**
 * Measure an image and make the smaller copies worth making.
 *
 * Never throws. An image sharp cannot read is not an error the upload should
 * fail on — the bytes have already passed a signature check and the original is
 * what the page will serve either way.
 */
export async function deriveImages(bytes: Uint8Array, contentType: string): Promise<Derived> {
	const format = formatOf(contentType);
	if (!format) return { width: null, height: null, derivatives: [] };

	let width: number | null = null;
	let height: number | null = null;
	try {
		const meta = await sharp(bytes).metadata();
		width = meta.width ?? null;
		height = meta.height ?? null;
	} catch (error) {
		log.warn('media_metadata_failed', { contentType, error: (error as Error)?.message });
		return { width: null, height: null, derivatives: [] };
	}

	if (!width) return { width, height, derivatives: [] };

	const derivatives: Derivative[] = [];
	for (const w of DERIVATIVE_WIDTHS) {
		// Never upscale. A 320px original does not need a 640px copy, and one made
		// anyway is a bigger file carrying no more detail.
		if (w >= width) continue;
		try {
			const out = await encode(sharp(bytes).resize({ width: w, withoutEnlargement: true }), format).toBuffer();
			// A "smaller" copy that is not smaller is a second full-size file with a
			// misleading name. Some already-optimised originals produce these.
			if (out.byteLength >= bytes.byteLength) continue;
			derivatives.push({ w, bytes: out, contentType });
		} catch (error) {
			// One width failing must not cost the others, or the original.
			log.warn('media_derivative_failed', { width: w, contentType, error: (error as Error)?.message });
		}
	}
	return { width, height, derivatives };
}

/**
 * The key a derivative is stored under: the original's, with the width before
 * the extension. Derived rather than random so a backfill re-run overwrites its
 * own previous output instead of littering the bucket with orphans.
 */
export function derivativeKey(objectKey: string, w: number): string {
	const dot = objectKey.lastIndexOf('.');
	return dot === -1 ? `${objectKey}_${w}` : `${objectKey.slice(0, dot)}_${w}${objectKey.slice(dot)}`;
}
