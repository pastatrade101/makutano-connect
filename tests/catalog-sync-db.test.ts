// The sync against a real database and a stubbed source.
//
// These exist because the first version of this shipped broken: the retire
// predicate was a hand-written `<> all(${array})`, which drizzle does not
// serialise into a Postgres array, so every run threw — and syncTenantCatalog
// swallowed the error, so the job reported SUCCEEDED and the container log was
// the only place the truth appeared. Unit tests over the pure helpers could
// never have caught either half.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';
// The source here is a stub, not a host: these tests are about the sync's SQL
// and control flow, and should not depend on DNS. The guard itself is covered
// address-by-address in catalog-sync.test.ts.
process.env.CATALOG_SYNC_ALLOW_PRIVATE = 'on';

/** A source that answers with `pages` pages of `perPage` items. */
const stubSource = (items: Array<{ id: string; name: string }>, perPage = 10) => {
	vi.stubGlobal('fetch', async (input: URL | string) => {
		const url = new URL(String(input));
		const page = Number(url.searchParams.get('page') ?? 1);
		const size = Math.min(Number(url.searchParams.get('limit') ?? perPage), perPage);
		const slice = items.slice((page - 1) * size, page * size);
		return {
			ok: true,
			json: async () => ({
				data: { items: slice, pagination: { page, totalPages: Math.max(1, Math.ceil(items.length / size)) } }
			})
		} as unknown as Response;
	});
};

suite('catalogue sync', () => {
	let tenantId: string;
	const source = { source: 'lodges', url: 'https://source.example/api/lodges', type: 'ACCOMMODATION' as const, enabled: true };

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Sync Co', slug: `test-sync-${Date.now()}` } as never);
		tenantId = tenant.id;
	}, 120_000);

	afterEach(() => vi.unstubAllGlobals());

	const active = async () => {
		const { db, schema } = await import('../src/lib/server/db');
		const { and, eq } = await import('drizzle-orm');
		const rows = await db()
			.select({ name: schema.catalogItems.name, isActive: schema.catalogItems.isActive })
			.from(schema.catalogItems)
			.where(and(eq(schema.catalogItems.tenantId, tenantId), eq(schema.catalogItems.externalSource, 'lodges')));
		return rows;
	};

	it('follows every page, not just the first', async () => {
		// The real source pages at 10 while holding 55. A single-page fetch would
		// have imported 10 and then retired the other 45.
		const { syncCatalogSource } = await import('../src/lib/server/catalog-sync');
		stubSource(Array.from({ length: 55 }, (_, i) => ({ id: `L${i}`, name: `Lodge ${i}` })), 10);
		const result = await syncCatalogSource(tenantId, source);
		expect(result.added).toBe(55);
		expect(result.retired).toBe(0);
		expect((await active()).filter((r) => r.isActive)).toHaveLength(55);
	}, 120_000);

	it('updates rather than duplicating on a second run', async () => {
		const { syncCatalogSource } = await import('../src/lib/server/catalog-sync');
		stubSource(Array.from({ length: 55 }, (_, i) => ({ id: `L${i}`, name: `Lodge ${i} renamed` })), 10);
		const result = await syncCatalogSource(tenantId, source);
		expect(result.added).toBe(0);
		expect(result.updated).toBe(55);
		expect(await active()).toHaveLength(55);
	}, 120_000);

	it('deactivates what left the source, and never deletes it', async () => {
		// THE BUG. This path threw on every run and nobody heard.
		const { syncCatalogSource } = await import('../src/lib/server/catalog-sync');
		stubSource(Array.from({ length: 50 }, (_, i) => ({ id: `L${i}`, name: `Lodge ${i}` })), 10);
		const result = await syncCatalogSource(tenantId, source);
		expect(result.retired).toBe(5);

		const rows = await active();
		// Still 55 rows: a trip that already names a retired lodge must keep naming it.
		expect(rows).toHaveLength(55);
		expect(rows.filter((r) => r.isActive)).toHaveLength(50);
	}, 120_000);

	it('refuses a source that answers with nothing', async () => {
		// Far likelier to be broken than genuinely empty, and treating it as empty
		// would retire the whole catalogue.
		const { syncCatalogSource } = await import('../src/lib/server/catalog-sync');
		stubSource([], 10);
		await expect(syncCatalogSource(tenantId, source)).rejects.toThrow(/refusing to run/i);
		expect((await active()).filter((r) => r.isActive)).toHaveLength(50);
	}, 120_000);

	it('fails the job when a source fails, instead of reporting success', async () => {
		// The second half of the bug: swallowing this is how a sync that has never
		// once worked goes on looking healthy in the jobs table.
		const { saveCatalogSyncSettings, syncTenantCatalog } = await import('../src/lib/server/catalog-sync');
		await saveCatalogSyncSettings(tenantId, { sources: [source] });
		vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
		await expect(syncTenantCatalog(tenantId)).rejects.toThrow(/Catalogue sync failed/i);
	}, 120_000);
});
