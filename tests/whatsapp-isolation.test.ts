// Two ways one tenant's WhatsApp reached another's, both found while auditing the
// Meta App Review submission. Neither failed loudly; both are the kind of bug that
// looks like "Meta is slow" from the outside.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INBOUND = readFileSync('src/lib/server/whatsapp/inbound.ts', 'utf8');
const RELAY = readFileSync('src/lib/server/whatsapp/relay.ts', 'utf8');
const SCHEMA = readFileSync('src/lib/server/db/schema.ts', 'utf8');

describe('a template approval belongs to the tenant it was approved for', () => {
	// Idempotency is a unique index on (provider, external_id, kind) with NO tenant
	// column. A wamid is globally unique so messages and statuses are fine. A template
	// event is named by template + language + status, and every tenant is issued the
	// same names from the same pack — so the first tenant approved for a name claimed
	// the row and every other tenant's approval was dropped as a duplicate, leaving
	// their templates PENDING for ever with nothing in the logs.
	it('keys the template event by tenant', () => {
		expect(INBOUND).toMatch(/`template:\$\{tenantId\}:\$\{event\.templateName\}/);
	});

	it('does not key it by name alone — the bug this replaces', () => {
		expect(INBOUND).not.toMatch(/`template:\$\{event\.templateName\}/);
	});

	it('still relies on the wamid alone where the wamid is globally unique', () => {
		expect(INBOUND).toMatch(/claimEvent\(`\$\{event\.messageId\}:\$\{event\.status\}`/);
		expect(INBOUND).toMatch(/claimEvent\(event\.messageId, 'message'/);
	});

	it('documents that the unique index carries no tenant, which is why the key must', () => {
		expect(SCHEMA).toMatch(/webhook_events_provider_external_key'\)\.on\(t\.provider, t\.externalId, t\.kind\)/);
	});
});

describe('a webhook batch spanning two tenants is relayed to neither', () => {
	// The relay forwards the EXACT bytes Meta sent, because the legacy consumer checks
	// the signature over them. Those bytes carry every entry in the batch. So a mixed
	// batch cannot go to one tenant's endpoint without handing it the other tenant's
	// customer phone numbers and message text, and it cannot be trimmed without
	// breaking the signature.
	it('resolves the owning tenant, not just the endpoint', () => {
		expect(RELAY).toMatch(/tenantId: schema\.whatsappConnections\.tenantId/);
	});

	it('returns nothing when the batch spans more than one tenant', () => {
		expect(RELAY).toMatch(/if \(tenantIds\.size > 1\)/);
		const guard = RELAY.indexOf('tenantIds.size > 1');
		const collect = RELAY.indexOf('const urls = new Set<string>()', guard);
		// The guard must come BEFORE any endpoint is collected, or it decides nothing.
		expect(guard).toBeGreaterThan(-1);
		expect(collect).toBeGreaterThan(guard);
	});

	it('says so in the log rather than dropping silently', () => {
		expect(RELAY).toMatch(/relay_skipped_mixed_tenant_batch/);
	});

	it('still relays an ordinary single-tenant delivery', () => {
		// The guard is on >1, not >=1: the normal case must be untouched.
		expect(RELAY).not.toMatch(/tenantIds\.size >= 1/);
		expect(RELAY).toMatch(/return \[\.\.\.urls\];/);
	});
});
