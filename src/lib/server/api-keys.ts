// API key issuance and authentication (§6).
//
// Only the sha-256 of the full secret is stored — the plaintext is returned exactly
// once, at creation, and can never be recovered. Lookup is by hash, so a stolen
// database yields nothing that can be replayed against the API.
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { sha256 } from './encryption';
import { AppError } from './errors';
import { DEFAULT_API_SCOPES, isValidScope, type ApiScope } from './auth/permissions';
import { log } from './logger';

export type ApiKeyEnvironment = 'live' | 'test';

export type IssuedKey = {
	id: string;
	secret: string; // shown once (§6)
	prefix: string;
	environment: ApiKeyEnvironment;
	scopes: string[];
};

function generateSecret(environment: ApiKeyEnvironment): { secret: string; prefix: string } {
	const body = crypto.randomBytes(24).toString('base64url'); // ~32 chars, URL safe
	const secret = `mk_${environment}_${body}`;
	return { secret, prefix: secret.slice(0, 16) };
}

export async function createApiKey(params: {
	tenantId: string;
	name?: string;
	environment?: ApiKeyEnvironment;
	scopes?: string[];
	expiresAt?: Date | null;
	createdByUserId?: string | null;
}): Promise<IssuedKey> {
	const environment = params.environment ?? 'live';
	const requested = params.scopes?.length ? params.scopes : DEFAULT_API_SCOPES;
	const invalid = requested.filter((s) => !isValidScope(s));
	if (invalid.length) throw new AppError('VALIDATION_ERROR', `Unknown API scopes: ${invalid.join(', ')}`);

	const { secret, prefix } = generateSecret(environment);
	const [row] = await db()
		.insert(schema.apiKeys)
		.values({
			tenantId: params.tenantId,
			name: params.name ?? 'Default key',
			keyHash: sha256(secret),
			prefix,
			environment,
			scopes: requested as ApiScope[],
			expiresAt: params.expiresAt ?? null,
			createdByUserId: params.createdByUserId ?? null
		})
		.returning();

	return { id: row.id, secret, prefix, environment, scopes: requested };
}

export type ApiKeyAuth = {
	apiKey: schema.ApiKey;
	tenant: schema.Tenant;
	scopes: string[];
};

/**
 * Authenticate `Authorization: Bearer mk_live_xxx`. Returns the key AND its tenant —
 * the caller never chooses the tenant (§3).
 */
export async function authenticateApiKey(authorizationHeader: string | null): Promise<ApiKeyAuth> {
	const raw = (authorizationHeader ?? '').trim();
	const token = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
	if (!token || !/^mk_(live|test)_/.test(token)) {
		throw new AppError('API_KEY_INVALID', 'A valid API key is required.');
	}

	const rows = await db()
		.select({ apiKey: schema.apiKeys, tenant: schema.tenants })
		.from(schema.apiKeys)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.apiKeys.tenantId))
		.where(eq(schema.apiKeys.keyHash, sha256(token)))
		.limit(1);

	const row = rows[0];
	if (!row) throw new AppError('API_KEY_INVALID', 'A valid API key is required.');
	if (row.apiKey.status === 'REVOKED') throw new AppError('API_KEY_REVOKED', 'This API key has been revoked.');
	if (row.apiKey.expiresAt && row.apiKey.expiresAt.getTime() < Date.now()) {
		throw new AppError('API_KEY_EXPIRED', 'This API key has expired.');
	}
	if (row.tenant.deletedAt) throw new AppError('TENANT_NOT_FOUND', 'Tenant not found.');
	// Distinguish suspension from a generic refusal so the caller (and our own UI) can
	// say what actually happened instead of guessing at a 403.
	if (row.tenant.status === 'SUSPENDED') {
		throw new AppError('TENANT_SUSPENDED', 'This account is suspended. Please contact support.');
	}
	if (row.tenant.status === 'CANCELLED') {
		throw new AppError('TENANT_SUSPENDED', 'This account is closed.');
	}

	// last_used_at is best-effort telemetry; never fail a request because it did not write.
	void db()
		.update(schema.apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(schema.apiKeys.id, row.apiKey.id))
		.catch((err) => log.warn('api_key_touch_failed', { error: (err as Error)?.message }));

	return { apiKey: row.apiKey, tenant: row.tenant, scopes: row.apiKey.scopes ?? [] };
}

export async function revokeApiKey(tenantId: string, apiKeyId: string): Promise<void> {
	const result = await db()
		.update(schema.apiKeys)
		.set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(schema.apiKeys.id, apiKeyId), eq(schema.apiKeys.tenantId, tenantId)))
		.returning({ id: schema.apiKeys.id });
	if (result.length === 0) throw new AppError('NOT_FOUND', 'API key not found.');
}

export async function listApiKeys(tenantId: string) {
	return db()
		.select({
			id: schema.apiKeys.id,
			name: schema.apiKeys.name,
			prefix: schema.apiKeys.prefix,
			environment: schema.apiKeys.environment,
			scopes: schema.apiKeys.scopes,
			status: schema.apiKeys.status,
			lastUsedAt: schema.apiKeys.lastUsedAt,
			expiresAt: schema.apiKeys.expiresAt,
			createdAt: schema.apiKeys.createdAt
		})
		.from(schema.apiKeys)
		.where(eq(schema.apiKeys.tenantId, tenantId))
		.orderBy(schema.apiKeys.createdAt);
}
