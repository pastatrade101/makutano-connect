// One-off, data-derived workspace assignment for existing tenants (§7 of the
// business-aware brief). No tenant names are hardcoded: the decision comes from what
// each tenant has actually recorded. Uncertain tenants keep their current setting.
//
//   node --experimental-strip-types scripts/derive-workspaces.ts          # dry run
//   node --experimental-strip-types scripts/derive-workspaces.ts --apply
import postgres from 'postgres';

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
	console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.');
	process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
	const tenants = await sql`
		select t.id, t.slug, t.industry, t.settings->>'capabilities' as current,
			(select count(*)::int from booking_requests r where r.tenant_id = t.id) as requests,
			(select count(*)::int from bookings b where b.tenant_id = t.id) as bookings,
			(select count(*)::int from quotations q where q.tenant_id = t.id) as quotations,
			(select count(*)::int from orders o where o.tenant_id = t.id) as orders
		from tenants t where t.deleted_at is null order by t.slug`;

	for (const t of tenants) {
		const bookingActivity = t.requests + t.bookings;
		let derived: string | null = null;
		// Clear signals only; anything ambiguous keeps its current setting.
		if (bookingActivity > 0 && t.orders === 0) derived = 'BOOKINGS';
		else if (t.orders > 0 && bookingActivity === 0) derived = 'ORDERS';
		else if (t.orders > 0 && bookingActivity > 0) derived = 'HYBRID';
		else if (t.quotations > 0) derived = 'SERVICE';

		const current = t.current ?? '(unset)';
		if (!derived || derived === t.current) {
			console.log(`  keep   ${t.slug}: ${current} (requests=${t.requests} bookings=${t.bookings} orders=${t.orders} quotes=${t.quotations})`);
			continue;
		}
		console.log(`${apply ? '✱ SET   ' : '  would '} ${t.slug}: ${current} → ${derived} (requests=${t.requests} bookings=${t.bookings} orders=${t.orders} quotes=${t.quotations})`);
		if (apply) {
			await sql`
				update tenants
				set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{capabilities}', to_jsonb(${derived}::text), true),
					updated_at = now()
				where id = ${t.id}`;
			await sql`
				insert into audit_logs (tenant_id, action, actor_type, metadata)
				values (${t.id}, 'tenant.updated', 'system',
					${sql.json({ workspace: { from: t.current, to: derived }, reason: 'derived from usage (workspace migration)' })})`;
		}
	}
	console.log(apply ? 'Applied.' : 'Dry run — re-run with --apply to write.');
} finally {
	await sql.end({ timeout: 5 });
}
