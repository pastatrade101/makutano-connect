// Customer identity: matching a person, versus updating how to reach them.
//
// A live enquiry submitted pastory56@gmail.com and the quotation was emailed to
// pastoryjoseph2014@gmail.com, because the record matched on phone and the backfill
// only ever filled blanks. The traveller never received their quote and no screen
// said so. These tests pin the two rules that came out of that:
//
//   1. Identity precedence is deterministic — whatsapp, then phone, then email.
//   2. A contact detail that DISAGREES with the record is reported, never written
//      and never silently discarded.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

suite('customer identity', () => {
	let tenantId: string;
	let resolveCustomer: (typeof import('../src/lib/server/customers'))['resolveCustomer'];
	let createCustomer: (typeof import('../src/lib/server/customers'))['createCustomer'];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({
			name: 'Identity Test Safaris',
			slug: `identity-${Date.now()}`,
			planCode: 'STARTER'
		});
		tenantId = tenant.id;
		({ resolveCustomer, createCustomer } = await import('../src/lib/server/customers'));
	});

	it('fills a blank contact detail, because that destroys nothing', async () => {
		const existing = await createCustomer(tenantId, {
			firstName: 'Blank',
			lastName: 'Filler',
			phone: '+255700000001',
			country: 'TZ'
		});
		expect(existing.email).toBeNull();

		const { customer, conflicts, matched } = await resolveCustomer(
			tenantId,
			{ firstName: 'Blank', phone: '+255700000001', email: 'blank.filler@example.com' },
			'TZ'
		);
		expect(matched).toBe(true);
		expect(customer.id).toBe(existing.id);
		expect(customer.email).toBe('blank.filler@example.com');
		expect(conflicts).toHaveLength(0);
	});

	it('reports a changed email instead of discarding it, and never overwrites the record', async () => {
		const existing = await createCustomer(tenantId, {
			firstName: 'Pastory',
			lastName: 'Joseph',
			phone: '+255700000002',
			email: 'old.address@example.com',
			country: 'TZ'
		});

		const { customer, conflicts } = await resolveCustomer(
			tenantId,
			{ firstName: 'Pastory', phone: '+255700000002', email: 'new.address@example.com' },
			'TZ'
		);

		// The record is authoritative until a human says otherwise...
		expect(customer.id).toBe(existing.id);
		expect(customer.email).toBe('old.address@example.com');
		// ...but the newly typed address is surfaced, not thrown away. This is the whole
		// bug: it used to vanish, and the quote went to the old address in silence.
		expect(conflicts).toEqual([
			{ field: 'email', submitted: 'new.address@example.com', onFile: 'old.address@example.com' }
		]);
	});

	it('prefers a WhatsApp identity when the identifiers point at different people', async () => {
		const viaWhatsapp = await createCustomer(tenantId, {
			firstName: 'Wa',
			whatsappPhone: '+255700000003',
			email: 'wa.owner@example.com',
			country: 'TZ'
		});
		const viaEmail = await createCustomer(tenantId, {
			firstName: 'Mail',
			email: 'mail.owner@example.com',
			country: 'TZ'
		});

		// This submission matches two DIFFERENT records — one by WhatsApp, one by email.
		// Under the old single `or(...) limit 1` the winner was whatever Postgres returned.
		// WhatsApp wins now, because Meta delivered a message from that number, so the
		// person demonstrably controls it; an email is free text anyone can type.
		const { customer, matchedOn, conflicts } = await resolveCustomer(
			tenantId,
			{ whatsappPhone: '+255700000003', email: 'mail.owner@example.com' },
			'TZ'
		);
		expect(matchedOn).toBe('whatsapp');
		expect(customer.id).toBe(viaWhatsapp.id);
		expect(customer.id).not.toBe(viaEmail.id);
		// And the email it did not adopt is reported rather than lost.
		expect(conflicts).toEqual([
			{ field: 'email', submitted: 'mail.owner@example.com', onFile: 'wa.owner@example.com' }
		]);
	});

	it('collapses a second person on a shared number onto the first — a real limitation', async () => {
		// Two people CANNOT share a number in one tenant. createCustomer copies phone into
		// whatsapp_phone when no WhatsApp number is given (customers.ts), and
		// customers_tenant_whatsapp_key is UNIQUE per tenant — so the second insert
		// violates it and the caller falls back to the record that already exists.
		//
		// Pinned as current behaviour, not endorsed: a family or an office front desk
		// genuinely shares a line. What matters for correctness today is that the second
		// person's details are not written over the first person's — which is exactly what
		// the conflict list is for.
		const parent = await createCustomer(tenantId, {
			firstName: 'Parent',
			phone: '+255700000009',
			email: 'parent@example.com',
			country: 'TZ'
		});

		const { customer, matched, conflicts } = await resolveCustomer(
			tenantId,
			{ firstName: 'Offspring', phone: '+255700000009', email: 'offspring@example.com' },
			'TZ'
		);

		expect(matched).toBe(true);
		expect(customer.id).toBe(parent.id);
		// The record keeps its own address...
		expect(customer.email).toBe('parent@example.com');
		// ...and the second person's is surfaced instead of overwriting it or vanishing.
		expect(conflicts).toEqual([{ field: 'email', submitted: 'offspring@example.com', onFile: 'parent@example.com' }]);
	});

	it('is deterministic when two records genuinely share a phone', async () => {
		// Phone is the only non-unique identifier (customers_tenant_phone_idx is a plain
		// btree), so it is the one lane where "which row?" was undefined. Built directly,
		// with whatsapp_phone left null, because createCustomer cannot produce this pair.
		const { db, schema } = await import('../src/lib/server/db');
		const rows = await db()
			.insert(schema.customers)
			.values([
				{ tenantId, firstName: 'Older', phone: '255700000011', email: 'older@example.com', country: 'TZ' },
				{ tenantId, firstName: 'Newer', phone: '255700000011', email: 'newer@example.com', country: 'TZ' }
			])
			.returning();
		const oldest = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

		// The first call matches on the phone lane and then backfills the blank
		// whatsapp_phone, so later calls legitimately match on the whatsapp lane instead.
		// The lane is allowed to change; the ANSWER is not.
		const first = await resolveCustomer(tenantId, { phone: '+255700000011' }, 'TZ');
		expect(first.matchedOn).toBe('phone');
		expect(first.customer.id).toBe(oldest.id);

		for (let i = 0; i < 3; i += 1) {
			const { customer } = await resolveCustomer(tenantId, { phone: '+255700000011' }, 'TZ');
			expect(customer.id).toBe(oldest.id);
		}
	});

	it('creates a new traveller when nothing matches', async () => {
		const { matched, matchedOn, conflicts, customer } = await resolveCustomer(
			tenantId,
			{ firstName: 'Brand', lastName: 'New', email: 'brand.new@example.com' },
			'TZ'
		);
		expect(matched).toBe(false);
		expect(matchedOn).toBeNull();
		expect(conflicts).toHaveLength(0);
		expect(customer.email).toBe('brand.new@example.com');
	});
});
