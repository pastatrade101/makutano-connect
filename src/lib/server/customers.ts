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
 * A contact detail this submission carried that disagrees with the one already on the
 * matched record. Never resolved silently — see resolveCustomer.
 */
export type ContactConflict = {
	field: 'email' | 'phone' | 'whatsappPhone';
	submitted: string;
	onFile: string;
};

export type CustomerResolution = {
	customer: schema.Customer;
	/** True when an existing record was matched rather than a new one created. */
	matched: boolean;
	/** Which identifier matched, so the caller can judge how strong the claim is. */
	matchedOn: 'whatsapp' | 'phone' | 'email' | null;
	conflicts: ContactConflict[];
};

/**
 * Match-or-create for inbound traffic (§10, §17).
 *
 * IDENTITY MATCHING and CONTACT-DETAIL UPDATE are deliberately different operations,
 * and conflating them is what let a traveller's newly typed address be thrown away.
 *
 * Identity precedence is strict and tried one lookup at a time — whatsapp, then phone,
 * then email — rather than as one OR: a WhatsApp number is the strongest claim because
 * Meta delivered a message from it, so the person demonstrably controls it; a phone is
 * a strong but unverified handle; an email is the weakest, being free text anyone can
 * type. The previous single `or(...)` with `limit 1` and no ordering meant that when a
 * submission matched two different customers — one by phone, another by email — which
 * one won was whatever Postgres happened to return first. Each lookup is now ordered by
 * createdAt so the oldest record wins deterministically.
 *
 * Updating is conservative. Blanks are filled, because that destroys nothing. A value
 * that DISAGREES with one already on file is never written: matching on a phone does
 * not prove two submissions came from the same human — families, offices and hotel
 * front desks share numbers — so a different email arriving on a shared phone is
 * exactly the signal that this may be someone else. Those disagreements are returned
 * as conflicts for a human to settle, rather than silently choosing a winner.
 */
export async function resolveCustomer(
	tenantId: string,
	input: CustomerInput,
	country?: string | null
): Promise<CustomerResolution> {
	const wa = normalizePhone(input.whatsappPhone ?? input.phone, input.country ?? country);
	const phone = normalizePhone(input.phone, input.country ?? country);
	const email = input.email?.trim().toLowerCase() || null;

	const lookup = async (match: SQL) => {
		const rows = await db()
			.select()
			.from(schema.customers)
			.where(and(eq(schema.customers.tenantId, tenantId), isNull(schema.customers.deletedAt), match))
			.orderBy(schema.customers.createdAt)
			.limit(1);
		return rows[0] ?? null;
	};

	let found: schema.Customer | null = null;
	let matchedOn: CustomerResolution['matchedOn'] = null;
	if (wa && (found = await lookup(eq(schema.customers.whatsappPhone, wa)))) matchedOn = 'whatsapp';
	else if (phone && (found = await lookup(eq(schema.customers.phone, phone)))) matchedOn = 'phone';
	else if (email && (found = await lookup(eq(schema.customers.email, email)))) matchedOn = 'email';

	if (found) {
		const conflicts: ContactConflict[] = [];
		const patch: Partial<typeof schema.customers.$inferInsert> = {};

		// Fill blanks; report disagreements; never overwrite.
		if (wa) {
			if (!found.whatsappPhone) patch.whatsappPhone = wa;
			else if (found.whatsappPhone !== wa)
				conflicts.push({ field: 'whatsappPhone', submitted: wa, onFile: found.whatsappPhone });
		}
		if (phone) {
			if (!found.phone) patch.phone = phone;
			else if (found.phone !== phone) conflicts.push({ field: 'phone', submitted: phone, onFile: found.phone });
		}
		if (email) {
			if (!found.email) patch.email = email;
			else if (found.email !== email) conflicts.push({ field: 'email', submitted: email, onFile: found.email });
		}
		if (input.firstName && !found.firstName) patch.firstName = input.firstName;
		if (input.lastName && !found.lastName) patch.lastName = input.lastName;

		if (Object.keys(patch).length === 0) return { customer: found, matched: true, matchedOn, conflicts };
		const [updated] = await db()
			.update(schema.customers)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(schema.customers.id, found.id))
			.returning();
		return { customer: updated, matched: true, matchedOn, conflicts };
	}

	try {
		const created = await createCustomer(tenantId, { ...input, whatsappPhone: wa, phone }, country);
		return { customer: created, matched: false, matchedOn: null, conflicts: [] };
	} catch (err) {
		// A concurrent inbound message can win the race against the unique index; re-read
		// rather than failing the message that arrived second.
		if (wa) {
			const raced = await lookup(eq(schema.customers.whatsappPhone, wa));
			if (raced) return { customer: raced, matched: true, matchedOn: 'whatsapp', conflicts: [] };
		}
		throw err;
	}
}

/** The common case: the customer, without the resolution detail. */
export async function findOrCreateCustomer(
	tenantId: string,
	input: CustomerInput,
	country?: string | null
): Promise<schema.Customer> {
	const { customer } = await resolveCustomer(tenantId, input, country);
	return customer;
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
