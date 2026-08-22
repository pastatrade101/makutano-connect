// Rate limiting (§28) against a real database — this is where the Date-vs-ISO
// serialization bug lived, so the regression is covered here rather than mocked away.
import { beforeAll, describe, expect, it, afterAll } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

let rateLimit: typeof import('../src/lib/server/rate-limit');
let dbModule: typeof import('../src/lib/server/db');

suite('rate limiting', () => {
	beforeAll(async () => {
		rateLimit = await import('../src/lib/server/rate-limit');
		dbModule = await import('../src/lib/server/db');
	});

	afterAll(async () => {
		await dbModule?.closeDb();
	});

	it('counts down within a window and then refuses', async () => {
		const scope = `test-scope-${Date.now()}`;
		const first = await rateLimit.consume(scope, 3, 60);
		expect(first.allowed).toBe(true);
		expect(first.remaining).toBe(2);
		expect(first.resetAt).toBeInstanceOf(Date);

		await rateLimit.consume(scope, 3, 60);
		await rateLimit.consume(scope, 3, 60);
		const fourth = await rateLimit.consume(scope, 3, 60);
		expect(fourth.allowed).toBe(false);
		expect(fourth.remaining).toBe(0);
	});

	it('enforce() throws RATE_LIMITED only once the limit is passed', async () => {
		const scope = `test-enforce-${Date.now()}`;
		await expect(rateLimit.enforce(scope, 1, 60)).resolves.toBeTruthy();
		await expect(rateLimit.enforce(scope, 1, 60)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
	});

	it('keeps separate scopes independent — one tenant cannot exhaust another', async () => {
		const a = `tenant-a-${Date.now()}`;
		const b = `tenant-b-${Date.now()}`;
		await rateLimit.consume(a, 1, 60);
		expect((await rateLimit.consume(a, 1, 60)).allowed).toBe(false);
		expect((await rateLimit.consume(b, 1, 60)).allowed).toBe(true);
	});
});
