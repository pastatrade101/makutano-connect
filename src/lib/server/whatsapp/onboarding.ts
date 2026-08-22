// Short-lived Embedded Signup sessions (§7, §31).
//
// The client's own CMS calls POST /api/v1/whatsapp/connect-session with its server API
// key; we mint a single-use, tenant-bound token with an expiry and a nonce. That token
// — not the tenant id, and certainly not the API key — is what the browser carries into
// the popup, so a leaked link cannot be replayed against a different tenant.
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../encryption';
import { AppError } from '../errors';
import { env } from '../env';

const SESSION_TTL_MS = 1000 * 60 * 15; // 15 minutes

export type ConnectSession = {
	sessionId: string;
	token: string;
	nonce: string;
	expiresAt: string;
	launchUrl: string;
};

export async function createConnectSession(params: {
	tenantId: string;
	apiKeyId?: string | null;
	redirectUrl?: string | null;
}): Promise<ConnectSession> {
	const token = randomToken(32);
	const nonce = randomToken(12);
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

	const [row] = await db()
		.insert(schema.whatsappOnboardingSessions)
		.values({
			tenantId: params.tenantId,
			tokenHash: sha256(token),
			nonce,
			redirectUrl: params.redirectUrl ?? null,
			createdByApiKeyId: params.apiKeyId ?? null,
			expiresAt
		})
		.returning();

	const base = env().PUBLIC_APP_URL.replace(/\/+$/, '');
	return {
		sessionId: row.id,
		token,
		nonce,
		expiresAt: expiresAt.toISOString(),
		launchUrl: `${base}/connect/whatsapp?session=${encodeURIComponent(token)}`
	};
}

/** Resolve a session token to its tenant. Expired, consumed or unknown tokens throw. */
export async function resolveConnectSession(token: string): Promise<schema.WhatsappOnboardingSession> {
	const rows = await db()
		.select()
		.from(schema.whatsappOnboardingSessions)
		.where(
			and(
				eq(schema.whatsappOnboardingSessions.tokenHash, sha256(token)),
				gt(schema.whatsappOnboardingSessions.expiresAt, new Date()),
				isNull(schema.whatsappOnboardingSessions.consumedAt)
			)
		)
		.limit(1);
	const row = rows[0];
	if (!row) throw new AppError('UNAUTHORIZED', 'This connection link is invalid or has expired.');
	return row;
}

/** Single use: consuming binds the exchange to exactly one popup run. */
export async function consumeConnectSession(
	sessionId: string,
	nonce: string
): Promise<schema.WhatsappOnboardingSession> {
	const rows = await db()
		.update(schema.whatsappOnboardingSessions)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(schema.whatsappOnboardingSessions.id, sessionId),
				eq(schema.whatsappOnboardingSessions.nonce, nonce),
				gt(schema.whatsappOnboardingSessions.expiresAt, new Date()),
				isNull(schema.whatsappOnboardingSessions.consumedAt)
			)
		)
		.returning();
	const row = rows[0];
	if (!row) throw new AppError('UNAUTHORIZED', 'This connection session is no longer valid.');
	return row;
}
