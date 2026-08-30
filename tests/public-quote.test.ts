// The customer's half of a quotation.
//
// Connect could always BUILD a quote; it could not deliver one it originated,
// because the QUOTATION_READY template's link came only from metadata that the
// legacy site populated, and the engine skips a send with an empty variable.
// These tests are about the link existing, being stable, and being the only key
// anyone outside the business needs — or can use.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('the public quotation link', () => {
	let tenantId: string;
	let customerId: string;

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Quote Co', slug: `test-quote-${Date.now()}` } as never);
		tenantId = tenant.id;
		const { createCustomer } = await import('../src/lib/server/customers');
		customerId = (await createCustomer(tenantId, { firstName: 'Anna', lastName: 'Berg' })).id;
	}, 120_000);

	const draft = async (over: Record<string, unknown> = {}) => {
		const { createQuotation } = await import('../src/lib/server/quotations');
		return createQuotation(tenantId, {
			customerId,
			currency: 'USD',
			items: [{ title: 'Serengeti 5 days', quantity: 2, unitPrice: '1200.00' }],
			...over
		} as never);
	};

	it('does not put the document kind in the reference twice', async () => {
		// The column used to default to 'QT' while nextReference already adds the
		// 'QT' kind, so tenants who never set a prefix sent out
		// QT-QT-2026-00001 — their own identity missing from their own quote.
		const q = await draft();
		expect(q.reference).not.toMatch(/^QT-QT-/);
		expect(q.reference).toMatch(/^[A-Z0-9]+-QT-\d{4}-\d{5}$/);
	}, 60_000);

	it('has no link until it is sent', async () => {
		// A draft nobody has seen has no business having a live URL.
		const { getQuotation, quotationPublicUrl } = await import('../src/lib/server/quotations');
		const q = await draft();
		const stored = await getQuotation(tenantId, q.id);
		expect(stored.publicToken).toBeNull();
		expect(quotationPublicUrl(stored.publicToken)).toBe('');
	}, 60_000);

	it('mints a link on send and keeps the same one on resend', async () => {
		// The customer may hold this for weeks. A resend that rotated it would
		// silently break the copy already in their WhatsApp thread.
		const { sendQuotation } = await import('../src/lib/server/quotations');
		const q = await draft();
		const first = await sendQuotation(tenantId, q.id);
		expect(first.publicToken).toMatch(/^qt_/);
		const second = await sendQuotation(tenantId, q.id);
		expect(second.publicToken).toBe(first.publicToken);
	}, 90_000);

	it('opens for the holder, and marks it viewed', async () => {
		const { sendQuotation, getPublicQuotation, getQuotation } = await import('../src/lib/server/quotations');
		const sent = await sendQuotation(tenantId, (await draft()).id);
		const view = await getPublicQuotation(sent.publicToken!);
		expect(view?.reference).toBe(sent.reference);
		expect(view?.business.name).toBe('Quote Co');
		expect(view?.items).toHaveLength(1);
		expect(view?.decidable).toBe(true);

		await new Promise((r) => setTimeout(r, 300));
		expect((await getQuotation(tenantId, sent.id)).status).toBe('VIEWED');
	}, 90_000);

	it('shows nothing for a token that is not one', async () => {
		// A wrong token and a missing quotation must be indistinguishable.
		const { getPublicQuotation } = await import('../src/lib/server/quotations');
		expect(await getPublicQuotation('qt_definitely_not_a_real_token')).toBeNull();
		expect(await getPublicQuotation('')).toBeNull();
	}, 60_000);

	it('never exposes what belongs to the business', async () => {
		// notes are internal; the version history and owning user are nobody
		// else's business. This is read by someone outside the company.
		const { sendQuotation, getPublicQuotation } = await import('../src/lib/server/quotations');
		const sent = await sendQuotation(tenantId, (await draft({ notes: 'Margin is thin, do not discount' })).id);
		const view = (await getPublicQuotation(sent.publicToken!)) as Record<string, unknown>;
		for (const leak of ['notes', 'versions', 'createdByUserId', 'id', 'tenantId', 'subtotal']) {
			expect(view).not.toHaveProperty(leak);
		}
		expect(JSON.stringify(view)).not.toContain('Margin is thin');
	}, 90_000);

	it('accepts from the link, and says the same thing twice', async () => {
		const { sendQuotation, acceptPublicQuotation } = await import('../src/lib/server/quotations');
		const sent = await sendQuotation(tenantId, (await draft()).id);
		const first = await acceptPublicQuotation(sent.publicToken!);
		const second = await acceptPublicQuotation(sent.publicToken!);
		// Idempotent: a customer double-tapping must not buy the trip twice.
		expect(second.booking.id).toBe(first.booking.id);
	}, 120_000);

	it('refuses an expired quote rather than quietly honouring it', async () => {
		const { sendQuotation, acceptPublicQuotation, getPublicQuotation } = await import('../src/lib/server/quotations');
		const q = await draft({ validUntil: new Date(Date.now() - 86_400_000).toISOString() });
		const sent = await sendQuotation(tenantId, q.id);
		const view = await getPublicQuotation(sent.publicToken!);
		expect(view?.expired).toBe(true);
		expect(view?.decidable).toBe(false);
		await expect(acceptPublicQuotation(sent.publicToken!)).rejects.toThrow(/expired/i);
	}, 90_000);

	it('will not let a declined quote be accepted behind the customer', async () => {
		const { sendQuotation, declinePublicQuotation, acceptPublicQuotation } = await import(
			'../src/lib/server/quotations'
		);
		const sent = await sendQuotation(tenantId, (await draft()).id);
		await declinePublicQuotation(sent.publicToken!, 'Dates changed');
		await expect(acceptPublicQuotation(sent.publicToken!)).rejects.toThrow(/declined/i);
	}, 90_000);
});
