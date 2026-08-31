// The real upload path, against the real bucket.
//
// The unit suite proves the RULES — mime allow-list, size ceiling, magic bytes,
// cross-tenant refusal — without touching storage. This one proves the wiring:
// that a byte array handed to uploadMedia actually lands in R2, is readable at
// the public URL, and that deleting the row removes the object.
//
// It SKIPS when R2 is unconfigured, so CI without credentials stays green. Every
// object it creates is deleted in the same test, and the key is prefixed so a
// stray one is obvious in the bucket.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const R2_READY = Boolean(
	process.env.R2_ACCOUNT_ID &&
		process.env.R2_ACCESS_KEY_ID &&
		process.env.R2_SECRET_ACCESS_KEY &&
		process.env.R2_BUCKET_NAME &&
		process.env.R2_PUBLIC_URL
);
const suite = TEST_DB && R2_READY ? describe : describe.skip;

process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

/** A real 1x1 PNG. The upload path checks magic bytes, so junk would be refused. */
const PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	)
);

suite('R2 media, end to end', () => {
	let tenantId: string;
	let tourId: string;
	let M: typeof import('../src/lib/server/media');
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];
	const created: string[] = [];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Media Live', slug: `test-live-${Date.now()}` } as never);
		tenantId = tenant.id;
		M = await import('../src/lib/server/media');
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		const { liftLimits } = await import('./support');
		await liftLimits(tenantId);

		const T = await import('../src/lib/server/tours');
		const [country] = await db().select().from(schema.countries).where(eq(schema.countries.slug, 'tanzania')).limit(1);
		tourId = (await T.createTour(tenantId, { title: 'Live Media Probe', primaryCountryId: country.id })).id;
	}, 120_000);

	afterAll(async () => {
		// Belt and braces: anything a failed assertion left behind still goes.
		for (const id of created) {
			try {
				await M.deleteMedia(id, { kind: 'tenant', tenantId });
			} catch {
				/* already gone */
			}
		}
	});

	it('reports itself as enabled when the bucket is configured', () => {
		expect(M.mediaEnabled()).toBe(true);
	});

	it('uploads a photo, stores a row, and serves it at the public url', async () => {
		const media = await M.uploadMedia(
			{ kind: 'tour-gallery', tenantId, tourId },
			PNG,
			'image/png',
			{ altText: 'A test photograph' }
		);
		created.push(media.id);

		expect(media.tenantId).toBe(tenantId);
		expect(media.mimeType).toBe('image/png');
		expect(media.size).toBe(PNG.byteLength);
		expect(media.altText).toBe('A test photograph');

		// The key is server-generated from the RESOLVED owner — never from
		// anything a browser sent — so it must carry this tenant and tour.
		expect(media.objectKey).toContain(`marketplace/tenants/${tenantId}/tours/${tourId}/gallery/`);
		expect(media.objectKey.endsWith('.png')).toBe(true);

		// And it is genuinely readable by the public.
		let res: Response | null = null;
		for (let i = 0; i < 5; i++) {
			res = await fetch(media.url, { cache: 'no-store' });
			if (res.ok) break;
			await new Promise((r) => setTimeout(r, 1200));
		}
		expect(res?.ok, `the image must be fetchable at ${media.url}`).toBe(true);
		const bytes = new Uint8Array(await res!.arrayBuffer());
		expect(bytes.byteLength).toBe(PNG.byteLength);
		expect(bytes[0]).toBe(0x89); // still a PNG on the way back out
	}, 60_000);

	it('puts a platform asset under the platform prefix, with no tenant', async () => {
		const [destination] = await db()
			.select()
			.from(schema.destinations)
			.where(eq(schema.destinations.slug, 'serengeti-national-park'))
			.limit(1);

		const media = await M.uploadMedia(
			{ kind: 'platform-destination', destinationId: destination.id },
			PNG,
			'image/png',
			{ altText: 'Platform hero' }
		);

		expect(media.tenantId, 'NULL tenantId IS what platform-owned means').toBeNull();
		expect(media.objectKey).toContain(`marketplace/platform/destinations/${destination.id}/`);

		// A tenant must not be able to delete it.
		await expect(M.deleteMedia(media.id, { kind: 'tenant', tenantId })).rejects.toThrow(/could not be found/i);

		await M.deleteMedia(media.id, { kind: 'platform' });
		const [gone] = await db().select().from(schema.media).where(eq(schema.media.id, media.id)).limit(1);
		expect(gone).toBeFalsy();
	}, 60_000);

	it('removes the object from the bucket when the row is deleted', async () => {
		const media = await M.uploadMedia({ kind: 'tour-hero', tenantId, tourId }, PNG, 'image/png');
		const url = media.url;

		const before = await fetch(url, { cache: 'no-store' });
		expect(before.ok).toBe(true);

		await M.deleteMedia(media.id, { kind: 'tenant', tenantId });

		// Row first, then object — so a moment of 200 here is the CDN, not a bug.
		let after: Response | null = null;
		for (let i = 0; i < 6; i++) {
			after = await fetch(url, { cache: 'no-store' });
			if (!after.ok) break;
			await new Promise((r) => setTimeout(r, 1500));
		}
		expect(after?.ok, 'the object must be gone from the bucket, not just the row').toBe(false);
	}, 90_000);

	it('still refuses a file that is not the image it claims to be', async () => {
		// The rule is enforced BEFORE anything reaches storage, so a rejected
		// upload must leave no object behind at all.
		const liar = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
		await expect(
			M.uploadMedia({ kind: 'tour-gallery', tenantId, tourId }, liar, 'image/png')
		).rejects.toThrow(/not a valid image/i);
	});
});
