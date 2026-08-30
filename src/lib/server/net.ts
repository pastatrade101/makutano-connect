// Fetching a URL somebody else typed.
//
// A tenant configures where their catalogue lives and this server goes and gets
// it. That is server-side request forgery waiting to happen: the interesting
// targets are not on the internet but next to us — 169.254.169.254 hands out
// cloud credentials, 127.0.0.1 is our own admin surface, and 10.x is whatever
// else runs in this network.
//
// So the host is resolved and EVERY address it resolves to is checked, not just
// the literal in the URL. Checking the hostname alone is defeated by pointing a
// public DNS name at 127.0.0.1, which costs an attacker nothing.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors';

const BLOCKED_V4 = [
	{ label: 'loopback', test: (p: number[]) => p[0] === 127 },
	{ label: 'this-network', test: (p: number[]) => p[0] === 0 },
	{ label: 'private', test: (p: number[]) => p[0] === 10 },
	{ label: 'private', test: (p: number[]) => p[0] === 172 && p[1] >= 16 && p[1] <= 31 },
	{ label: 'private', test: (p: number[]) => p[0] === 192 && p[1] === 168 },
	// The one that actually leaks credentials on AWS/GCP/Azure.
	{ label: 'link-local (cloud metadata)', test: (p: number[]) => p[0] === 169 && p[1] === 254 },
	{ label: 'shared address space', test: (p: number[]) => p[0] === 100 && p[1] >= 64 && p[1] <= 127 },
	{ label: 'multicast', test: (p: number[]) => p[0] >= 224 }
];

/** null when the address is fine; otherwise why it is not. */
export function blockedAddressReason(address: string): string | null {
	const version = isIP(address);
	if (version === 4) {
		const parts = address.split('.').map(Number);
		return BLOCKED_V4.find((r) => r.test(parts))?.label ?? null;
	}
	if (version === 6) {
		const a = address.toLowerCase();
		if (a === '::1' || a === '::') return 'loopback';
		// v4-mapped (::ffff:127.0.0.1) is the same address wearing a hat.
		const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return blockedAddressReason(mapped[1]);
		if (/^f[cd]/.test(a)) return 'unique local';
		if (/^fe[89ab]/.test(a)) return 'link-local';
		return null;
	}
	return 'not an IP address';
}

/**
 * Assert a tenant-supplied URL is safe for this server to fetch.
 *
 * Set CATALOG_SYNC_ALLOW_PRIVATE=on to lift this in development, where the
 * source genuinely is on localhost. It is deliberately a separate switch from
 * anything production sets.
 */
export async function assertFetchableUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new AppError('VALIDATION_ERROR', 'That does not look like a URL.');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new AppError('VALIDATION_ERROR', 'Only http and https addresses can be synced.');
	}
	if (url.username || url.password) {
		throw new AppError('VALIDATION_ERROR', 'Put credentials in the API key field, not in the URL.');
	}
	// process.env directly, NOT env(): that is a zod z.object() parse, which
	// strips keys the schema does not declare — so reading this through it would
	// have silently returned undefined and the escape hatch would never open.
	// It is also cached, which a test toggling the flag would have to work around.
	if (process.env.CATALOG_SYNC_ALLOW_PRIVATE === 'on') return url;

	const literal = isIP(url.hostname) ? [url.hostname] : [];
	let resolved: string[] = literal;
	if (!literal.length) {
		try {
			resolved = (await lookup(url.hostname, { all: true })).map((a) => a.address);
		} catch {
			throw new AppError('VALIDATION_ERROR', `Could not resolve ${url.hostname}.`);
		}
	}
	if (!resolved.length) throw new AppError('VALIDATION_ERROR', `Could not resolve ${url.hostname}.`);

	// EVERY address, not the first: a name that resolves to both a public and a
	// private address must not be fetchable just because the public one sorted
	// first.
	for (const address of resolved) {
		const reason = blockedAddressReason(address);
		if (reason) {
			throw new AppError('VALIDATION_ERROR', `${url.hostname} resolves to a ${reason} address, which cannot be synced.`);
		}
	}
	return url;
}
