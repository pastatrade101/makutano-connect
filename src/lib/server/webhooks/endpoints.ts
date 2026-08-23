// Client webhook endpoint management (§20). The signing secret is generated here,
// shown once, and stored encrypted like every other credential.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { encrypt, randomToken } from '../encryption';
import { AppError } from '../errors';
import { assertAllowed } from '../entitlements';
import { isKnownEvent } from '../events';

export type SafeEndpoint = {
	id: string;
	url: string;
	description: string | null;
	events: string[];
	isActive: boolean;
	lastSuccessAt: string | null;
	lastFailureAt: string | null;
	consecutiveFailures: number;
	createdAt: string;
};

export function toSafeEndpoint(row: schema.WebhookEndpoint): SafeEndpoint {
	return {
		id: row.id,
		url: row.url,
		description: row.description,
		events: row.events ?? [],
		isActive: row.isActive,
		lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
		lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
		consecutiveFailures: row.consecutiveFailures,
		createdAt: row.createdAt.toISOString()
	};
}

export async function createEndpoint(params: {
	tenantId: string;
	url: string;
	description?: string | null;
	events?: string[];
}): Promise<{ endpoint: SafeEndpoint; secret: string }> {
	await assertAllowed(params.tenantId, { feature: 'webhooks.enabled' });
	let parsed: URL;
	try {
		parsed = new URL(params.url);
	} catch {
		throw new AppError('VALIDATION_ERROR', 'Webhook URL must be a valid absolute URL.');
	}
	if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
		throw new AppError('VALIDATION_ERROR', 'Webhook URL must use HTTPS.');
	}
	const unknown = (params.events ?? []).filter((e) => !isKnownEvent(e));
	if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unknown webhook events: ${unknown.join(', ')}`);

	const secret = `whsec_${randomToken(24)}`;
	const sealed = encrypt(secret);
	const [row] = await db()
		.insert(schema.webhookEndpoints)
		.values({
			tenantId: params.tenantId,
			url: parsed.toString(),
			description: params.description ?? null,
			encryptedSecret: sealed.blob,
			keyVersion: sealed.keyVersion,
			events: params.events ?? []
		})
		.returning();

	return { endpoint: toSafeEndpoint(row), secret };
}

export async function listEndpoints(tenantId: string): Promise<SafeEndpoint[]> {
	const rows = await db()
		.select()
		.from(schema.webhookEndpoints)
		.where(eq(schema.webhookEndpoints.tenantId, tenantId))
		.orderBy(schema.webhookEndpoints.createdAt);
	return rows.map(toSafeEndpoint);
}

export async function deleteEndpoint(tenantId: string, id: string): Promise<void> {
	const rows = await db()
		.delete(schema.webhookEndpoints)
		.where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.tenantId, tenantId)))
		.returning({ id: schema.webhookEndpoints.id });
	if (!rows.length) throw new AppError('NOT_FOUND', 'Webhook endpoint not found.');
}
