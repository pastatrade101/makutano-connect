// §21 Webhook Errors + Payment Errors, plus failed outbound messages — the three
// places a silent integration failure would otherwise hide.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [webhooks, payments, messages] = await Promise.all([
		db()
			.select({ delivery: schema.webhookDeliveries, endpoint: schema.webhookEndpoints, tenant: schema.tenants })
			.from(schema.webhookDeliveries)
			.innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.webhookDeliveries.tenantId))
			.where(inArray(schema.webhookDeliveries.status, ['DEAD', 'FAILED']))
			.orderBy(desc(schema.webhookDeliveries.createdAt))
			.limit(50),
		db()
			.select({ payment: schema.payments, tenant: schema.tenants })
			.from(schema.payments)
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.payments.tenantId))
			.where(eq(schema.payments.status, 'FAILED'))
			.orderBy(desc(schema.payments.createdAt))
			.limit(50),
		db()
			.select({ message: schema.messages, tenant: schema.tenants })
			.from(schema.messages)
			.innerJoin(schema.tenants, eq(schema.tenants.id, schema.messages.tenantId))
			.where(and(eq(schema.messages.status, 'FAILED'), eq(schema.messages.direction, 'OUTBOUND')))
			.orderBy(desc(schema.messages.createdAt))
			.limit(50)
	]);

	return { webhooks, payments, messages };
};
