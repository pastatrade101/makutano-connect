// Legacy webhook relay — the transition mechanism that keeps a migrated tenant's old
// endpoint receiving Meta's exact bytes + signature after cutover.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

describe('isAllowedRelayUrl', () => {
	it('accepts https and loopback http only', async () => {
		const { isAllowedRelayUrl } = await import('../src/lib/server/whatsapp/relay');
		expect(isAllowedRelayUrl('https://ai.makutano.co.tz/api/webhooks/whatsapp')).toBe(true);
		expect(isAllowedRelayUrl('http://localhost:9999/hook')).toBe(true);
		expect(isAllowedRelayUrl('http://127.0.0.1:9999/hook')).toBe(true);
		expect(isAllowedRelayUrl('http://internal-host/hook')).toBe(false);
		expect(isAllowedRelayUrl('ftp://x')).toBe(false);
		expect(isAllowedRelayUrl('not a url')).toBe(false);
	});
});

suite('relay end-to-end', () => {
	let ctx: {
		relay: typeof import('../src/lib/server/whatsapp/relay');
		connections: typeof import('../src/lib/server/whatsapp/connections');
		tenants: typeof import('../src/lib/server/tenants');
		db: typeof import('../src/lib/server/db');
	};
	let relayTenant: { id: string };
	let plainTenant: { id: string };
	const stamp = `${Date.now()}-relay`;

	// A local sink standing in for the legacy endpoint.
	let server: http.Server;
	let sinkPort = 0;
	const received: Array<{ body: string; signature: string | undefined }> = [];
	let failNext = 0;

	beforeAll(async () => {
		ctx = {
			relay: await import('../src/lib/server/whatsapp/relay'),
			connections: await import('../src/lib/server/whatsapp/connections'),
			tenants: await import('../src/lib/server/tenants'),
			db: await import('../src/lib/server/db')
		};

		server = http.createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => {
				if (failNext > 0) {
					failNext--;
					res.writeHead(503).end();
					return;
				}
				received.push({ body, signature: req.headers['x-hub-signature-256'] as string | undefined });
				res.writeHead(200).end('OK');
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		sinkPort = (server.address() as { port: number }).port;

		relayTenant = await ctx.tenants.provisionTenant({ name: 'Relay Co', slug: `relay-${stamp}` });
		plainTenant = await ctx.tenants.provisionTenant({ name: 'Plain Co', slug: `plain-${stamp}` });

		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.tenants)
			.set({ settings: { legacy_webhook_url: `http://127.0.0.1:${sinkPort}/legacy` } })
			.where(eq(schema.tenants.id, relayTenant.id));

		await ctx.connections.upsertConnection({ tenantId: relayTenant.id, phoneNumberId: `pn-relay-${stamp}`, wabaId: `waba-relay-${stamp}`, accessToken: 't' });
		await ctx.connections.upsertConnection({ tenantId: plainTenant.id, phoneNumberId: `pn-plain-${stamp}`, accessToken: 't' });
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		const { db, schema } = ctx.db;
		const { inArray } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(inArray(schema.tenants.id, [relayTenant.id, plainTenant.id]));
	});

	it('resolves relay targets only for tenants that configured one', async () => {
		const targets = await ctx.relay.relayTargetsFor([
			{ phoneNumberId: `pn-relay-${stamp}` },
			{ phoneNumberId: `pn-plain-${stamp}` },
			{ phoneNumberId: 'pn-owned-by-nobody' }
		]);
		expect(targets).toEqual([`http://127.0.0.1:${sinkPort}/legacy`]);
	});

	it('resolves by waba_id when the event has no phone number', async () => {
		const targets = await ctx.relay.relayTargetsFor([{ wabaId: `waba-relay-${stamp}` }]);
		expect(targets).toEqual([`http://127.0.0.1:${sinkPort}/legacy`]);
	});

	it('returns nothing for unknown identifiers — no default relay', async () => {
		expect(await ctx.relay.relayTargetsFor([{ phoneNumberId: 'stranger' }])).toEqual([]);
		expect(await ctx.relay.relayTargetsFor([])).toEqual([]);
	});

	it('delivers the exact raw bytes and original signature header', async () => {
		received.length = 0;
		const rawBody = '{"object":"whatsapp_business_account","entry":[{"id":"X"}]} '; // trailing space is part of the bytes
		const signature = 'sha256=feedfacecafebeef';
		await ctx.relay.relayRawWebhook({ url: `http://127.0.0.1:${sinkPort}/legacy`, rawBody, signature });
		expect(received).toHaveLength(1);
		expect(received[0].body).toBe(rawBody); // byte-identical, or the legacy HMAC breaks
		expect(received[0].signature).toBe(signature);
	});

	it('throws on a failing endpoint so the queue can retry', async () => {
		failNext = 1;
		await expect(
			ctx.relay.relayRawWebhook({ url: `http://127.0.0.1:${sinkPort}/legacy`, rawBody: '{}', signature: 'sha256=x' })
		).rejects.toThrow(/503/);
	});

	it('silently drops a malformed job instead of retrying forever', async () => {
		await expect(ctx.relay.relayRawWebhook({ url: 'http://not-loopback/x', rawBody: '{}', signature: '' })).resolves.toBeUndefined();
	});
});

suite('multi-number primary selection', () => {
	let ctx2: {
		connections: typeof import('../src/lib/server/whatsapp/connections');
		tenants: typeof import('../src/lib/server/tenants');
		db: typeof import('../src/lib/server/db');
	};
	let tenant: { id: string };
	const stamp2 = `${Date.now()}-multi`;

	beforeAll(async () => {
		ctx2 = {
			connections: await import('../src/lib/server/whatsapp/connections'),
			tenants: await import('../src/lib/server/tenants'),
			db: await import('../src/lib/server/db')
		};
		tenant = await ctx2.tenants.provisionTenant({ name: 'Multi Co', slug: `multi-${stamp2}` });
	}, 60_000);

	afterAll(async () => {
		const { db, schema } = ctx2.db;
		const { eq } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
	});

	it('a newly connected number takes over sending from the previous one', async () => {
		await ctx2.connections.upsertConnection({ tenantId: tenant.id, phoneNumberId: `old-${stamp2}`, accessToken: 'old-token' });
		await new Promise((r) => setTimeout(r, 20)); // distinct updated_at
		await ctx2.connections.upsertConnection({ tenantId: tenant.id, phoneNumberId: `new-${stamp2}`, accessToken: 'new-token' });

		const chosen = await ctx2.connections.getConnectionForTenant(tenant.id);
		expect(chosen?.phoneNumberId).toBe(`new-${stamp2}`);
		expect(chosen?.isPrimary).toBe(true);

		const credentials = await ctx2.connections.resolveCredentials(tenant.id);
		expect(credentials?.accessToken).toBe('new-token');

		// Inbound for the OLD number still routes — history and webhooks survive.
		const routed = await ctx2.connections.resolveTenantByPhoneNumberId(`old-${stamp2}`);
		expect(routed?.tenantId).toBe(tenant.id);
	});

	it('a live secondary beats a disconnected primary', async () => {
		await ctx2.connections.disconnect(tenant.id); // disconnects the current primary (new-)
		const chosen = await ctx2.connections.getConnectionForTenant(tenant.id);
		expect(chosen?.phoneNumberId).toBe(`old-${stamp2}`);
		expect(chosen?.status).toBe('CONNECTED');
	});
});
