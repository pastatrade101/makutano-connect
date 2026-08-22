// Authenticated encryption for every recoverable credential we store: WhatsApp access
// tokens (§8) and tenant webhook signing secrets (§20).
//
// Envelope format: "v<keyVersion>.<iv>.<tag>.<ciphertext>", all base64url. The version
// prefix is what makes future key rotation possible — decrypt() dispatches on it, so a
// v2 key can be introduced while v1 blobs still read.
import crypto from 'node:crypto';
import { env } from './env';

const CURRENT_KEY_VERSION = 1;

function keyMaterial(version: number): Buffer {
	const e = env();
	// Additional versions map here, e.g. version 2 → env.CREDENTIALS_ENCRYPTION_KEY_V2.
	const raw = version === 1 ? e.CREDENTIALS_ENCRYPTION_KEY : '';
	if (!raw) throw new Error(`No encryption key material for key version ${version}.`);
	return crypto.createHash('sha256').update(raw, 'utf8').digest(); // 32 bytes for AES-256
}

export function hasEncryptionKey(): boolean {
	try {
		return keyMaterial(CURRENT_KEY_VERSION).length === 32;
	} catch {
		return false;
	}
}

export type Sealed = { blob: string; keyVersion: number };

/** Encrypt a secret with the current key. Returns the blob and the key version to store. */
export function encrypt(plaintext: string): Sealed {
	const key = keyMaterial(CURRENT_KEY_VERSION);
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	const blob = `v${CURRENT_KEY_VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
	return { blob, keyVersion: CURRENT_KEY_VERSION };
}

/** Decrypt a blob produced by encrypt(). Throws on tampering, wrong key, or bad format. */
export function decrypt(blob: string): string {
	const parts = String(blob ?? '').split('.');
	if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) throw new Error('Malformed ciphertext envelope.');
	const version = Number(parts[0].slice(1));
	const key = keyMaterial(version);
	const iv = Buffer.from(parts[1], 'base64url');
	const tag = Buffer.from(parts[2], 'base64url');
	const ct = Buffer.from(parts[3], 'base64url');
	const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
	d.setAuthTag(tag);
	return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** sha-256 hex — used for API key lookup, session ids and IP hashing. */
export function sha256(value: string): string {
	return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison that tolerates differing lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
	return crypto.randomBytes(bytes).toString('base64url');
}
