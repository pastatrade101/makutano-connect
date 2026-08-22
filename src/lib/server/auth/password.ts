// Password hashing with scrypt from node:crypto — no native dependency, no bcrypt
// build step. Format: scrypt$N$r$p$<salt-b64url>$<hash-b64url>, so parameters can be
// raised later without invalidating existing hashes.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: crypto.ScryptOptions
) => Promise<Buffer>;

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
	return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	if (!stored) return false;
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [, sN, sR, sP, saltB64, hashB64] = parts;
	try {
		const salt = Buffer.from(saltB64, 'base64url');
		const expected = Buffer.from(hashB64, 'base64url');
		const actual = await scrypt(password, salt, expected.length, {
			N: Number(sN),
			r: Number(sR),
			p: Number(sP),
			maxmem: 64 * 1024 * 1024
		});
		return crypto.timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}
