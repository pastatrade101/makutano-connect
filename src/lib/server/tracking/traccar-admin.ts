/**
 * The PROVISIONING client. Deliberately not importable from a request handler.
 *
 * This speaks to the tracking provider as a platform administrator, which is the
 * only identity that can create users and devices. Everything a request handler
 * needs is a read, and reads happen through the tenant's own read-only identity
 * in `credentials.ts` — so nothing in `src/routes` has any reason to import this
 * file, and a test asserts that none does.
 *
 * Keeping the two apart is the point. Connect previously used one administrator
 * for every read, which meant the provider's permission system was inert: a
 * fleet list asked for "every device you can see" and got the whole platform,
 * with isolation resting entirely on Connect filtering its own results.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { log } from '$lib/server/logger';
import { adminCredentials, mintTenantIdentity, sealPassword, type TraccarCredentials } from './credentials';

const TIMEOUT_MS = 8000;

/** A Traccar user as the provisioning path cares about it. */
type TraccarUser = {
	id?: number;
	email?: string;
	administrator?: boolean;
	readonly?: boolean;
	deviceReadonly?: boolean;
	disabled?: boolean;
};

/**
 * The flags a tenant's runtime identity MUST carry.
 *
 * `readonly` is the load-bearing one. Traccar denies every write for a readonly
 * user at the top of its permission check, which closes several attacks at once
 * — most importantly that a writable tenant credential can create a device and
 * then unlink the device from ITSELF, so any device limit bounds nothing. It
 * also removes `DELETE /api/positions`, which a non-admin can otherwise call.
 */
export const TENANT_USER_FLAGS = {
	administrator: false,
	readonly: true,
	deviceReadonly: true,
	disabled: false,
	// `userLimit != 0` is literally how Traccar decides someone is a manager.
	userLimit: 0,
	// Reports are how `GET /positions?from&to` is authorised, so history needs this off.
	disableReports: false,
	limitCommands: true
} as const;

async function adminRequest<T>(
	path: string,
	init: { method?: string; body?: unknown } = {}
): Promise<T> {
	const creds = adminCredentials();
	if (!creds) throw new Error('traccar_admin_not_configured');

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${creds.baseUrl}/api${path}`, {
			method: init.method ?? 'GET',
			headers: {
				Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
				Accept: 'application/json',
				...(init.body ? { 'Content-Type': 'application/json' } : {})
			},
			body: init.body ? JSON.stringify(init.body) : undefined,
			signal: controller.signal
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`traccar_admin_http_${res.status}`);
		return (text ? JSON.parse(text) : null) as T;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The tenant's provider identity, creating it if this tenant has none.
 *
 * Idempotent on the Connect side: the row is written first, so a crash between
 * creating the provider user and recording it cannot leave an identity nobody
 * can name. If the provider already knows the login — a half-finished earlier
 * attempt — it is adopted rather than duplicated.
 */
export async function ensureTenantAccount(tenantId: string): Promise<schema.TrackingAccount> {
	const [existing] = await db()
		.select()
		.from(schema.trackingAccounts)
		.where(
			and(eq(schema.trackingAccounts.tenantId, tenantId), eq(schema.trackingAccounts.provider, 'TRACCAR'))
		)
		.limit(1);
	if (existing) return existing;

	const { login, password } = mintTenantIdentity(tenantId);
	const sealed = sealPassword(password);

	// Written BEFORE the provider is touched, so there is never a provider user
	// that Connect cannot name.
	const [row] = await db()
		.insert(schema.trackingAccounts)
		.values({
			tenantId,
			provider: 'TRACCAR',
			providerLogin: login,
			encryptedPassword: sealed.blob,
			keyVersion: sealed.keyVersion
		})
		.returning();

	let user: TraccarUser | null = null;
	try {
		user = await adminRequest<TraccarUser>('/users', {
			method: 'POST',
			body: { name: `Makutano tenant ${tenantId}`, email: login, password, ...TENANT_USER_FLAGS }
		});
	} catch (err) {
		// A duplicate email means an earlier attempt got further than its record
		// did. Adopt it rather than leaving the tenant without an identity.
		const all = await adminRequest<TraccarUser[]>('/users');
		user = all.find((u) => u.email === login) ?? null;
		if (!user) {
			log.error('tracking_account_provision_failed', { tenantId, reason: String(err).slice(0, 120) });
			throw err;
		}
		// The password on the adopted user is not the one we just sealed, so make
		// it so — otherwise the stored credential would silently not work.
		await adminRequest(`/users/${user.id}`, { method: 'PUT', body: { ...user, ...TENANT_USER_FLAGS, password } });
	}

	const [updated] = await db()
		.update(schema.trackingAccounts)
		.set({ providerUserId: user.id ?? null, updatedAt: new Date() })
		.where(eq(schema.trackingAccounts.id, row.id))
		.returning();
	return updated;
}

/** Give a tenant's identity sight of one device. Provisioning only. */
export async function linkDeviceToTenant(providerUserId: number, deviceId: number): Promise<void> {
	await adminRequest('/permissions', { method: 'POST', body: { userId: providerUserId, deviceId } });
}

/**
 * Look a device up by its reference, as the administrator. Provisioning only.
 *
 * `?all=true` and filter here, NOT `?uniqueId=`. Verified against the deployed
 * 6.15.3: for any user — administrator included — `uniqueId` filters within the
 * devices that user is LINKED to, and it does not combine with `all`:
 *
 *   /devices?uniqueId=X            -> []   (provisioning admin, not linked)
 *   /devices?all=true&uniqueId=X   -> []   (the two do not compose)
 *   /devices?all=true              -> the device
 *
 * A provisioning identity is deliberately linked to nothing, so the obvious
 * lookup silently returns nothing and the caller concludes the device does not
 * exist. The runtime path is unaffected: a tenant IS linked to its own devices,
 * which is exactly why `?uniqueId=` is the right call there and the wrong one
 * here.
 */
export async function findDeviceByRef(deviceRef: string): Promise<{ id?: number; uniqueId?: string } | null> {
	const devices = await adminRequest<{ id?: number; uniqueId?: string }[]>('/devices?all=true');
	return devices.find((d) => d.uniqueId === deviceRef) ?? null;
}

/**
 * Revoke a tenant's access instantly and irreversibly.
 *
 * Traccar checks `disabled` on every authentication path, so this is the
 * cheapest correct answer for offboarding or a suspected compromise — no key
 * rotation, no waiting for a token to expire.
 */
export async function disableTenantAccount(tenantId: string): Promise<void> {
	const [row] = await db()
		.select()
		.from(schema.trackingAccounts)
		.where(and(eq(schema.trackingAccounts.tenantId, tenantId), eq(schema.trackingAccounts.provider, 'TRACCAR')))
		.limit(1);
	if (!row?.providerUserId) return;
	const user = await adminRequest<TraccarUser>(`/users/${row.providerUserId}`);
	await adminRequest(`/users/${row.providerUserId}`, { method: 'PUT', body: { ...user, disabled: true } });
	await db()
		.update(schema.trackingAccounts)
		.set({ disabledAt: new Date(), updatedAt: new Date() })
		.where(eq(schema.trackingAccounts.id, row.id));
}

export type { TraccarCredentials };
