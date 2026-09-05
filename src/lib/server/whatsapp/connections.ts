// whatsapp_connections persistence + credential resolution (§8, §31, §32).
//
// Two invariants hold the multi-tenant model together:
//   1. phone_number_id is globally unique — it is how an inbound webhook finds its
//      tenant, so it may never be claimed by two tenants.
//   2. A decrypted token is produced only here, only for the tenant that owns it,
//      and is never returned to any HTTP response or written to a log (§29).
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt, encrypt } from '../encryption';
import { assertAllowed, assertWithinCount } from '../entitlements';
import { AppError } from '../errors';
import { log } from '../logger';
import { metaAppConfig, type WhatsAppCredentials } from './config';
import { enqueue } from '../jobs/queue';

/** The only shape that may cross an API boundary — no token, no key version (§31). */
export type SafeConnection = {
	id: string;
	status: schema.WhatsappConnection['status'];
	displayPhoneNumber: string | null;
	businessName: string | null;
	phoneNumberId: string;
	wabaId: string | null;
	connectedAt: string | null;
	disconnectedAt: string | null;
	lastWebhookAt: string | null;
	lastSuccessfulSendAt: string | null;
	lastErrorAt: string | null;
	lastErrorCode: string | null;
	tokenExpiresAt: string | null;
};

export function toSafeConnection(row: schema.WhatsappConnection): SafeConnection {
	return {
		id: row.id,
		status: row.status,
		displayPhoneNumber: row.displayPhoneNumber,
		businessName: row.businessName,
		phoneNumberId: row.phoneNumberId,
		wabaId: row.wabaId,
		connectedAt: row.connectedAt?.toISOString() ?? null,
		disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
		lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
		lastSuccessfulSendAt: row.lastSuccessfulSendAt?.toISOString() ?? null,
		lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
		lastErrorCode: row.lastErrorCode,
		tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null
	};
}

