// A quotation's reference is on a document the customer reads, so it has to
// carry the business's identity — not the document type, twice.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('quotation references', () => {
	let tenantId: string;
	let customerId: string;

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Quote Co', slug: `test-quote-${Date.now()}` } as never);
		tenantId = tenant.id;
		const { createCustomer } = await import('../src/lib/server/customers');
		customerId = (await createCustomer(tenantId, { firstName: 'Anna', lastName: 'Berg' })).id;
	}, 120_000);

	it('does not put the document kind in the reference twice', async () => {
		// quotation_prefix defaulted to 'QT' while nextReference already adds the
		// 'QT' kind, so tenants who never set a prefix sent out QT-QT-2026-00001 —
		// their own identity missing from their own quotation. emnel has three.
		const { createQuotation } = await import('../src/lib/server/quotations');
		const q = await createQuotation(tenantId, {
			customerId,
			currency: 'USD',
			items: [{ title: 'Serengeti 5 days', quantity: 2, unitPrice: '1200.00' }]
		} as never);
		expect(q.reference).not.toMatch(/^QT-QT-/);
		expect(q.reference).toMatch(/^[A-Z0-9]+-QT-\d{4}-\d{5}$/);
	}, 90_000);
});
