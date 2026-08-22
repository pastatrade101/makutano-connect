import { desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const pagination = paginationFrom(url);
	const rows = await db()
		.select({ log: schema.auditLogs, tenant: schema.tenants, user: schema.users })
		.from(schema.auditLogs)
		.leftJoin(schema.tenants, eq(schema.tenants.id, schema.auditLogs.tenantId))
		.leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
		.orderBy(desc(schema.auditLogs.createdAt))
		.limit(pagination.limit)
		.offset((pagination.page - 1) * pagination.limit);
	return { rows, pagination };
};
