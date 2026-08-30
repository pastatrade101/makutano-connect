// Pulling a tenant's own catalogue into Connect, on a schedule.
//
// The tenant's system is the source of truth for what they sell — Goldfinch owns
// its lodges, and Connect reading them is the whole relationship. This used to
// be a CLI script somebody remembered to run, which meant the catalogue was a
// snapshot from whenever that last happened.
//
// Configuration is per TENANT, not per deployment: one Connect serves several
// businesses and they do not share an endpoint.
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { getTenantById } from './tenants';
import { assertFetchableUrl } from './net';
import { AppError } from './errors';
import { log } from './logger';

export type CatalogSource = {
	/** Stable key, and the external_source stamped on every row it owns. */
	source: string;
	url: string;
	type: 'ACCOMMODATION' | 'TOUR' | 'EXPERIENCE' | 'PRODUCT' | 'SERVICE' | 'OTHER';
	enabled: boolean;
};

export type CatalogSyncSettings = { sources: CatalogSource[] };

// The catalog_item_type enum, not a guess at one.
const TYPES = new Set(['ACCOMMODATION', 'TOUR', 'EXPERIENCE', 'PRODUCT', 'SERVICE', 'OTHER']);

/** Read what a tenant has configured, tolerating anything shaped wrongly. */
export function catalogSyncSettings(settings: Record<string, unknown> | null | undefined): CatalogSyncSettings {
	const raw = (settings?.catalogSync ?? null) as { sources?: unknown } | null;
	const sources = Array.isArray(raw?.sources) ? raw!.sources : [];
	return {
		sources: sources
			.map((s) => s as Record<string, unknown>)
			.filter((s) => typeof s?.source === 'string' && typeof s?.url === 'string')
			.map((s) => ({
				source: String(s.source),
				url: String(s.url),
				type: TYPES.has(String(s.type)) ? (String(s.type) as CatalogSource['type']) : 'ACCOMMODATION',
				enabled: s.enabled !== false
			}))
	};
}

export async function saveCatalogSyncSettings(tenantId: string, next: CatalogSyncSettings): Promise<void> {
	for (const source of next.sources) await assertFetchableUrl(source.url);
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('NOT_FOUND', 'Tenant not found.');
	await db()
		.update(schema.tenants)
		.set({
			settings: { ...((tenant.settings ?? {}) as Record<string, unknown>), catalogSync: next },
			updatedAt: new Date()
		})
		.where(eq(schema.tenants.id, tenantId));
}

type Item = { id?: string | number; name?: string; accommodation_level?: string | null; lodge_type?: string | null };

/** Tolerates a bare array, {data:[…]}, or {data:{items:[…]}}. */
function itemsFrom(payload: unknown): Item[] {
	if (Array.isArray(payload)) return payload as Item[];
	const data = (payload as { data?: unknown })?.data;
	if (Array.isArray(data)) return data as Item[];
	const items = (data as { items?: unknown })?.items;
	return Array.isArray(items) ? (items as Item[]) : [];
}

const totalPagesFrom = (payload: unknown): number => {
	const p = (payload as { data?: { pagination?: { totalPages?: number } } })?.data?.pagination;
	return Math.max(1, Number(p?.totalPages ?? 1));
};

/**
 * EVERY page, not just the first.
 *
 * This is the one that bites: the source defaults to 10 per page and the retire
 * step below deactivates whatever it did not see. A single-page fetch would
 * therefore have retired 45 of Goldfinch's 55 lodges — a sync that quietly
 * removes most of the catalogue is worse than no sync at all.
 */
async function fetchAll(base: URL): Promise<Item[]> {
	const all: Item[] = [];
	let page = 1;
	let pages = 1;
	do {
		const url = new URL(base);
		url.searchParams.set('page', String(page));
		if (!url.searchParams.has('limit')) url.searchParams.set('limit', '100');
		const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
		if (!response.ok) throw new AppError('INTERNAL_ERROR', `${url.origin}${url.pathname} returned ${response.status}.`);
		const payload = await response.json();
		all.push(...itemsFrom(payload));
		pages = totalPagesFrom(payload);
		page++;
	} while (page <= pages && page <= 200);
	return all;
}

/** "MID_RANGE" → "Mid range", for a human list. */
const humanise = (v?: string | null) =>
	v ? v.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null;

export type SyncResult = { source: string; added: number; updated: number; retired: number };

