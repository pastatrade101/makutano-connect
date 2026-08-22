// Tenant-isolation, API-authentication, lifecycle and idempotency tests (§36, §37).
//
// These are MANDATORY per the spec and they run against a real Postgres. Point
// TEST_DATABASE_URL at a scratch database (its data is created and torn down here);
// without it the suite skips loudly rather than pretending to have passed.
//
//   createdb makutano_test
//   TEST_DATABASE_URL=postgres://localhost:5432/makutano_test npm run db:migrate
//   TEST_DATABASE_URL=postgres://localhost:5432/makutano_test npm test
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

if (!TEST_DB) {
	console.warn('\n⚠️  TEST_DATABASE_URL is not set — tenant-isolation and lifecycle tests were SKIPPED.\n');
}

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	tenants: typeof import('../src/lib/server/tenants');
	apiKeys: typeof import('../src/lib/server/api-keys');
	requests: typeof import('../src/lib/server/booking-requests');
	bookings: typeof import('../src/lib/server/bookings');
	quotations: typeof import('../src/lib/server/quotations');
	customers: typeof import('../src/lib/server/customers');
	idempotency: typeof import('../src/lib/server/idempotency');
	connections: typeof import('../src/lib/server/whatsapp/connections');
	inbound: typeof import('../src/lib/server/whatsapp/inbound');
};

let ctx: Ctx;
let tenantA: { id: string; slug: string };
let tenantB: { id: string; slug: string };
let keyA: string;
let keyB: string;
const stamp = Date.now();

