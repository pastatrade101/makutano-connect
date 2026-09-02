import { error, redirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// Super admin is a property of the user, never of a tenant membership (§3).
	if (!locals.user.isSuperAdmin) error(403, 'This area is restricted.');

	// Feed for the topbar alerts bell: things an operator must act on.
	const [row] = (await db().execute(sql`
		select
			(select count(*) from webhook_deliveries where status = 'DEAD')::int as webhooks_dead,
			(select count(*) from payments where status = 'FAILED')::int as payments_failed,
			(select count(*) from jobs where status = 'DEAD')::int as jobs_dead,
			(select count(*) from whatsapp_connections where status in ('ERROR','REAUTH_REQUIRED'))::int as connections_unhealthy,
			/* Operators carrying no badge, counted for the nav so the queue is visible
			   without opening it. Deliberately NOT folded into the attention total
			   above: that bell is for things that are broken, and an operator waiting
			   to be checked is work, not a fault. */
			(select count(*) from operator_profiles where is_active and not is_verified)::int as operators_awaiting
	`)) as unknown as Array<Record<string, number>>;
	const attention =
		Number(row?.webhooks_dead ?? 0) +
		Number(row?.payments_failed ?? 0) +
		Number(row?.jobs_dead ?? 0) +
		Number(row?.connections_unhealthy ?? 0);

	return {
		user: { id: locals.user.id, email: locals.user.email, fullName: locals.user.fullName, isSuperAdmin: true },
		attention,
		operatorsAwaiting: Number(row?.operators_awaiting ?? 0)
	};
};
