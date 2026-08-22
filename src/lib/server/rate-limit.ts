// Per-tenant / per-plan rate limiting (§28) — deliberately not one global limit, so a
// busy tenant cannot exhaust another tenant's budget.
//
// Fixed windows in Postgres via an atomic UPSERT. This needs no Redis; when REDIS_URL
// is configured a drop-in replacement can implement the same `consume()` contract.
import { lt, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { AppError } from './errors';

export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; resetAt: Date };

/**
 * Consume one unit from `scope`'s window.
 * @param scope  a caller-built key, e.g. `api:<tenantId>` or `login:<ipHash>`
 */
export async function consume(scope: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
	const windowMs = windowSeconds * 1000;
	const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
	const bucket = `${scope}:${windowStart}`;
	const resetAt = new Date(windowStart + windowMs);

	// The timestamp is passed as an ISO string with an explicit cast: the pool runs with
	// prepare:false (required by transaction poolers such as Supabase's), and on that
	// path postgres-js cannot serialize a JS Date bound into a raw sql template.
	const rows = (await db().execute<{ count: number }>(sql`
		insert into rate_limit_counters (bucket, count, expires_at)
		values (${bucket}, 1, ${resetAt.toISOString()}::timestamptz)
		on conflict (bucket) do update set count = rate_limit_counters.count + 1
		returning count
	`)) as unknown as Array<{ count: number }>;

	const count = Number(rows[0]?.count ?? 1);
	return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt };
}

/** consume() + throw. Sets the numbers the route turns into Retry-After headers. */
export async function enforce(scope: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
	const result = await consume(scope, limit, windowSeconds);
	if (!result.allowed) {
		throw new AppError('RATE_LIMITED', 'Too many requests. Please retry shortly.', {
			limit: result.limit,
			resetAt: result.resetAt.toISOString()
		});
	}
	return result;
}

/** Housekeeping — called by the `cleanup` job. */
export async function purgeExpired(): Promise<number> {
	const deleted = await db()
		.delete(schema.rateLimitCounters)
		.where(lt(schema.rateLimitCounters.expiresAt, new Date()))
		.returning({ bucket: schema.rateLimitCounters.bucket });
	return deleted.length;
}