export async function syncCatalogSource(tenantId: string, source: CatalogSource): Promise<SyncResult> {
	const url = await assertFetchableUrl(source.url);
	const items = (await fetchAll(url)).filter((i) => i?.id != null && String(i?.name ?? '').trim());
	// A source that answers with nothing is far more likely to be broken than to
	// have genuinely emptied. Refusing beats retiring the whole catalogue.
	if (!items.length) throw new AppError('INTERNAL_ERROR', 'The source returned no items — refusing to run.');

	let added = 0;
	let updated = 0;
	const seen: string[] = [];

	for (const item of items) {
		const reference = String(item.id);
		seen.push(reference);
		const name = String(item.name).trim();
		const description = [humanise(item.accommodation_level), humanise(item.lodge_type)].filter(Boolean).join(' · ') || null;

		// Keyed on the SOURCE id, so a renamed lodge updates rather than duplicating.
		const [existing] = await db()
			.select({ id: schema.catalogItems.id })
			.from(schema.catalogItems)
			.where(
				and(
					eq(schema.catalogItems.tenantId, tenantId),
					eq(schema.catalogItems.externalSource, source.source),
					eq(schema.catalogItems.externalReference, reference)
				)
			)
			.limit(1);

		if (existing) {
			await db()
				.update(schema.catalogItems)
				.set({ name, description, isActive: true, updatedAt: new Date() })
				.where(eq(schema.catalogItems.id, existing.id));
			updated++;
		} else {
			await db().insert(schema.catalogItems).values({
				tenantId,
				type: source.type,
				name,
				description,
				externalReference: reference,
				externalSource: source.source
			});
			added++;
		}
	}

	// Anything that has left the source is DEACTIVATED, never deleted: a trip
	// that already names a lodge must keep naming it after the lodge is retired.
	const retiredRows = await db()
		.update(schema.catalogItems)
		.set({ isActive: false, updatedAt: new Date() })
		.where(
			and(
				eq(schema.catalogItems.tenantId, tenantId),
				eq(schema.catalogItems.externalSource, source.source),
				eq(schema.catalogItems.isActive, true),
				// notInArray, NOT a hand-written `<> all(${seen})`: drizzle's sql
				// template does not serialise a JS array into a Postgres array, so
				// that form threw "op ANY/ALL (array) requires array on right side"
				// on every run — and the error was swallowed (see below), so the
				// job reported SUCCEEDED while nothing was ever retired.
				notInArray(schema.catalogItems.externalReference, seen)
			)
		)
		.returning({ id: schema.catalogItems.id });

	return { source: source.source, added, updated, retired: retiredRows.length };
}

/** Every enabled source for one tenant. One failing source does not stop the rest. */
export async function syncTenantCatalog(tenantId: string): Promise<SyncResult[]> {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('NOT_FOUND', 'Tenant not found.');
	const { sources } = catalogSyncSettings(tenant.settings as Record<string, unknown>);
	const results: SyncResult[] = [];
	const failures: string[] = [];
	for (const source of sources.filter((s) => s.enabled)) {
		try {
			const result = await syncCatalogSource(tenantId, source);
			results.push(result);
			log.info('catalog_sync_done', { tenantId, ...result });
		} catch (error) {
			const message = (error as Error)?.message ?? 'unknown';
			log.error('catalog_sync_failed', { tenantId, source: source.source, error: message });
			failures.push(`${source.source}: ${message}`);
		}
	}
	// Every source is attempted — one broken endpoint must not stop the others —
	// but the job still FAILS if any of them did. Swallowing this is how a sync
	// that has never once worked goes on reporting SUCCEEDED: the first version
	// of this did exactly that, and only the container log knew.
	if (failures.length) throw new AppError('INTERNAL_ERROR', `Catalogue sync failed — ${failures.join('; ')}`);
	return results;
}

/** Tenants with at least one enabled source — what the sweep fans out over. */
export async function tenantsWithCatalogSync(): Promise<string[]> {
	const rows = await db()
		.select({ id: schema.tenants.id, settings: schema.tenants.settings })
		.from(schema.tenants)
		.where(sql`${schema.tenants.deletedAt} is null and ${schema.tenants.settings} -> 'catalogSync' is not null`);
	return rows
		.filter((r) => catalogSyncSettings(r.settings as Record<string, unknown>).sources.some((s) => s.enabled))
		.map((r) => r.id);
}
