/**
 * Give every tenant that already tracks a vehicle its own read-only provider
 * identity, and hand its existing devices to it.
 *
 * Run ONCE, as part of the Phase 1 deployment, before the new code serves
 * traffic. Until a tenant has an identity its vehicles read NOT_CONFIGURED —
 * which is honest but wrong for a tenant that was tracking a minute earlier, so
 * this closes that window deliberately rather than leaving it to a lazy path in
 * a request handler.
 *
 * Provisioning, not runtime: it uses the administrator credential, which is
 * exactly why it lives in scripts/ and not behind a route.
 *
 *   npx tsx scripts/provision-tracking-accounts.ts --dry-run
 *   npx tsx scripts/provision-tracking-accounts.ts
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../src/lib/server/db';
import { ensureTenantAccount, findDeviceByRef, linkDeviceToTenant } from '../src/lib/server/tracking/traccar-admin';
import { adminCredentials } from '../src/lib/server/tracking/credentials';

const dryRun = process.argv.includes('--dry-run');

async function main() {
	if (!adminCredentials()) {
		console.error('TRACCAR_ADMIN_USERNAME / TRACCAR_ADMIN_PASSWORD are not set. Nothing done.');
		process.exit(1);
	}

	const tracked = await db()
		.select({
			tenantId: schema.vehicles.tenantId,
			vehicleId: schema.vehicles.id,
			name: schema.vehicles.name,
			ref: schema.vehicles.trackerDeviceRef
		})
		.from(schema.vehicles)
		.where(and(isNotNull(schema.vehicles.trackerDeviceRef), eq(schema.vehicles.trackerProvider, 'TRACCAR')));

	if (!tracked.length) {
		console.log('No tenant tracks a vehicle yet. Nothing to provision.');
		return;
	}

	const byTenant = new Map<string, typeof tracked>();
	for (const row of tracked) {
		byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) ?? []), row]);
	}
	console.log(`${tracked.length} tracked vehicle(s) across ${byTenant.size} tenant(s).${dryRun ? '  DRY RUN — nothing will be written.' : ''}`);

	for (const [tenantId, vehicles] of byTenant) {
		// Never log the reference itself; it is credential material.
		console.log(`\ntenant ${tenantId}: ${vehicles.length} vehicle(s)`);
		if (dryRun) {
			for (const v of vehicles) console.log(`  would link "${v.name}"`);
			continue;
		}

		const account = await ensureTenantAccount(tenantId);
		if (!account.providerUserId) {
			console.error(`  FAILED: no provider user id recorded. Skipping this tenant.`);
			continue;
		}
		console.log(`  identity ready (provider user ${account.providerUserId})`);

		for (const v of vehicles) {
			const device = await findDeviceByRef(v.ref as string);
			if (!device?.id) {
				// The mapping names a device the provider has never heard of. Say so
				// loudly: that vehicle will read OFFLINE until it is re-enrolled.
				console.error(`  "${v.name}": no such device on the provider — will read OFFLINE until re-enrolled`);
				continue;
			}
			await linkDeviceToTenant(account.providerUserId, device.id);
			console.log(`  "${v.name}": linked`);
		}
	}
	console.log('\nDone. Verify by loading /app/vehicles as each tenant.');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('provisioning failed:', err instanceof Error ? err.message : err);
		process.exit(1);
	});
