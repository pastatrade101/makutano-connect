// §21 System Health — one query per signal, all cheap aggregates.
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [counts] = (await db().execute(sql`
		select
			(select count(*) from tenants where deleted_at is null)::int as tenants,
			(select count(*) from tenants where status = 'ACTIVE' and deleted_at is null)::int as active_tenants,
			(select count(*) from whatsapp_connections where status = 'CONNECTED')::int as connections,
			(select count(*) from whatsapp_connections where status in ('ERROR','REAUTH_REQUIRED'))::int as unhealthy_connections,
			(select count(*) from bookings)::int as bookings,
			(select count(*) from booking_requests where created_at > now() - interval '24 hours')::int as requests_24h,
			(select count(*) from messages where created_at > now() - interval '24 hours')::int as messages_24h,
			(select count(*) from messages where status = 'FAILED' and created_at > now() - interval '24 hours')::int as failed_messages_24h,
			(select count(*) from jobs where status = 'PENDING')::int as jobs_pending,
			(select count(*) from jobs where status = 'DEAD')::int as jobs_dead,
			(select count(*) from webhook_deliveries where status = 'DEAD')::int as webhooks_dead,
			(select count(*) from payments where status = 'FAILED')::int as payments_failed
	`)) as unknown as Array<Record<string, number>>;

	const recentJobs = (await db().execute(sql`
		select kind, status, attempts, last_error, created_at
		from jobs where status in ('DEAD','FAILED') order by created_at desc limit 10
	`)) as unknown as Array<Record<string, unknown>>;

	return { counts, recentJobs };
};
