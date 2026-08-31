// Media is the one marketplace surface where a mistake leaks a CREDENTIAL or
// lets one operator reach into another's storage.
//
// Two things are asserted here that reading the code cannot settle:
//   - deleting scopes ownership INSIDE the delete, so tenant A asking for
//     tenant B's row gets "not found" rather than a successful delete;
//   - nothing that leaves the server ever carries objectKey, which is the only
//     handle that can destroy an object.
//
// Uploads are validated BEFORE any bucket call, so the rejection tests run
// without R2 credentials — which is the honest thing to test anyway: a
// marketplace with storage misconfigured must still refuse a bad file.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

const PNG = (bytes = 64) => {
	const b = new Uint8Array(bytes);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // real PNG signature
	return b;
};

suite('marketplace media', () => {
	let tenantA: string;
	let tenantB: string;
	let M: typeof import('../src/lib/server/media');
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	beforeAll(async () => {
		const a = await provisionTestTenant({ name: 'Media A', slug: `test-media-a-${Date.now()}` } as never);
		const b = await provisionTestTenant({ name: 'Media B', slug: `test-media-b-${Date.now()}` } as never);
		tenantA = a.id;
		tenantB = b.id;
		M = await import('../src/lib/server/media');
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
	}, 120_000);

	/** A media row inserted directly — the bucket is not involved. */
	const seedMedia = async (owner: string | null) => {
		const [row] = await db()
			.insert(schema.media)
			.values({
				tenantId: owner,
				objectKey: `marketplace/probe/${crypto.randomUUID()}.png`,
				url: 'https://cdn.example.test/probe.png',
				mimeType: 'image/png',
				size: 1024
			})
			.returning();
		return row;
	};

	/* ---- credential and handle exposure ---------------------------------- */

	it('never lets objectKey, tenantId or createdBy leave the server', async () => {
		const row = await seedMedia(tenantA);
		const projected = M.publicMedia(row)!;

		expect(Object.keys(projected).sort()).toEqual(['altText', 'height', 'id', 'url', 'width']);
		const serialized = JSON.stringify(projected);
		expect(serialized).not.toContain(row.objectKey);
		expect(serialized).not.toContain(tenantA);
		expect(projected).not.toHaveProperty('objectKey');
		expect(projected).not.toHaveProperty('tenantId');
		expect(projected).not.toHaveProperty('storageProvider');
	});

	it('projects null safely rather than throwing', () => {
		expect(M.publicMedia(null)).toBeNull();
		expect(M.publicMedia(undefined)).toBeNull();
	});

	/* ---- cross-tenant access --------------------------------------------- */

	it('will not let tenant A delete tenant B media', async () => {
		const victim = await seedMedia(tenantB);

		await expect(
			M.deleteMedia(victim.id, { kind: 'tenant', tenantId: tenantA }),
			'the row belongs to B; A must be told it does not exist'
		).rejects.toThrow(/could not be found/i);

		const [still] = await db().select().from(schema.media).where(eq(schema.media.id, victim.id)).limit(1);
		expect(still, "B's image must survive A's attempt").toBeTruthy();
	});

	it('will not let a tenant delete PLATFORM media', async () => {
		// Country and destination photographs are platform-owned (tenantId NULL).
		const platform = await seedMedia(null);

		await expect(M.deleteMedia(platform.id, { kind: 'tenant', tenantId: tenantA })).rejects.toThrow(
			/could not be found/i
		);

		const [still] = await db().select().from(schema.media).where(eq(schema.media.id, platform.id)).limit(1);
		expect(still).toBeTruthy();
	});

	it('will not let the platform scope delete TENANT media', async () => {
		// The guard runs both ways: platform scope matches tenantId IS NULL only.
		const owned = await seedMedia(tenantA);
		await expect(M.deleteMedia(owned.id, { kind: 'platform' })).rejects.toThrow(/could not be found/i);

		const [still] = await db().select().from(schema.media).where(eq(schema.media.id, owned.id)).limit(1);
		expect(still).toBeTruthy();
	});

	it('lets an owner delete its own media', async () => {
		const mine = await seedMedia(tenantA);
		await M.deleteMedia(mine.id, { kind: 'tenant', tenantId: tenantA });

		const [gone] = await db().select().from(schema.media).where(eq(schema.media.id, mine.id)).limit(1);
		expect(gone, 'the row goes first — an object with no row is only litter').toBeFalsy();
	});

	it('rejects a malformed media id instead of scanning', async () => {
		await expect(M.deleteMedia('not-a-uuid', { kind: 'tenant', tenantId: tenantA })).rejects.toThrow();
	});

	/* ---- upload validation, before a byte is stored ---------------------- */

	it('refuses a MIME type that is not an allowed image', async () => {
		await expect(
			M.uploadMedia({ kind: 'operator', tenantId: tenantA }, PNG(), 'application/pdf')
		).rejects.toThrow(/Unsupported image type/i);
	});

	it('refuses an oversized file', async () => {
		const huge = new Uint8Array(M.MAX_BYTES + 1);
		huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		await expect(M.uploadMedia({ kind: 'operator', tenantId: tenantA }, huge, 'image/png')).rejects.toThrow(
			/larger than/i
		);
	});

	it('refuses an empty file', async () => {
		await expect(
			M.uploadMedia({ kind: 'operator', tenantId: tenantA }, new Uint8Array(0), 'image/png')
		).rejects.toThrow(/empty/i);
	});

	it('refuses a file whose bytes are not the image it claims to be', async () => {
		// A .exe renamed to .png, or a polyglot. The declared content type is
		// attacker-controlled, so the signature is checked rather than trusted.
		const liar = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ = DOS/PE
		await expect(M.uploadMedia({ kind: 'operator', tenantId: tenantA }, liar, 'image/png')).rejects.toThrow(
			/not a valid image/i
		);
	});

	it('publishes an allow-list of image types and a sane size ceiling', () => {
		expect([...M.ALLOWED_MIME_TYPES].sort()).toEqual(
			['image/avif', 'image/jpeg', 'image/png', 'image/webp'].sort()
		);
		expect(M.MAX_BYTES).toBeGreaterThan(0);
		expect(M.MAX_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
	});

	/* ---- ownership and orphan behaviour ---------------------------------- */

	it('ties tenant media to the tenant, and platform media to nobody', async () => {
		const tenantOwned = await seedMedia(tenantA);
		const platformOwned = await seedMedia(null);
		expect(tenantOwned.tenantId).toBe(tenantA);
		expect(platformOwned.tenantId, 'NULL tenantId IS what platform-owned means').toBeNull();
	});

	it('removes a tenant’s media when the tenant is removed', async () => {
		// media.tenant_id cascades: deleting a business must not leave its
		// photographs behind as unreachable rows.
		const doomed = await provisionTestTenant({ name: 'Doomed', slug: `test-media-x-${Date.now()}` } as never);
		const asset = await seedMedia(doomed.id);

		await db().delete(schema.tenants).where(eq(schema.tenants.id, doomed.id));

		const [gone] = await db().select().from(schema.media).where(eq(schema.media.id, asset.id)).limit(1);
		expect(gone).toBeFalsy();
	});
});
