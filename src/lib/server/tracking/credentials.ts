/**
 * Who Connect is when it talks to the tracking provider.
 *
 * There are exactly TWO identities, and keeping them apart is the point of this
 * file:
 *
 *   RUNTIME     — one per tenant, read-only, scoped by the provider to that
 *                 tenant's own devices. Every request handler uses this.
 *   PROVISIONING — one platform administrator, able to create users and devices.
 *                 Used only by deliberate provisioning code, never by a request
 *                 handler, and never with a tenant id it did not resolve itself.
 *
 * Connect previously used the administrator for every read. That meant the
 * provider's permission system was doing nothing at all: a fleet list asked for
 * "every device you can see", got every device on the platform, and isolation
 * survived only because Connect remembered to filter afterwards. One forgotten
 * filter would have been a cross-tenant leak, and one did in fact exist.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { decrypt, encrypt, randomToken } from '$lib/server/encryption';
import { env } from '$lib/server/env';

export type TraccarCredentials = {
	baseUrl: string;
	/** Basic auth. Deliberately not a bearer token — see the V2 proposal §4. */
	username: string;
	password: string;
};

/** The provider is reachable at all. Says nothing about any tenant's identity. */
export function providerBaseUrl(): string {
	return (env().TRACCAR_BASE_URL || '').replace(/\/+$/, '');
}

/**
 * The PROVISIONING identity.
 *
 * Exported deliberately narrowly: nothing in `src/routes` may import this, and
 * a test asserts that. Provisioning happens in scripts and in the enrollment
 * service, both of which resolve the tenant themselves.
 */
export function adminCredentials(): TraccarCredentials | null {
	const e = env();
	const baseUrl = providerBaseUrl();
	if (!baseUrl) return null;
	// Username/password only. A bearer token cannot be used for Basic auth and
	// the admin path needs writes, so there is one way in, not two.
	if (!e.TRACCAR_ADMIN_USERNAME || !e.TRACCAR_ADMIN_PASSWORD) return null;
	return { baseUrl, username: e.TRACCAR_ADMIN_USERNAME, password: e.TRACCAR_ADMIN_PASSWORD };
}

/**
 * The RUNTIME identity for one tenant, or null when the tenant has none yet.
 *
 * Null is NOT an error and must never be reported as one: a tenant that has
 * never enrolled a tracker has no provider identity, which is exactly the
 * NOT_CONFIGURED case.
 */
export async function tenantCredentials(tenantId: string): Promise<TraccarCredentials | null> {
	const baseUrl = providerBaseUrl();
	if (!baseUrl) return null;

	const [row] = await db()
		.select()
		.from(schema.trackingAccounts)
		.where(
			and(
				eq(schema.trackingAccounts.tenantId, tenantId),
				eq(schema.trackingAccounts.provider, 'TRACCAR'),
				// A disabled identity is a revoked one. It must read as "no identity",
				// never as an outage.
				isNull(schema.trackingAccounts.disabledAt)
			)
		)
		.limit(1);
	if (!row) return null;

	try {
		return { baseUrl, username: row.providerLogin, password: decrypt(row.encryptedPassword) };
	} catch {
		// A credential we cannot decrypt is a credential we do not have. Say
		// nothing about why — the reason belongs in a rotation runbook, not in a
		// request path that would leak key state through timing or logs.
		return null;
	}
}

/** A fresh login and password for a tenant. Never derived from the tenant id. */
export function mintTenantIdentity(tenantId: string): { login: string; password: string } {
	return {
		// RFC 2606 guarantees .invalid is never resolvable, so this address cannot
		// receive a password reset even if the provider tried to send one.
		login: `tenant-${tenantId}@tracking.invalid`,
		password: randomToken(32)
	};
}

/** Seal a password for storage. The plaintext must never leave this process. */
export const sealPassword = (password: string): { blob: string; keyVersion: number } => encrypt(password);
