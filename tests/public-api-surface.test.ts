// The public API's edges: who may read a response, and what a log line may contain.
import { describe, expect, it } from 'vitest';
import { redact, redactPath } from '../src/lib/server/logger';

describe('a credential in a PATH is redacted, not just one in a key', () => {
	// SECRET_KEY masks by key name, so { token: '…' } was already safe. The public
	// quotation link carries its credential in the path, and a 5xx logged
	// { path: '/api/public/quotations/<token>/accept' } verbatim — writing a live
	// bearer token into log aggregation, where it outlives the quote.
	const token = 'fd68a4f29b9046509fa94d113a5508fb56e5303d'; // 40 hex, a real shape

	it('removes the token from a quotation path', () => {
		const out = redactPath(`/api/public/quotations/${token}/accept`);
		expect(out).not.toContain(token);
		expect(out).toBe('/api/public/quotations/[redacted:token]/accept');
	});

	it('redacts it wherever a path-shaped key appears in a log payload', () => {
		const out = redact({ path: `/api/public/quotations/${token}`, message: 'boom' }) as Record<string, string>;
		expect(out.path).not.toContain(token);
		expect(out.message).toBe('boom');
	});

	it('leaves record ids alone, because a log line still has to be worth reading', () => {
		// A UUID carries dashes and is an identifier, not a credential. Redacting it
		// would make every 5xx untraceable to the row that caused it.
		const uuid = '3a993956-b933-4ce6-99a7-42dd0e8ea0ee';
		expect(redactPath(`/app/booking-requests/${uuid}`)).toContain(uuid);
		expect(redactPath('/api/public/tours/serengeti-3-day')).toBe('/api/public/tours/serengeti-3-day');
	});

	it('still masks by key name, which this does not replace', () => {
		const out = redact({ publicToken: token }) as Record<string, string>;
		expect(out.publicToken).not.toContain(token);
	});
});

describe('CORS is narrowed to the one browser origin that calls these routes', () => {
	it('no longer advertises a wildcard', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/lib/server/public-api.ts', 'utf8');
		expect(src).not.toContain("'access-control-allow-origin': '*'");
	});

	it('always sends Vary: Origin, because the same helper serves cached responses', async () => {
		// Without it a cache could store one origin's response and replay it to
		// another, handing the wrong allow-origin header to every later reader.
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/lib/server/public-api.ts', 'utf8');
		expect(src).toContain("vary: 'Origin'");
	});

	it('never sends allow-credentials, which would make the wildcard question real', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/lib/server/public-api.ts', 'utf8');
		expect(src).not.toContain('access-control-allow-credentials');
	});
});
