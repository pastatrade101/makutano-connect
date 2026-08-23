// Lightweight product/service catalog. Deliberately not an ERP: enough to name and
// price what is being booked, quoted or ordered. Businesses with their own catalog
// pass externalReference on line items instead and never touch this table.
import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import type { Pagination } from './http';

export type CatalogItemInput = {
	type?: schema.CatalogItem['type'];
	name: string;
	description?: string | null;
	sku?: string | null;
	externalReference?: string | null;
	externalSource?: string | null;
	price?: string | null;
	currency?: string | null;
	imageUrl?: string | null;
	variants?: Array<Record<string, unknown>>;
	isActive?: boolean;
	metadata?: Record<string, unknown>;
};

export async function getCatalogItem(tenantId: string, id: string): Promise<schema.CatalogItem> {
	const rows = await db()
		.select()
		.from(schema.catalogItems)
		.where(and(eq(schema.catalogItems.id, id), eq(schema.catalogItems.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Catalog item could not be found.');
	return rows[0];
}

export async function listCatalogItems(
	tenantId: string,
	p: Pagination,
	filters: { activeOnly?: boolean; type?: schema.CatalogItem['type'] } = {}
) {
	const conditions: SQL[] = [eq(schema.catalogItems.tenantId, tenantId)];
	if (filters.activeOnly) conditions.push(eq(schema.catalogItems.isActive, true));
	if (filters.type) conditions.push(eq(schema.catalogItems.type, filters.type));
	if (p.q) {
		const term = `%${p.q}%`;
		conditions.push(or(ilike(schema.catalogItems.name, term), ilike(schema.catalogItems.sku, term)) as SQL);
	}
	const where = and(...conditions);
	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select()
			.from(schema.catalogItems)
			.where(where)
			.orderBy(desc(schema.catalogItems.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.catalogItems).where(where)
	]);
	return { items, total: Number(total) };
}

/** Batch fetch for form configs — tenant-scoped, active only, order preserved. */
export async function getCatalogItemsByIds(tenantId: string, ids: string[]): Promise<schema.CatalogItem[]> {
	if (!ids.length) return [];
	const rows = await db()
		.select()
		.from(schema.catalogItems)
		.where(
			and(eq(schema.catalogItems.tenantId, tenantId), eq(schema.catalogItems.isActive, true), inArray(schema.catalogItems.id, ids))
		);
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.map((id) => byId.get(id)).filter((r): r is schema.CatalogItem => !!r);
}

export async function createCatalogItem(tenantId: string, input: CatalogItemInput): Promise<schema.CatalogItem> {
	const [row] = await db()
		.insert(schema.catalogItems)
		.values({
			tenantId,
			type: input.type ?? 'PRODUCT',
			name: input.name,
			description: input.description ?? null,
			sku: input.sku?.trim() || null,
			externalReference: input.externalReference ?? null,
			externalSource: input.externalSource ?? null,
			price: input.price ?? null,
			currency: input.currency ?? null,
			imageUrl: input.imageUrl ?? null,
			variants: input.variants ?? [],
			isActive: input.isActive ?? true,
			metadata: input.metadata ?? {}
		})
		.returning();
	return row;
}

export async function updateCatalogItem(tenantId: string, id: string, input: Partial<CatalogItemInput>): Promise<schema.CatalogItem> {
	await getCatalogItem(tenantId, id);
	const [row] = await db()
		.update(schema.catalogItems)
		.set({
			...(input.type !== undefined ? { type: input.type } : {}),
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.description !== undefined ? { description: input.description } : {}),
			...(input.sku !== undefined ? { sku: input.sku?.trim() || null } : {}),
			...(input.externalReference !== undefined ? { externalReference: input.externalReference } : {}),
			...(input.price !== undefined ? { price: input.price } : {}),
			...(input.currency !== undefined ? { currency: input.currency } : {}),
			...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
			...(input.variants !== undefined ? { variants: input.variants } : {}),
			...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.catalogItems.id, id), eq(schema.catalogItems.tenantId, tenantId)))
		.returning();
	return row;
}
