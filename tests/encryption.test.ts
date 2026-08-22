// Credential encryption (§8) — AES-256-GCM with a versioned envelope.
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
	process.env.CREDENTIALS_ENCRYPTION_KEY = 'unit-test-encryption-key-32-chars!!';
	process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
	process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
});

describe('encryption', () => {
	it('round-trips a token', async () => {
		const { encrypt, decrypt } = await import('../src/lib/server/encryption');
		const token = 'EAAGm0PX4ZCpsBO1234567890';
		const sealed = encrypt(token);
		expect(sealed.blob).not.toContain(token);
		expect(sealed.keyVersion).toBe(1);
		expect(decrypt(sealed.blob)).toBe(token);
	});

	it('uses a fresh IV, so the same plaintext never produces the same blob', async () => {
		const { encrypt } = await import('../src/lib/server/encryption');
		expect(encrypt('same').blob).not.toBe(encrypt('same').blob);
	});

	it('carries a version prefix for future key rotation', async () => {
		const { encrypt } = await import('../src/lib/server/encryption');
		expect(encrypt('x').blob.startsWith('v1.')).toBe(true);
	});

	it('detects tampering via the GCM auth tag', async () => {
		const { encrypt, decrypt } = await import('../src/lib/server/encryption');
		const blob = encrypt('secret-token').blob;
		const parts = blob.split('.');
		// Flip a byte in the ciphertext.
		const tampered = [
			parts[0],
			parts[1],
			parts[2],
			Buffer.from(Buffer.from(parts[3], 'base64url').map((b, i) => (i === 0 ? b ^ 0xff : b))).toString('base64url')
		].join('.');
		expect(() => decrypt(tampered)).toThrow();
	});

	it('rejects a malformed envelope', async () => {
		const { decrypt } = await import('../src/lib/server/encryption');
		expect(() => decrypt('not-an-envelope')).toThrow(/Malformed/);
		expect(() => decrypt('v9.a.b.c')).toThrow();
	});
});
