// The people who run a trip: drivers, guides, specialists.
//
// A registry, not a set of user accounts. A safari driver usually has no
// company email and no reason to log into anything, and every membership
// consumes a plan seat — so requiring an invite just to record who is driving
// would price the feature out of the job it exists for. `userId` links a crew
// member to a portal account for the day one of them genuinely needs the app.
//
// Crew are DEACTIVATED, never deleted: a trip that ran last year still names
// the driver who ran it, and deleting the row would quietly rewrite that.
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { db, schema } from './db';
import { assertAllowed } from './entitlements';
import { AppError } from './errors';

export type CrewInput = {
	type?: schema.Crew['type'];
	name: string;
	phone?: string | null;
	email?: string | null;
	licenceNumber?: string | null;
	notes?: string | null;
	userId?: string | null;
	isActive?: boolean;
};

export async function listCrew(
	tenantId: string,
	filters: { type?: schema.Crew['type'][]; activeOnly?: boolean } = {}
) {
	const clauses: SQL[] = [eq(schema.crew.tenantId, tenantId)];
	if (filters.type?.length) clauses.push(inArray(schema.crew.type, filters.type));
	if (filters.activeOnly) clauses.push(eq(schema.crew.isActive, true));
	return db()
		.select()
		.from(schema.crew)
		.where(and(...clauses))
		.orderBy(asc(schema.crew.name));
}

export async function getCrew(tenantId: string, id: string): Promise<schema.Crew> {
	const [row] = await db()
		.select()
		.from(schema.crew)
		.where(and(eq(schema.crew.id, id), eq(schema.crew.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'That person could not be found.');
	return row;
}

export async function createCrew(tenantId: string, input: CrewInput): Promise<schema.Crew> {
	await assertAllowed(tenantId, { feature: 'bookings.enabled' });
	const name = input.name?.trim();
	if (!name) throw new AppError('VALIDATION_ERROR', 'A name is required.');

	const [row] = await db()
		.insert(schema.crew)
		.values({
			tenantId,
			type: input.type ?? 'DRIVER',
			name,
			phone: input.phone?.trim() || null,
			email: input.email?.trim() || null,
			licenceNumber: input.licenceNumber?.trim() || null,
			notes: input.notes?.trim() || null,
			userId: input.userId ?? null
		})
		.returning();
	return row;
}

export async function updateCrew(tenantId: string, id: string, input: Partial<CrewInput>): Promise<schema.Crew> {
	await assertAllowed(tenantId);
	await getCrew(tenantId, id);

	const patch: Partial<typeof schema.crew.$inferInsert> = { updatedAt: new Date() };
	if (input.type !== undefined) patch.type = input.type;
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new AppError('VALIDATION_ERROR', 'A name is required.');
		patch.name = name;
	}
	if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
	if (input.email !== undefined) patch.email = input.email?.trim() || null;
	if (input.licenceNumber !== undefined) patch.licenceNumber = input.licenceNumber?.trim() || null;
	if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
	if (input.userId !== undefined) patch.userId = input.userId;
	if (input.isActive !== undefined) patch.isActive = input.isActive;

	const [row] = await db()
		.update(schema.crew)
		.set(patch)
		.where(and(eq(schema.crew.id, id), eq(schema.crew.tenantId, tenantId)))
		.returning();
	return row;
}

/**
 * What a trip's crew pickers offer, in one query.
 *
 * Active crew only — a departure must not be handed to somebody who has left —
 * but a trip that already names an inactive person keeps showing them, because
 * the trip stores the name as well as the link.
 */
export async function crewForPicker(tenantId: string) {
	const rows = await listCrew(tenantId, { activeOnly: true });
	return {
		drivers: rows.filter((r) => r.type === 'DRIVER').map(pick),
		guides: rows.filter((r) => r.type === 'GUIDE' || r.type === 'SPECIALIST').map(pick)
	};
}

const pick = (r: schema.Crew) => ({ id: r.id, name: r.name, phone: r.phone, type: r.type });

/**
 * Accommodations a trip can be assigned, from the tenant's own catalog.
 *
 * The catalog is where a tenant's lodges live, and a tenant whose CMS is the
 * source of truth pushes them in through the same /api/v1/catalog it already
 * uses — so Connect never asks anyone to maintain the same list twice.
 */
export async function accommodationsForPicker(tenantId: string) {
	const rows = await db()
		.select({ id: schema.catalogItems.id, name: schema.catalogItems.name })
		.from(schema.catalogItems)
		.where(
			and(
				eq(schema.catalogItems.tenantId, tenantId),
				eq(schema.catalogItems.type, 'ACCOMMODATION'),
				eq(schema.catalogItems.isActive, true)
			)
		)
		.orderBy(asc(schema.catalogItems.name));
	return rows;
}
