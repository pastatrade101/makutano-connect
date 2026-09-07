// Smaller copies of an image, and the contract the pages read them through.
//
// The bucket holds camera originals — 7360x4912 at 1.4MB — served at full size
// into boxes 42px wide. These are the rules that fix that without any page being
// able to end up worse than it started.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { DERIVATIVE_WIDTHS, deriveImages, derivativeKey } from '../src/lib/server/media-derivatives';
/*
 * srcsetFor and variantUrl build public URLs, so media.ts reads the environment
 * the first time either is called. These are the smallest values its schema will
 * accept; none of them is real and none reaches anything but a string join.
 */
process.env.AUTH_SECRET ||= 'test-only-not-a-real-secret-000000000000';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'test-only-not-real-key';
process.env.R2_PUBLIC_URL ||= 'https://cdn.example.test';
process.env.R2_ACCOUNT_ID ||= 'acct';
process.env.R2_ACCESS_KEY_ID ||= 'akid';
process.env.R2_SECRET_ACCESS_KEY ||= 'secret';
process.env.R2_BUCKET_NAME ||= 'bucket';

const { srcsetFor, variantUrl } = await import('../src/lib/server/media');

/** A real encoded image, so sharp is exercised rather than mocked. */
const png = (w: number, h: number) =>
	sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 60, b: 30 } } })
		.png()
		.toBuffer()
		.then((b) => new Uint8Array(b));

describe('derivativeKey', () => {
	it('puts the width before the extension, so the format still reads', () => {
		expect(derivativeKey('a/b/c.avif', 640)).toBe('a/b/c_640.avif');
		expect(derivativeKey('a/b/c-opt.webp', 320)).toBe('a/b/c-opt_320.webp');
	});

	it('handles a key with no extension rather than corrupting it', () => {
		expect(derivativeKey('a/b/c', 640)).toBe('a/b/c_640');
	});

	it('is derived, not random — a second run overwrites its own output', () => {
		expect(derivativeKey('x.jpg', 320)).toBe(derivativeKey('x.jpg', 320));
	});
});

describe('deriveImages', () => {
	it('measures the original, which nothing has ever recorded', async () => {
		const out = await deriveImages(await png(900, 600), 'image/png');
		expect(out.width).toBe(900);
		expect(out.height).toBe(600);
	});

	it('never upscales — a width at or above the original is skipped', async () => {
		const out = await deriveImages(await png(500, 400), 'image/png');
		expect(out.derivatives.every((d) => d.w < 500)).toBe(true);
		expect(out.derivatives.map((d) => d.w)).not.toContain(640);
	});

	it('makes nothing at all for an image narrower than the smallest rung', async () => {
		const out = await deriveImages(await png(200, 150), 'image/png');
		expect(out.derivatives).toEqual([]);
		expect(out.width).toBe(200);
	});

	it('keeps the format, so srcset cannot hand a browser something it cannot decode', async () => {
		const jpeg = new Uint8Array(
			await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#444' } })
				.jpeg()
				.toBuffer()
		);
		const out = await deriveImages(jpeg, 'image/jpeg');
		expect(out.derivatives.length).toBeGreaterThan(0);
		for (const d of out.derivatives) {
			expect(d.contentType).toBe('image/jpeg');
			expect((await sharp(d.bytes).metadata()).format).toBe('jpeg');
		}
	});

	it('never returns a "smaller" copy that is not smaller', async () => {
		const original = await png(2000, 1400);
		const out = await deriveImages(original, 'image/png');
		for (const d of out.derivatives) {
			expect(d.bytes.byteLength).toBeLessThan(original.byteLength);
		}
	});

	it('gives back the widths narrow-to-wide, as the srcset wants them', async () => {
		const out = await deriveImages(await png(3000, 2000), 'image/png');
		expect(out.derivatives.map((d) => d.w)).toEqual([...out.derivatives.map((d) => d.w)].sort((a, b) => a - b));
		expect(out.derivatives.map((d) => d.w).every((w) => (DERIVATIVE_WIDTHS as readonly number[]).includes(w))).toBe(
			true
		);
	});

	it('refuses a type it should not touch rather than guessing', async () => {
		const out = await deriveImages(await png(1200, 800), 'image/gif');
		expect(out).toEqual({ width: null, height: null, derivatives: [] });
	});

	it('does not throw on bytes that are not an image — the upload must still succeed', async () => {
		const out = await deriveImages(new Uint8Array([1, 2, 3, 4, 5]), 'image/png');
		expect(out.derivatives).toEqual([]);
		expect(out.width).toBeNull();
	});
});

describe('srcsetFor — the fail-safe half of the contract', () => {
	const variants = [
		{ w: 640, key: 'k/a_640.avif', bytes: 30_000 },
		{ w: 320, key: 'k/a_320.avif', bytes: 9_000 }
	];

	it('is null when only the original exists, so a page behaves exactly as before', () => {
		expect(srcsetFor({ url: 'https://x/a.avif', width: 1400, variants: null })).toBeNull();
		expect(srcsetFor({ url: 'https://x/a.avif', width: 1400, variants: [] })).toBeNull();
	});

	it('sorts narrow to wide and ends with the original at its own width', () => {
		const out = srcsetFor({ url: 'https://x/a.avif', width: 1400, variants }) ?? '';
		const widths = out.split(', ').map((p) => p.split(' ')[1]);
		expect(widths).toEqual(['320w', '640w', '1400w']);
		expect(out.endsWith('https://x/a.avif 1400w')).toBe(true);
	});

	it('leaves the original OUT when its width is unknown', () => {
		// A candidate with no descriptor cannot be compared, and a browser may
		// simply take it — which is the 1.4MB file this exists to avoid.
		const out = srcsetFor({ url: 'https://x/a.avif', width: null, variants }) ?? '';
		expect(out).not.toContain('https://x/a.avif ');
		expect(out.split(', ')).toHaveLength(2);
	});
});

describe('variantUrl — for slots that have no choice to offer', () => {
	const row = {
		url: 'https://x/a.avif',
		variants: [
			{ w: 320, key: 'k/a_320.avif', bytes: 9_000 },
			{ w: 1024, key: 'k/a_1024.avif', bytes: 76_000 }
		]
	};

	it('takes the narrowest rung that still covers the slot', () => {
		expect(variantUrl(row, 320)).toContain('a_320.avif');
		expect(variantUrl(row, 400)).toContain('a_1024.avif');
	});

	it('falls back to the original when nothing is big enough', () => {
		expect(variantUrl(row, 2000)).toBe('https://x/a.avif');
	});

	it('falls back to the original when there are no variants at all', () => {
		expect(variantUrl({ url: 'https://x/a.avif', variants: null }, 320)).toBe('https://x/a.avif');
	});
});
