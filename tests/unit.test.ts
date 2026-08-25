// Pure unit tests — no database required (§37).
import { describe, expect, it, beforeAll } from 'vitest';
import { normalizePhone, sameNumber } from '../src/lib/server/phone';
import { computeTotals } from '../src/lib/server/bookings';
import { buildMessagePayload } from '../src/lib/server/whatsapp/messages';
import {
	permissionsForRole,
	can,
	requirePermission,
	requireScope,
	isValidScope
} from '../src/lib/server/auth/permissions';
import { AppError } from '../src/lib/server/errors';
import { redact } from '../src/lib/server/logger';
import { signPayload } from '../src/lib/server/webhooks/deliver';

beforeAll(() => {
	process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'test-encryption-key-at-least-16-chars';
	process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
	process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused-in-unit-tests';
	process.env.META_APP_SECRET ||= 'test-app-secret';
	process.env.WHATSAPP_VERIFY_TOKEN ||= 'test-verify-token';
});

describe('phone normalization', () => {
	it('strips formatting and the leading plus', () => {
		expect(normalizePhone('+255 712 345 678')).toBe('255712345678');
		expect(normalizePhone('(255) 712-345-678')).toBe('255712345678');
	});

	it('expands a national number using the country dial code', () => {
		expect(normalizePhone('0712345678', 'TZ')).toBe('255712345678');
		expect(normalizePhone('0712345678', 'KE')).toBe('254712345678');
	});

	it('rejects unusable input', () => {
		expect(normalizePhone('')).toBeNull();
		expect(normalizePhone('abc')).toBeNull();
		expect(normalizePhone('123')).toBeNull();
	});

	it('matches the same number written differently', () => {
		expect(sameNumber('+255712345678', '255712345678')).toBe(true);
		expect(sameNumber('255712345678', '255712345679')).toBe(false);
	});
});

describe('booking totals', () => {
	it('derives the subtotal from quantity × unit price', () => {
		const { subtotal, total } = computeTotals([
			{ quantity: 2, unitPrice: '150.00' },
			{ quantity: 1, unitPrice: '75.50' }
		]);
		expect(subtotal).toBe('375.50');
		expect(total).toBe('375.50');
	});

	it('prefers an explicit line total over unit × qty', () => {
		expect(computeTotals([{ quantity: 3, unitPrice: '100', total: '250.00' }]).subtotal).toBe('250.00');
	});

	it('applies discount and tax, and never goes negative', () => {
		expect(computeTotals([{ quantity: 1, unitPrice: '100' }], '20', '5').total).toBe('85.00');
		expect(computeTotals([{ quantity: 1, unitPrice: '100' }], '500').total).toBe('0.00');
	});
});

describe('WhatsApp message payloads', () => {
	it('builds a Cloud API text body', () => {
		expect(buildMessagePayload('255712345678', { type: 'text', text: 'Hello' })).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '255712345678',
			type: 'text',
			text: { body: 'Hello', preview_url: false }
		});
	});

	it('builds a template body with language and components', () => {
		const payload = buildMessagePayload('255712345678', {
			type: 'template',
			templateName: 'booking_ack',
			language: 'sw',
			components: [{ type: 'body' }]
		}) as any;
		expect(payload.template.name).toBe('booking_ack');
		expect(payload.template.language).toEqual({ code: 'sw' });
		expect(payload.template.components).toHaveLength(1);
	});
});

describe('permissions and scopes', () => {
	it('gives a VIEWER read access but no writes', () => {
		const perms = permissionsForRole('VIEWER');
		expect(can(perms, 'bookings:read')).toBe(true);
		expect(can(perms, 'bookings:write')).toBe(false);
		expect(can(perms, 'api_keys:write')).toBe(false);
	});

	it('withholds passport data from SALES but grants it to BOOKING_AGENT (§15)', () => {
		expect(can(permissionsForRole('SALES'), 'travelers:read_sensitive')).toBe(false);
		expect(can(permissionsForRole('BOOKING_AGENT'), 'travelers:read_sensitive')).toBe(true);
	});

	it('throws FORBIDDEN when a permission is missing', () => {
		expect(() => requirePermission(permissionsForRole('VIEWER'), 'bookings:write')).toThrowError(AppError);
		try {
			requirePermission(permissionsForRole('VIEWER'), 'bookings:write');
		} catch (err) {
			expect((err as AppError).code).toBe('FORBIDDEN');
			expect((err as AppError).status).toBe(403);
		}
	});

	it('rejects an API scope the key does not hold', () => {
		expect(() => requireScope(['bookings:read'], 'bookings:write')).toThrowError(AppError);
		expect(isValidScope('bookings:read')).toBe(true);
		expect(isValidScope('everything')).toBe(false);
	});
});

describe('log redaction (§29)', () => {
	it('masks anything that looks like a secret', () => {
		const out = redact({
			accessToken: 'EAAG-super-secret',
			api_key: 'mk_live_abc',
			encrypted_access_token: 'v1.a.b.c',
			customer: { name: 'Amina', password: 'hunter2' }
		}) as any;
		expect(out.accessToken).not.toContain('EAAG');
		expect(out.api_key).not.toContain('mk_live');
		expect(out.encrypted_access_token).not.toContain('v1.');
		expect(out.customer.password).not.toContain('hunter2');
		expect(out.customer.name).toBe('Amina');
	});
});

describe('outbound webhook signing (§20)', () => {
	it('is deterministic for a given timestamp and changes with the body', () => {
		const a = signPayload('whsec_test', '{"a":1}', 1_700_000_000);
		const b = signPayload('whsec_test', '{"a":1}', 1_700_000_000);
		const c = signPayload('whsec_test', '{"a":2}', 1_700_000_000);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
	});
});

describe('message previews are readable by shop owners', () => {
	it('renders the template body with resolved values instead of a token', async () => {
		const { renderPreview } = await import('../src/lib/server/whatsapp/template-engine');
		const body =
			'Hi {{customer.first_name}}, your order {{order.number}} is ready for collection at {{business.name}}.';
		expect(
			renderPreview(
				body,
				['customer.first_name', 'order.number', 'business.name'],
				['Josee', 'FIS-OR-2026-00002', 'Fish Hook Ltd']
			)
		).toBe('Hi Josee, your order FIS-OR-2026-00002 is ready for collection at Fish Hook Ltd.');
	});

	it('does not let a dot in a variable name match the wrong placeholder', async () => {
		const { renderPreview } = await import('../src/lib/server/whatsapp/template-engine');
		// "order.number" must not match "{{orderXnumber}}" via the regex wildcard.
		expect(renderPreview('A {{orderXnumber}} B {{order.number}}', ['order.number'], ['OK'])).toBe(
			'A {{orderXnumber}} B OK'
		);
	});

	it('humanises messages stored before rendering existed', async () => {
		const { messagePreview } = await import('../src/lib/labels');
		expect(messagePreview('[template:order_received]')).toBe('Order received (automated message)');
		expect(messagePreview('[template:payment_reminder_v2]')).toBe('Payment reminder (automated message)');
		// Real text passes through untouched.
		expect(messagePreview('I have paid')).toBe('I have paid');
		expect(messagePreview(null, 'image')).toBe('[image]');
	});
});
