import { desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { toSafeConnection } from '$lib/server/whatsapp/connections';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db()
		.select({ connection: schema.whatsappConnections, tenant: schema.tenants })
		.from(schema.whatsappConnections)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.whatsappConnections.tenantId))
		.orderBy(desc(schema.whatsappConnections.updatedAt));

	// Even for a super admin the response carries no token material (§29).
	return {
		connections: rows.map((r) => ({
			...toSafeConnection(r.connection),
			tenantName: r.tenant.name,
			tenantId: r.tenant.id
		}))
	};
};
