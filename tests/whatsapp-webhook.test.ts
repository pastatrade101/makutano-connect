// Meta webhook verification and parsing (§9, §37).
import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

const APP_SECRET = 'meta-app-secret-for-tests';

beforeAll(() => {
	process.env.META_APP_SECRET = APP_SECRET;
	process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
	process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'unit-test-encryption-key-32-chars!!';
	process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
	process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
});

const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');

describe('GET verification handshake', () => {
	it('echoes the challenge for the right token', async () => {
		const { verifyChallenge } = await import('../src/lib/server/whatsapp/webhook');
		expect(verifyChallenge({ mode: 'subscribe', token: 'verify-me', challenge: '12345' })).toBe('12345');
	});

	it('refuses a wrong token or wrong mode', async () => {
		const { verifyChallenge } = await import('../src/lib/server/whatsapp/webhook');
		expect(verifyChallenge({ mode: 'subscribe', token: 'wrong', challenge: '1' })).toBeNull();
		expect(verifyChallenge({ mode: 'unsubscribe', token: 'verify-me', challenge: '1' })).toBeNull();
	});
});

describe('POST signature verification', () => {
	it('accepts a correctly signed body', async () => {
		const { verifySignature } = await import('../src/lib/server/whatsapp/webhook');
		const body = JSON.stringify({ object: 'whatsapp_business_account' });
		expect(verifySignature(body, sign(body)).ok).toBe(true);
	});

	it('rejects a tampered body — the signature covers the raw bytes', async () => {
		const { verifySignature } = await import('../src/lib/server/whatsapp/webhook');
		const body = JSON.stringify({ object: 'whatsapp_business_account' });
		const signature = sign(body);
		expect(verifySignature(body + ' ', signature).ok).toBe(false);
	});

	it('rejects a missing or malformed signature header', async () => {
		const { verifySignature } = await import('../src/lib/server/whatsapp/webhook');
		expect(verifySignature('{}', null).ok).toBe(false);
		expect(verifySignature('{}', 'sha1=abc').ok).toBe(false);
	});
});

describe('payload parsing', () => {
	const envelope = {
		entry: [
			{
				changes: [
					{
						value: {
							metadata: { phone_number_id: '1234567890' },
							contacts: [{ profile: { name: 'Amina Juma' } }],
							messages: [
								{
									id: 'wamid.ABC',
									from: '255712345678',
									timestamp: '1700000000',
									type: 'text',
									text: { body: 'Hello' }
								}
							],
							statuses: [
								{ id: 'wamid.XYZ', status: 'delivered', recipient_id: '255712345678', timestamp: '1700000001' }
							]
						}
					}
				]
			}
		]
	};

	it('flattens messages and statuses with their routing number', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		const events = parseWebhook(envelope);
		expect(events).toHaveLength(2);

		const message = events.find((e) => e.kind === 'message')! as any;
		expect(message.messageId).toBe('wamid.ABC');
		expect(message.from).toBe('255712345678');
		expect(message.text).toBe('Hello');
		expect(message.contactName).toBe('Amina Juma');
		expect(message.phoneNumberId).toBe('1234567890');

		const status = events.find((e) => e.kind === 'status')! as any;
		expect(status.status).toBe('delivered');
	});

	it('returns nothing for an empty envelope rather than throwing', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		expect(parseWebhook({})).toEqual([]);
		expect(parseWebhook({ entry: [] })).toEqual([]);
	});

	it('preserves a template quick-reply payload so callbacks target the exact request', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		const [event] = parseWebhook({
			entry: [
				{
					changes: [
						{
							value: {
								metadata: { phone_number_id: '1234567890' },
								messages: [
									{
										id: 'wamid.BUTTON',
										from: '255712345678',
										timestamp: '1700000002',
										type: 'button',
										button: {
											text: 'I have paid',
											payload: 'connect:payment_report:123e4567-e89b-42d3-a456-426614174000'
										}
									}
								]
							}
						}
					]
				}
			]
		});
		expect(event).toMatchObject({
			kind: 'message',
			text: 'I have paid',
			buttonPayload: 'connect:payment_report:123e4567-e89b-42d3-a456-426614174000'
		});
	});
});

describe('template review outcomes', () => {
	// Meta announces approvals on an account-scoped field: no messages, no phone
	// number — only entry.id (the WABA) identifies the tenant.
	const envelope = (event: string, extra: Record<string, unknown> = {}) => ({
		object: 'whatsapp_business_account',
		entry: [
			{
				id: '1338598725019880',
				changes: [
					{
						field: 'message_template_status_update',
						value: {
							event,
							message_template_id: 9876543210,
							message_template_name: 'payment_request',
							message_template_language: 'en',
							...extra
						}
					}
				]
			}
		]
	});

	it('parses an approval into a routable template_status event', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		const [event] = parseWebhook(envelope('APPROVED'));
		expect(event).toMatchObject({
			kind: 'template_status',
			wabaId: '1338598725019880',
			templateName: 'payment_request',
			language: 'en',
			metaTemplateId: '9876543210',
			status: 'APPROVED'
		});
		// No phone number on this field — routing must fall back to the WABA id.
		expect((event as { phoneNumberId: string | null }).phoneNumberId).toBeNull();
	});

	it('carries the rejection reason so staff learn why', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		const [event] = parseWebhook(envelope('REJECTED', { reason: 'INVALID_FORMAT' }));
		expect(event).toMatchObject({ status: 'REJECTED', reason: 'INVALID_FORMAT' });
	});

	it('ignores an envelope without a template name rather than inventing an event', async () => {
		const { parseWebhook } = await import('../src/lib/server/whatsapp/webhook');
		expect(
			parseWebhook({
				object: 'whatsapp_business_account',
				entry: [{ id: 'w', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }] }]
			})
		).toEqual([]);
	});
});
