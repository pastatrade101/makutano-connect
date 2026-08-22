// Idempotency-Key support for write operations (§28).
//
// The unique index on (tenant_id, endpoint, key) is the concurrency primitive: the
// first request to INSERT owns the operation; every duplicate collides and either
// replays the stored response or is told the original is still in flight. Replaying a
// key with a *different* body is a client bug, so it is rejected rather than served a
// mismatched cached response.
import crypto from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';

const TTL_MS = 1000 * 60 * 60 * 24; // 24h

export function fingerprint(method: string, path: string, body: unknown): string {
	return crypto
		.createHash('sha256')
		.update(`${method} ${path} ${JSON.stringify(body ?? null)}`)
		.digest('hex');
}

export type IdempotentOutcome<T> = { replayed: boolean; status: number; body: T };

/**
 * Run `operation` at most once per (tenant, endpoint, key).
 * `operation` returns the response body that will be cached and replayed verbatim.
 */
export async function withIdempotency<T extends Record<string, unknown>>(
	params: { tenantId: string; endpoint: string; key: string | null; method: string; path: string; body: unknown },
	operation: () => Promise<{ status: number; body: T }>
): Promise<IdempotentOutcome<T>> {
	if (!params.key) {
		const result = await operation();
		return { replayed: false, status: result.status, body: result.body };
	}

	const fp = fingerprint(params.method, params.path, params.body);
	const expiresAt = new Date(Date.now() + TTL_MS);

	const inserted = await db()
		.insert(schema.idempotencyKeys)
		.values({
			tenantId: params.tenantId,
			key: params.key,
			endpoint: params.endpoint,
			requestFingerprint: fp,
			status: 'IN_PROGRESS',
			expiresAt
		})
		.onConflictDoNothing()
		.returning({ id: schema.idempotencyKeys.id });

	if (inserted.length === 0) {
		const existing = (
			await db()
				.select()
				.from(schema.idempotencyKeys)
				.where(
					and(
						eq(schema.idempotencyKeys.tenantId, params.tenantId),
						eq(schema.idempotencyKeys.endpoint, params.endpoint),
						eq(schema.idempotencyKeys.key, params.key)
					)
				)
				.limit(1)
		)[0];

		if (!existing) throw new AppError('CONFLICT', 'Idempotency record disappeared; please retry.');
		if (existing.requestFingerprint !== fp) {
			throw new AppError(
				'IDEMPOTENCY_CONFLICT',
				'This Idempotency-Key was already used with a different request body.'
			);
		}
		if (existing.status === 'COMPLETED' && existing.responseBody) {
			return { replayed: true, status: existing.responseStatus ?? 200, body: existing.responseBody as T };
		}
		throw new AppError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed.');
	}

	try {
		const result = await operation();
		await db()
			.update(schema.idempotencyKeys)
			.set({
				status: 'COMPLETED',
				responseStatus: result.status,
				responseBody: result.body,
				completedAt: new Date()
			})
			.where(eq(schema.idempotencyKeys.id, inserted[0].id));
		return { replayed: false, status: result.status, body: result.body };
	} catch (err) {
		// Release the slot so a corrected retry is not permanently blocked by a failure.
		await db().delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, inserted[0].id));
		throw err;
	}
}

export async function purgeExpiredKeys(): Promise<number> {
	const rows = await db()
		.delete(schema.idempotencyKeys)
		.where(lt(schema.idempotencyKeys.expiresAt, new Date()))
		.returning({ id: schema.idempotencyKeys.id });
	return rows.length;
}