suite('multi-tenant engine', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			tenants: await import('../src/lib/server/tenants'),
			apiKeys: await import('../src/lib/server/api-keys'),
			requests: await import('../src/lib/server/booking-requests'),
			bookings: await import('../src/lib/server/bookings'),
			quotations: await import('../src/lib/server/quotations'),
			customers: await import('../src/lib/server/customers'),
			idempotency: await import('../src/lib/server/idempotency'),
			connections: await import('../src/lib/server/whatsapp/connections'),
			inbound: await import('../src/lib/server/whatsapp/inbound')
		};

		tenantA = await ctx.tenants.provisionTenant({
			name: 'Tenant A Safaris',
			slug: `test-a-${stamp}`,
			bookingReferencePrefix: 'TSTA'
		});
		tenantB = await ctx.tenants.provisionTenant({
			name: 'Tenant B Tours',
			slug: `test-b-${stamp}`,
			bookingReferencePrefix: 'TSTB'
		});
		keyA = (await ctx.apiKeys.createApiKey({ tenantId: tenantA.id, name: 'A' })).secret;
		keyB = (await ctx.apiKeys.createApiKey({ tenantId: tenantB.id, name: 'B' })).secret;
	}, 60_000);

	afterAll(async () => {
		if (!ctx?.db) return;
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		// Cascades clean up every child row.
		await db()
			.delete(schema.tenants)
			.where(inArray(schema.tenants.id, [tenantA.id, tenantB.id]));
		await ctx.db.closeDb();
	});

	/* ------------------------------------------------ §36 tenant isolation -- */

	it('an API key resolves its OWN tenant and nothing else', async () => {
		const authA = await ctx.apiKeys.authenticateApiKey(`Bearer ${keyA}`);
		const authB = await ctx.apiKeys.authenticateApiKey(`Bearer ${keyB}`);
		expect(authA.tenant.id).toBe(tenantA.id);
		expect(authB.tenant.id).toBe(tenantB.id);
		expect(authA.tenant.id).not.toBe(authB.tenant.id);
	});

	it('rejects an invalid, malformed or absent API key', async () => {
		await expect(ctx.apiKeys.authenticateApiKey('Bearer mk_live_not_a_real_key')).rejects.toMatchObject({
			code: 'API_KEY_INVALID'
		});
		await expect(ctx.apiKeys.authenticateApiKey('Bearer garbage')).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
		await expect(ctx.apiKeys.authenticateApiKey(null)).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
	});

	it('a revoked key stops working immediately (§36)', async () => {
		const throwaway = await ctx.apiKeys.createApiKey({ tenantId: tenantA.id, name: 'throwaway' });
		await expect(ctx.apiKeys.authenticateApiKey(`Bearer ${throwaway.secret}`)).resolves.toBeTruthy();
		await ctx.apiKeys.revokeApiKey(tenantA.id, throwaway.id);
		await expect(ctx.apiKeys.authenticateApiKey(`Bearer ${throwaway.secret}`)).rejects.toMatchObject({
			code: 'API_KEY_REVOKED'
		});
	});

	it('tenant A cannot read tenant B records (§36)', async () => {
		const { request: requestB } = await ctx.requests.createBookingRequest(tenantB.id, {
			customer: { firstName: 'Bee', whatsappPhone: `2557${stamp.toString().slice(-8)}` },
			sendAcknowledgement: false
		});

		// The same id, read as the other tenant, must not resolve.
		await expect(ctx.requests.getBookingRequest(tenantA.id, requestB.id)).rejects.toMatchObject({
			code: 'BOOKING_REQUEST_NOT_FOUND'
		});
		await expect(ctx.requests.getBookingRequest(tenantB.id, requestB.id)).resolves.toBeTruthy();
	});

	it('a tenant id from the caller is never authorization — updates stay scoped', async () => {
		const { request } = await ctx.requests.createBookingRequest(tenantA.id, {
			customer: { firstName: 'Ay', email: `ay-${stamp}@example.com` },
			sendAcknowledgement: false
		});
		// Tenant B "claims" A's record by id. Every write goes through the same scoped
		// where-clause, so it fails rather than silently mutating another tenant's row.
		await expect(
			ctx.requests.updateBookingRequest(tenantB.id, request.id, { status: 'CANCELLED' })
		).rejects.toBeTruthy();
		const untouched = await ctx.requests.getBookingRequest(tenantA.id, request.id);
		expect(untouched.status).toBe('NEW');
	});

	it('customers with the same phone are separate records per tenant', async () => {
		const phone = `25571${stamp.toString().slice(-7)}`;
		const a = await ctx.customers.findOrCreateCustomer(tenantA.id, { whatsappPhone: phone, firstName: 'Shared' });
		const b = await ctx.customers.findOrCreateCustomer(tenantB.id, { whatsappPhone: phone, firstName: 'Shared' });
		expect(a.id).not.toBe(b.id);
		await expect(ctx.customers.getCustomer(tenantB.id, a.id)).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
	});

	it('tenant A cannot send with tenant B WhatsApp credentials (§36)', async () => {
		await ctx.connections.upsertConnection({
			tenantId: tenantB.id,
			phoneNumberId: `pnid-b-${stamp}`,
			displayPhoneNumber: '+255 700 000 002',
			accessToken: 'tenant-b-secret-token'
		});

		// A has no connection of its own: it must get nothing, not B's credentials.
		expect(await ctx.connections.resolveCredentials(tenantA.id)).toBeNull();
		await expect(ctx.connections.requireCredentials(tenantA.id)).rejects.toMatchObject({
			code: 'WHATSAPP_NOT_CONNECTED'
		});

		const credentialsB = await ctx.connections.resolveCredentials(tenantB.id);
		expect(credentialsB?.accessToken).toBe('tenant-b-secret-token');
		expect(credentialsB?.tenantId).toBe(tenantB.id);
	});

	it('an inbound number routes to exactly one tenant', async () => {
		const phoneNumberId = `pnid-route-${stamp}`;
		await ctx.connections.upsertConnection({ tenantId: tenantA.id, phoneNumberId, accessToken: 'token-a' });
		const routed = await ctx.connections.resolveTenantByPhoneNumberId(phoneNumberId);
		expect(routed?.tenantId).toBe(tenantA.id);
		expect(await ctx.connections.resolveTenantByPhoneNumberId('pnid-nobody-owns')).toBeNull();
	});

	it('stores WhatsApp tokens encrypted, never in plaintext (§8)', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const rows = await db()
			.select()
			.from(schema.whatsappConnections)
			.where(eq(schema.whatsappConnections.tenantId, tenantB.id))
			.limit(1);
		expect(rows[0].encryptedAccessToken).not.toContain('tenant-b-secret-token');
		expect(rows[0].encryptedAccessToken.startsWith('v1.')).toBe(true);
	});

	/* --------------------------------------------------- §14 references ----- */

	it('generates per-tenant, gap-free references under concurrency', async () => {
		const refs = await Promise.all(
			Array.from({ length: 10 }, () => ctx.db.db()).map((database) =>
				import('../src/lib/server/db/references').then((m) => m.nextReference(database, tenantA.id, 'BK', 'TSTA'))
			)
		);
		expect(new Set(refs).size).toBe(10); // no duplicates — this is what COUNT+1 gets wrong
		expect(refs[0]).toMatch(/^TSTA-BK-\d{4}-\d{5}$/);
	});

	/* ------------------------------------------------- §28 idempotency ----- */

	it('a duplicate Idempotency-Key creates ONE booking request (§36)', async () => {
		const body = { customer: { firstName: 'Idem', email: `idem-${stamp}@example.com` }, sendAcknowledgement: false };
		const params = {
			tenantId: tenantA.id,
			endpoint: 'POST /api/v1/booking-requests',
			key: `key-${stamp}`,
			method: 'POST',
			path: '/api/v1/booking-requests',
			body
		};

		const first = await ctx.idempotency.withIdempotency(params, async () => {
			const { request } = await ctx.requests.createBookingRequest(tenantA.id, body as never);
			return { status: 201, body: { id: request.id, reference: request.reference } };
		});
		const second = await ctx.idempotency.withIdempotency(params, async () => {
			throw new Error('the operation must not run twice');
		});

		expect(first.replayed).toBe(false);
		expect(second.replayed).toBe(true);
		expect(second.body.id).toBe(first.body.id);
	});

	it('rejects the same key reused with a different body', async () => {
		const key = `conflict-${stamp}`;
		const base = { tenantId: tenantA.id, endpoint: 'POST /api/v1/test', key, method: 'POST', path: '/api/v1/test' };
		await ctx.idempotency.withIdempotency({ ...base, body: { a: 1 } }, async () => ({
			status: 200,
			body: { ok: true }
		}));
		await expect(
			ctx.idempotency.withIdempotency({ ...base, body: { a: 2 } }, async () => ({ status: 200, body: { ok: true } }))
		).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
	});

	it('scopes idempotency keys per tenant — B reusing A key runs its own operation', async () => {
		const key = `shared-key-${stamp}`;
		let bRan = false;
		await ctx.idempotency.withIdempotency(
			{ tenantId: tenantA.id, endpoint: 'POST /x', key, method: 'POST', path: '/x', body: {} },
			async () => ({ status: 200, body: { tenant: 'A' } })
		);
		const b = await ctx.idempotency.withIdempotency(
			{ tenantId: tenantB.id, endpoint: 'POST /x', key, method: 'POST', path: '/x', body: {} },
			async () => {
				bRan = true;
				return { status: 200, body: { tenant: 'B' } };
			}
		);
		expect(bRan).toBe(true);
		expect(b.body.tenant).toBe('B');
	});

	/* -------------------------------------------- §9 webhook idempotency --- */

	it('a duplicate Meta webhook creates ONE message (§36)', async () => {
		const phoneNumberId = `pnid-dedupe-${stamp}`;
		await ctx.connections.upsertConnection({ tenantId: tenantA.id, phoneNumberId, accessToken: 'token-a' });
		const event = {
			kind: 'message' as const,
			phoneNumberId,
			wabaId: null,
			from: `2557${stamp.toString().slice(-8)}`,
			messageId: `wamid.dupe.${stamp}`,
			timestamp: '1700000000',
			type: 'text',
			text: 'Hello twice',
			contactName: 'Repeat Sender',
			raw: {}
		};

		await ctx.inbound.processInboundEvent(event);
		await ctx.inbound.processInboundEvent(event); // Meta retries; we must not double-store

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const stored = await db().select().from(schema.messages).where(eq(schema.messages.waMessageId, event.messageId));
		expect(stored).toHaveLength(1);
		expect(stored[0].tenantId).toBe(tenantA.id);
	});

	it('drops an event for a number no tenant owns', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const messageId = `wamid.orphan.${stamp}`;
		await ctx.inbound.processInboundEvent({
			kind: 'message',
			phoneNumberId: 'pnid-unknown-to-us',
			wabaId: 'waba-unknown-to-us',
			from: '255700000000',
			messageId,
			timestamp: '1700000000',
			type: 'text',
			text: 'Nobody owns this number',
			contactName: null,
			raw: {}
		});
		const stored = await db().select().from(schema.messages).where(eq(schema.messages.waMessageId, messageId));
		expect(stored).toHaveLength(0);
	});

	/* --------------------------------------- §11–§17 booking lifecycle ----- */

	it('runs the full request → quotation → booking → payment lifecycle', async () => {
		const { request, customer, conversationId } = await ctx.requests.createBookingRequest(tenantA.id, {
			customer: { firstName: 'Lifecycle', lastName: 'Traveller', whatsappPhone: `2556${stamp.toString().slice(-8)}` },
			adults: 2,
			items: [
				{
					title: '3-day Serengeti',
					unitPrice: '1200.00',
					quantity: 2,
					externalReference: 'serengeti-3d',
					externalSource: 'client-cms'
				}
			],
			sendAcknowledgement: false
		});

		// §11: a web form submission is a REQUEST, not a confirmed booking.
		expect(request.status).toBe('NEW');
		expect(request.reference).toMatch(/^TSTA-RQ-\d{4}-\d{5}$/);
		// §17: customer, request and conversation are linked from the start.
		expect(conversationId).toBeTruthy();

		const quotation = await ctx.quotations.createQuotation(tenantA.id, {
			bookingRequestId: request.id,
			customerId: customer.id,
			items: [{ title: '3-day Serengeti', unitPrice: '1200.00', quantity: 2 }],
			discount: '100.00'
		});
		expect(quotation.subtotal).toBe('2400.00');
		expect(quotation.total).toBe('2300.00');

		await ctx.quotations.sendQuotation(tenantA.id, quotation.id);
		expect((await ctx.requests.getBookingRequest(tenantA.id, request.id)).status).toBe('QUOTED');

		// §16: accepting converts without retyping customer, trip or line-item data.
		const { booking } = await ctx.quotations.acceptQuotation(tenantA.id, quotation.id);
		expect(booking.customerId).toBe(customer.id);
		expect(booking.total).toBe('2300.00');
		expect(booking.balanceDue).toBe('2300.00');
		expect((await ctx.requests.getBookingRequest(tenantA.id, request.id)).status).toBe('CONVERTED');

		// Accepting again returns the SAME booking rather than creating a second one.
		const again = await ctx.quotations.acceptQuotation(tenantA.id, quotation.id);
		expect(again.booking.id).toBe(booking.id);

		// §19: a successful payment updates amount_paid, balance_due and the status.
		const payments = await import('../src/lib/server/payments');
		await payments.createPayment(tenantA.id, { bookingId: booking.id, amount: '1000.00', provider: 'MANUAL' });
		const partly = await ctx.bookings.getBooking(tenantA.id, booking.id);
		expect(partly.amountPaid).toBe('1000.00');
		expect(partly.balanceDue).toBe('1300.00');
		expect(partly.status).toBe('PARTIALLY_PAID');

		await payments.createPayment(tenantA.id, { bookingId: booking.id, amount: '1300.00', provider: 'MANUAL' });
		const settled = await ctx.bookings.getBooking(tenantA.id, booking.id);
		expect(settled.balanceDue).toBe('0.00');
		expect(settled.status).toBe('CONFIRMED');
	}, 120_000);

	it('refuses an illegal booking status transition', async () => {
		const customer = await ctx.customers.findOrCreateCustomer(tenantA.id, {
			firstName: 'Transition',
			email: `trans-${stamp}@example.com`
		});
		const booking = await ctx.bookings.createBooking(tenantA.id, {
			customerId: customer.id,
			items: [{ title: 'Day trip', unitPrice: '100.00' }]
		});
		expect(booking.status).toBe('PENDING');
		// PENDING → COMPLETED skips the whole commercial path and must be refused.
		await expect(ctx.bookings.changeBookingStatus(tenantA.id, booking.id, 'COMPLETED')).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		});
		await expect(ctx.bookings.changeBookingStatus(tenantA.id, booking.id, 'CONFIRMED')).resolves.toBeTruthy();
	});

	it('records every booking status change in history (§14)', async () => {
		const customer = await ctx.customers.findOrCreateCustomer(tenantA.id, {
			firstName: 'History',
			email: `hist-${stamp}@example.com`
		});
		const booking = await ctx.bookings.createBooking(tenantA.id, {
			customerId: customer.id,
			items: [{ title: 'Transfer', unitPrice: '50.00' }]
		});
		await ctx.bookings.changeBookingStatus(tenantA.id, booking.id, 'CONFIRMED', {}, 'Deposit received');
		const detail = await ctx.bookings.getBookingDetail(tenantA.id, booking.id);
		expect(detail.history.length).toBeGreaterThanOrEqual(2);
		expect(detail.history[0].toStatus).toBe('CONFIRMED');
		expect(detail.history[0].reason).toBe('Deposit received');
	});
});