export async function getConnectionForTenant(tenantId: string): Promise<schema.WhatsappConnection | null> {
	// Selection order matters the moment a tenant has connected more than one number:
	// a live connection beats a dead one, the primary beats the rest, and newest wins
	// among equals — so connecting your own number immediately takes over sending.
	const rows = await db()
		.select()
		.from(schema.whatsappConnections)
		.where(eq(schema.whatsappConnections.tenantId, tenantId))
		.orderBy(
			sql`(${schema.whatsappConnections.status} = 'CONNECTED') desc`,
			sql`${schema.whatsappConnections.isPrimary} desc`,
			sql`${schema.whatsappConnections.updatedAt} desc`
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function getConnectionByPhoneNumberId(phoneNumberId: string): Promise<schema.WhatsappConnection | null> {
	const rows = await db()
		.select()
		.from(schema.whatsappConnections)
		.where(eq(schema.whatsappConnections.phoneNumberId, phoneNumberId))
		.limit(1);
	return rows[0] ?? null;
}

export type UpsertConnectionInput = {
	tenantId: string;
	metaBusinessId?: string | null;
	wabaId?: string | null;
	phoneNumberId: string;
	displayPhoneNumber?: string | null;
	businessName?: string | null;
	accessToken: string;
	tokenExpiresAt?: Date | null;
};

export async function upsertConnection(input: UpsertConnectionInput): Promise<schema.WhatsappConnection> {
	await assertAllowed(input.tenantId, { feature: 'whatsapp.enabled' });
	// Only CONNECTED numbers count toward the allowance, and re-connecting a number the
	// tenant already holds is always permitted — the cap is on distinct live numbers.
	const live = await db()
		.select({ phoneNumberId: schema.whatsappConnections.phoneNumberId })
		.from(schema.whatsappConnections)
		.where(and(eq(schema.whatsappConnections.tenantId, input.tenantId), eq(schema.whatsappConnections.status, 'CONNECTED')));
	if (!live.some((c) => c.phoneNumberId === input.phoneNumberId)) {
		await assertWithinCount(input.tenantId, 'whatsapp.maxNumbers', live.length);
	}
	const sealed = encrypt(input.accessToken);
	const now = new Date();

	const [row] = await db()
		.insert(schema.whatsappConnections)
		.values({
			tenantId: input.tenantId,
			metaBusinessId: input.metaBusinessId ?? null,
			wabaId: input.wabaId ?? null,
			phoneNumberId: input.phoneNumberId,
			displayPhoneNumber: input.displayPhoneNumber ?? null,
			businessName: input.businessName ?? null,
			encryptedAccessToken: sealed.blob,
			keyVersion: sealed.keyVersion,
			tokenExpiresAt: input.tokenExpiresAt ?? null,
			status: 'CONNECTED',
			connectedAt: now,
			disconnectedAt: null
		})
		.onConflictDoUpdate({
			target: schema.whatsappConnections.phoneNumberId,
			set: {
				tenantId: input.tenantId,
				metaBusinessId: input.metaBusinessId ?? null,
				wabaId: input.wabaId ?? null,
				displayPhoneNumber: input.displayPhoneNumber ?? null,
				businessName: input.businessName ?? null,
				encryptedAccessToken: sealed.blob,
				keyVersion: sealed.keyVersion,
				tokenExpiresAt: input.tokenExpiresAt ?? null,
				status: 'CONNECTED',
				connectedAt: now,
				disconnectedAt: null,
				lastErrorAt: null,
				lastErrorCode: null,
				updatedAt: now
			}
		})
		.returning();

	// The number that just (re)connected becomes the tenant's primary sender; any
	// other rows the tenant holds are demoted rather than deleted, preserving their
	// history and their webhook routing.
	await db()
		.update(schema.whatsappConnections)
		.set({ isPrimary: false })
		.where(
			and(
				eq(schema.whatsappConnections.tenantId, input.tenantId),
				sql`${schema.whatsappConnections.id} <> ${row.id}`
			)
		);
	if (!row.isPrimary) {
		await db().update(schema.whatsappConnections).set({ isPrimary: true }).where(eq(schema.whatsappConnections.id, row.id));
	}

	/*
	 * Templates belong to a WABA, not to us. Reconnecting to a DIFFERENT WABA left
	 * the previous one's templates in the table, and every send against them came
	 * back "(#132001) Template name does not exist in the translation" — a tenant
	 * whose enquiries silently stopped being acknowledged, with an approved-looking
	 * template list on screen the whole time. A sync was only ever enqueued from a
	 * settings page, so nobody who did not go looking would ever see it corrected.
	 *
	 * Enqueued, not awaited: the connection itself must succeed even if the queue
	 * or Meta is having a bad day.
	 */
	void enqueue('whatsapp.templates.sync', { tenantId: input.tenantId }, { tenantId: input.tenantId }).catch((err) =>
		log.warn('template_sync_enqueue_failed', { tenantId: input.tenantId, error: (err as Error)?.message })
	);

	return row;
}

/**
 * Resolve sending credentials for a tenant. Returns null (never a fallback to some
 * other tenant's number) when the tenant has no live connection — §8's isolation rule.
 */
export async function resolveCredentials(tenantId: string): Promise<WhatsAppCredentials | null> {
	const row = await getConnectionForTenant(tenantId);
	if (!row || row.status !== 'CONNECTED') return null;
	try {
		const cfg = metaAppConfig();
		return {
			accessToken: decrypt(row.encryptedAccessToken),
			phoneNumberId: row.phoneNumberId,
			wabaId: row.wabaId ?? '',
			apiVersion: cfg.graphVersion,
			graphBase: cfg.graphBase,
			tenantId: row.tenantId,
			connectionId: row.id
		};
	} catch (err) {
		// A blob that will not decrypt means the key rotated or the row was tampered
		// with. Flag it for re-auth rather than silently sending as nobody.
		log.error('credential_decrypt_failed', { connectionId: row.id, error: (err as Error)?.message });
		await markError(row.id, 'decrypt_failed');
		return null;
	}
}

export async function requireCredentials(tenantId: string): Promise<WhatsAppCredentials> {
	const credentials = await resolveCredentials(tenantId);
	if (!credentials) {
		throw new AppError('WHATSAPP_NOT_CONNECTED', 'This account has no connected WhatsApp number.');
	}
	return credentials;
}

export async function getConnectionByWabaId(wabaId: string): Promise<schema.WhatsappConnection | null> {
	const rows = await db()
		.select()
		.from(schema.whatsappConnections)
		.where(eq(schema.whatsappConnections.wabaId, wabaId))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Which tenant owns an inbound event? Null → the event is not ours to process (§9).
 *
 * phone_number_id is the PRIMARY key for routing because it is globally unique and
 * present on every message and status. waba_id is a secondary fallback for events that
 * are account-scoped rather than number-scoped (template status updates, account
 * alerts), where Meta sends no phone_number_id.
 *
 * There is no third fallback and no default tenant: an unrecognised identifier means
 * the event is dropped. Guessing an owner here would attribute one business's customer
 * conversation to another.
 */
export async function resolveTenantForEvent(identifiers: {
	phoneNumberId?: string | null;
	wabaId?: string | null;
}): Promise<{ tenantId: string; connection: schema.WhatsappConnection; matchedOn: 'phone_number_id' | 'waba_id' } | null> {
	if (identifiers.phoneNumberId) {
		const connection = await getConnectionByPhoneNumberId(identifiers.phoneNumberId);
		if (connection) return { tenantId: connection.tenantId, connection, matchedOn: 'phone_number_id' };
	}
	if (identifiers.wabaId) {
		const connection = await getConnectionByWabaId(identifiers.wabaId);
		if (connection) return { tenantId: connection.tenantId, connection, matchedOn: 'waba_id' };
	}
	return null;
}

/** Convenience wrapper for the common number-scoped case. */
export async function resolveTenantByPhoneNumberId(
	phoneNumberId: string
): Promise<{ tenantId: string; connection: schema.WhatsappConnection } | null> {
	if (!phoneNumberId) return null;
	const connection = await getConnectionByPhoneNumberId(phoneNumberId);
	if (!connection) return null;
	return { tenantId: connection.tenantId, connection };
}

/* --------------------------------------------------- §32 health tracking -- */

export async function markWebhookSeen(connectionId: string): Promise<void> {
	await db()
		.update(schema.whatsappConnections)
		.set({ lastWebhookAt: new Date() })
		.where(eq(schema.whatsappConnections.id, connectionId));
}

export async function markSendSuccess(connectionId: string): Promise<void> {
	await db()
		.update(schema.whatsappConnections)
		.set({ lastSuccessfulSendAt: new Date(), lastErrorCode: null })
		.where(eq(schema.whatsappConnections.id, connectionId));
}

export async function markError(connectionId: string, code: string, reauth = false): Promise<void> {
	await db()
		.update(schema.whatsappConnections)
		.set({
			lastErrorAt: new Date(),
			lastErrorCode: code.slice(0, 100),
			...(reauth ? { status: 'REAUTH_REQUIRED' as const } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.whatsappConnections.id, connectionId));
}

/**
 * Disconnect (§31): stop outbound sends but preserve message/conversation history and
 * audit records. The token is overwritten with an empty sealed value so a disconnected
 * connection carries no usable credential.
 */
export async function disconnect(tenantId: string): Promise<SafeConnection | null> {
	const row = await getConnectionForTenant(tenantId);
	if (!row) return null;
	const sealed = encrypt('');
	const [updated] = await db()
		.update(schema.whatsappConnections)
		.set({
			status: 'DISCONNECTED',
			disconnectedAt: new Date(),
			encryptedAccessToken: sealed.blob,
			keyVersion: sealed.keyVersion,
			updatedAt: new Date()
		})
		.where(and(eq(schema.whatsappConnections.id, row.id), eq(schema.whatsappConnections.tenantId, tenantId)))
		.returning();
	return toSafeConnection(updated);
}

/** Scheduled job: flag connections whose token is expiring or expired (§32). */
export async function checkTokenHealth(): Promise<number> {
	const soon = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
	const rows = await db()
		.update(schema.whatsappConnections)
		.set({ status: 'REAUTH_REQUIRED', lastErrorCode: 'token_expiring', lastErrorAt: new Date() })
		.where(
			and(
				eq(schema.whatsappConnections.status, 'CONNECTED'),
				isNotNull(schema.whatsappConnections.tokenExpiresAt),
				lt(schema.whatsappConnections.tokenExpiresAt, soon)
			)
		)
		.returning({ id: schema.whatsappConnections.id });
	if (rows.length) log.warn('whatsapp_tokens_expiring', { count: rows.length });
	return rows.length;
}
