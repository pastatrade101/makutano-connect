// Leads (§10). A lead is the sales-pipeline view of a customer; stages are fixed by
// the spec and transitions are recorded through the shared event bus so notifications
// and client webhooks stay in sync.
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import type { Pagination } from './http';
import type { Lead } from './db/schema';

export type LeadInput = {
	customerId?: string | null;
	stage?: Lead['stage'];
	source?: Lead['source'];
	title?: string | null;
	notes?: string | null;
	value?: string | null;
	currency?: string | null;
	assigneeUserId?: string | null;
	externalReference?: string | null;
};

export async function getLead(tenantId: string, id: string): Promise<Lead> {
	const rows = await db()
		.select()
		.from(schema.leads)
		.where(and(eq(schema.leads.id, id), eq(schema.leads.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('LEAD_NOT_FOUND', 'Lead could not be found.');
	return rows[0];
}

export async function listLeads(tenantId: string, p: Pagination, filters: { stage?: Lead['stage'] } = {}) {
	const conditions: SQL[] = [eq(schema.leads.tenantId, tenantId)];
	if (filters.stage) conditions.push(eq(schema.leads.stage, filters.stage));
	const where = and(...conditions);
	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select({ lead: schema.leads, customer: schema.customers })
			.from(schema.leads)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.leads.customerId))
			.where(where)
			.orderBy(desc(schema.leads.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.leads).where(where)
	]);
	return { items, total: Number(total) };
}

export async function createLead(tenantId: string, input: LeadInput): Promise<Lead> {
	const [row] = await db()
		.insert(schema.leads)
		.values({
			tenantId,
			customerId: input.customerId ?? null,
			stage: input.stage ?? 'NEW',
			source: input.source ?? 'WEBSITE',
			title: input.title ?? null,
			notes: input.notes ?? null,
			value: input.value ?? null,
			currency: input.currency ?? null,
			assigneeUserId: input.assigneeUserId ?? null,
			externalReference: input.externalReference ?? null
		})
		.returning();
	return row;
}

export async function updateLead(tenantId: string, id: string, input: LeadInput): Promise<Lead> {
	await getLead(tenantId, id);
	const [row] = await db()
		.update(schema.leads)
		.set({
			...(input.stage !== undefined ? { stage: input.stage } : {}),
			...(input.title !== undefined ? { title: input.title } : {}),
			...(input.notes !== undefined ? { notes: input.notes } : {}),
			...(input.value !== undefined ? { value: input.value } : {}),
			...(input.currency !== undefined ? { currency: input.currency } : {}),
			...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
			...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.leads.id, id), eq(schema.leads.tenantId, tenantId)))
		.returning();
	return row;
}
