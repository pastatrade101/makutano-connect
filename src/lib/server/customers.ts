// Customers (§10). Every query is tenant-scoped; matching an inbound WhatsApp user to
// an existing customer is what makes the "request + conversation together" view in §17
// possible, so it lives here rather than being reinvented per caller.
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';
import { normalizePhone } from './phone';
import type { Pagination } from './http';

export type CustomerInput = {
	firstName?: string;
	lastName?: string;
	email?: string | null;
	phone?: string | null;
	whatsappPhone?: string | null;
	country?: string | null;
	language?: string | null;
	source?: schema.Customer['source'];
	notes?: string | null;
	externalReference?: string | null;
};

export async function getCustomer(tenantId: string, id: string): Promise<schema.Customer> {
	const rows = await db()
		.select()
		.from(schema.customers)
		.where(
			and(eq(schema.customers.id, id), eq(schema.customers.tenantId, tenantId), isNull(schema.customers.deletedAt))
		)
		.limit(1);
	if (!rows[0]) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer could not be found.');
	return rows[0];
}

export async function listCustomers(tenantId: string, p: Pagination) {
	const filters: SQL[] = [eq(schema.customers.tenantId, tenantId), isNull(schema.customers.deletedAt)];
	if (p.q) {
		const term = `%${p.q}%`;
		filters.push(
			or(
				ilike(schema.customers.firstName, term),
				ilike(schema.customers.lastName, term),
				ilike(schema.customers.email, term),
				ilike(schema.customers.phone, term),
				ilike(schema.customers.whatsappPhone, term)
			) as SQL
		);
	}
	const where = and(...filters);
	const [items, [{ value: total }]] = await Promise.all([
		db()
			.select()
			.from(schema.customers)
			.where(where)
			.orderBy(desc(schema.customers.createdAt))
			.limit(p.limit)
			.offset((p.page - 1) * p.limit),
		db().select({ value: count() }).from(schema.customers).where(where)
	]);
	return { items, total: Number(total) };
}

export async function createCustomer(tenantId: string, input: CustomerInput, country?: string | null) {
	const [row] = await db()
		.insert(schema.customers)
		.values({
			tenantId,
			firstName: input.firstName ?? '',
			lastName: input.lastName ?? '',
			email: input.email?.trim().toLowerCase() || null,
			phone: normalizePhone(input.phone, input.country ?? country),
			whatsappPhone: normalizePhone(input.whatsappPhone ?? input.phone, input.country ?? country),
			country: input.country ?? country ?? null,
			language: input.language ?? null,
			source: input.source ?? 'WEBSITE',
			notes: input.notes ?? null,
			externalReference: input.externalReference ?? null
		})
		.returning();
	return row;
}

export async function updateCustomer(tenantId: string, id: string, input: CustomerInput) {
	await getCustomer(tenantId, id); // tenant-scoped existence check
	const patch: Partial<typeof schema.customers.$inferInsert> = { updatedAt: new Date() };
	if (input.firstName !== undefined) patch.firstName = input.firstName;
	if (input.lastName !== undefined) patch.lastName = input.lastName;
	if (input.email !== undefined) patch.email = input.email?.trim().toLowerCase() || null;
	if (input.phone !== undefined) patch.phone = normalizePhone(input.phone, input.country);
	if (input.whatsappPhone !== undefined) patch.whatsappPhone = normalizePhone(input.whatsappPhone, input.country);
	if (input.country !== undefined) patch.country = input.country;
	if (input.language !== undefined) patch.language = input.language;
	if (input.notes !== undefined) patch.notes = input.notes;
	if (input.externalReference !== undefined) patch.externalReference = input.externalReference;

	const [row] = await db()
		.update(schema.customers)
		.set(patch)
		.where(and(eq(schema.customers.id, id), eq(schema.customers.tenantId, tenantId)))
		.returning();
	return row;
}

/**
 * Match-or-create for inbound traffic (§10, §17). Matching order is
 * whatsapp → phone → email, so the same traveller writing from the website and from
 * WhatsApp collapses into one customer record instead of two.
 */
export async function findOrCreateCustomer(
	tenantId: string,
	input: CustomerInput,
	country?: string | null
): Promise<schema.Customer> {
	const wa = normalizePhone(input.whatsappPhone ?? input.phone, input.country ?? country);
	const phone = normalizePhone(input.phone, input.country ?? country);
	const email = input.email?.trim().toLowerCase() || null;

	const conditions: SQL[] = [];
	if (wa) conditions.push(eq(schema.customers.whatsappPhone, wa));
	if (phone) conditions.push(eq(schema.customers.phone, phone));
	if (email) conditions.push(eq(schema.customers.email, email));

	if (conditions.length) {
		const rows = await db()
			.select()
			.from(schema.customers)
			.where(and(eq(schema.customers.tenantId, tenantId), isNull(schema.customers.deletedAt), or(...conditions)))
			.limit(1);
		const found = rows[0];
		if (found) {
			// Backfill blanks without overwriting anything the tenant already curated.
			const patch: Partial<typeof schema.customers.$inferInsert> = {};
			if (wa && !found.whatsappPhone) patch.whatsappPhone = wa;
			if (phone && !found.phone) patch.phone = phone;
			if (email && !found.email) patch.email = email;
			if (input.firstName && !found.firstName) patch.firstName = input.firstName;
			if (input.lastName && !found.lastName) patch.lastName = input.lastName;
			if (Object.keys(patch).length === 0) return found;
			const [updated] = await db()
				.update(schema.customers)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.customers.id, found.id))
				.returning();
			return updated;
		}
	}

	try {
		return await createCustomer(tenantId, { ...input, whatsappPhone: wa, phone }, country);
	} catch (err) {
		// A concurrent inbound message can win the race against the unique index; re-read
		// rather than failing the message that arrived second.
		if (wa) {
			const rows = await db()
				.select()
				.from(schema.customers)
				.where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.whatsappPhone, wa)))
				.limit(1);
			if (rows[0]) return rows[0];
		}
		throw err;
	}
}

export async function customerStats(tenantId: string) {
	const rows = (await db().execute<{ total: number; last_30: number }>(sql`
		select
			count(*)::int as total,
			count(*) filter (where created_at > now() - interval '30 days')::int as last_30
		from customers where tenant_id = ${tenantId}::uuid and deleted_at is null
	`)) as unknown as Array<{ total: number; last_30: number }>;
	return { total: Number(rows[0]?.total ?? 0), last30Days: Number(rows[0]?.last_30 ?? 0) };
}