/* --------------------------------------------- §Phase 3 tenant routing ---- */

suite('webhook tenant routing', () => {
	let routingCtx: {
		connections: typeof import('../src/lib/server/whatsapp/connections');
		tenants: typeof import('../src/lib/server/tenants');
		db: typeof import('../src/lib/server/db');
	};
	let routeTenant: { id: string };
	const suffix = `${Date.now()}-route`;

	beforeAll(async () => {
		routingCtx = {
			connections: await import('../src/lib/server/whatsapp/connections'),
			tenants: await import('../src/lib/server/tenants'),
			db: await import('../src/lib/server/db')
		};
		routeTenant = await routingCtx.tenants.provisionTenant({ name: 'Routing Co', slug: `route-${suffix}` });
		await routingCtx.connections.upsertConnection({
			tenantId: routeTenant.id,
			phoneNumberId: `pnid-${suffix}`,
			wabaId: `waba-${suffix}`,
			accessToken: 'routing-token'
		});
	}, 60_000);

	afterAll(async () => {
		const { db, schema } = routingCtx.db;
		const { eq } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(eq(schema.tenants.id, routeTenant.id));
	});

	it('resolves the tenant by phone_number_id first', async () => {
		const routed = await routingCtx.connections.resolveTenantForEvent({ phoneNumberId: `pnid-${suffix}` });
		expect(routed?.tenantId).toBe(routeTenant.id);
		expect(routed?.matchedOn).toBe('phone_number_id');
	});

	it('falls back to waba_id when no phone number is present', async () => {
		const routed = await routingCtx.connections.resolveTenantForEvent({ phoneNumberId: null, wabaId: `waba-${suffix}` });
		expect(routed?.tenantId).toBe(routeTenant.id);
		expect(routed?.matchedOn).toBe('waba_id');
	});

	it('prefers phone_number_id over a conflicting waba_id', async () => {
		const routed = await routingCtx.connections.resolveTenantForEvent({
			phoneNumberId: `pnid-${suffix}`,
			wabaId: 'waba-belonging-to-nobody'
		});
		expect(routed?.matchedOn).toBe('phone_number_id');
	});

	it('drops an event whose identifiers nobody owns — no default tenant', async () => {
		expect(await routingCtx.connections.resolveTenantForEvent({ phoneNumberId: 'nope', wabaId: 'also-nope' })).toBeNull();
		expect(await routingCtx.connections.resolveTenantForEvent({})).toBeNull();
	});
});
