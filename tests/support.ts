// Shared test helpers. The server module is imported lazily so each suite can finish
// setting process.env before anything reads it.
import type { ProvisionTenantInput } from '../src/lib/server/provisioning';

type TenantInput = Omit<ProvisionTenantInput, 'source' | 'actor'>;

/**
 * Provision a tenant the way Platform Admin does, and hand back just the tenant row.
 *
 * Tests point DATABASE_URL at whatever TEST_DATABASE_URL says. When that is a
 * transaction-pooler URL, DIRECT_DATABASE_URL must be set too, or provisioning's
 * transaction has no session connection to run on.
 */
export async function provisionTestTenant(input: TenantInput) {
	const { provisionTenant } = await import('../src/lib/server/provisioning');
	const result = await provisionTenant({ ...input, source: 'ADMIN', actor: { type: 'system' } });
	return result.tenant;
}
