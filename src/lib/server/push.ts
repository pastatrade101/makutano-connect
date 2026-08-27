// Push notifications for the mobile app, through Firebase Cloud Messaging.
//
// The rule this module exists to keep: a message reaches the person who is expected
// to answer it. That is the assignee if the thread has one, and the people who can
// pick it up if it does not — never the whole company for every ping.
//
// Inert without credentials, exactly like the AI layer: no key, no send, no error.
// A tenant with no configured Firebase project simply keeps working without push.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import { env, liveEnv } from './env';
import { log } from './logger';

export type PushMessage = {
	title: string;
	body: string;
	/** Opened by the app to land on the right screen. */
	data?: Record<string, string>;
};

function serviceAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
	const live = liveEnv();
	const raw = String(live.FCM_SERVICE_ACCOUNT ?? env().FCM_SERVICE_ACCOUNT ?? '').trim();
	if (!raw) return null;
	// A service-account JSON blob does not survive a .env file intact — it carries
	// quotes, spaces and escaped newlines. Base64 is accepted for that reason, and
	// is what the deployment notes recommend; raw JSON still works locally.
	const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
	try {
		const parsed = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
		if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
		return {
			projectId: parsed.project_id,
			clientEmail: parsed.client_email,
			// Env files carry the key with literal \n sequences.
			privateKey: parsed.private_key.replace(/\\n/g, '\n')
		};
	} catch {
		log.warn('push_service_account_unreadable');
		return null;
	}
}

export function pushConfigured(): boolean {
	return serviceAccount() !== null;
}

/** Google OAuth token for FCM, minted per send. Short-lived, never stored. */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
	const account = serviceAccount();
	if (!account) return null;
	if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT' };
	const claim = {
		iss: account.clientEmail,
		scope: 'https://www.googleapis.com/auth/firebase.messaging',
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600
	};
	const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const unsigned = `${b64(header)}.${b64(claim)}`;

	const { createSign } = await import('node:crypto');
	const signer = createSign('RSA-SHA256');
	signer.update(unsigned);
	const signature = signer.sign(account.privateKey, 'base64url');

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${signature}`
		})
	});
	if (!res.ok) {
		log.error('push_token_failed', { status: res.status });
		return null;
	}
	const body = (await res.json()) as { access_token?: string; expires_in?: number };
	if (!body.access_token) return null;
	cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
	return cachedToken.value;
}

/** Send to a set of users. Dead tokens are pruned as Firebase reports them. */
export async function pushToUsers(
	tenantId: string,
	userIds: string[],
	message: PushMessage
): Promise<{ sent: number; pruned: number }> {
	const account = serviceAccount();
	if (!account || userIds.length === 0) return { sent: 0, pruned: 0 };

	const devices = await db()
		.select({ id: schema.deviceTokens.id, token: schema.deviceTokens.token })
		.from(schema.deviceTokens)
		.where(and(inArray(schema.deviceTokens.userId, [...new Set(userIds)]), eq(schema.deviceTokens.tenantId, tenantId)));
	if (!devices.length) return { sent: 0, pruned: 0 };

	const token = await accessToken();
	if (!token) return { sent: 0, pruned: 0 };

	let sent = 0;
	const dead: string[] = [];
	await Promise.all(
		devices.map(async (device) => {
			const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					message: {
						token: device.token,
						notification: { title: message.title, body: message.body },
						data: message.data ?? {},
						android: { priority: 'HIGH', notification: { channel_id: 'makutano_inbox' } },
						apns: { payload: { aps: { sound: 'default' } } }
					}
				})
			});
			if (res.ok) {
				sent += 1;
				return;
			}
			// 404/400 UNREGISTERED means the app was uninstalled or the token rotated.
			if (res.status === 404 || res.status === 400) dead.push(device.id);
		})
	).catch(() => undefined);

	if (dead.length) {
		await db().delete(schema.deviceTokens).where(inArray(schema.deviceTokens.id, dead));
	}
	log.info('push_sent', { tenantId, sent, pruned: dead.length });
	return { sent, pruned: dead.length };
}

/**
 * Who should hear about activity on a thread: the person holding it, or — when
 * nobody is — everyone who could pick it up. Never the whole company otherwise.
 */
export async function recipientsForConversation(
	tenantId: string,
	conversation: { assignedToUserId: string | null; visibility: string }
): Promise<string[]> {
	if (conversation.assignedToUserId) return [conversation.assignedToUserId];
	if (conversation.visibility === 'PRIVATE') return [];

	const members = await db()
		.select({ userId: schema.tenantMemberships.userId, role: schema.tenantMemberships.role })
		.from(schema.tenantMemberships)
		.where(and(eq(schema.tenantMemberships.tenantId, tenantId)));
	return members.filter((m) => ['OWNER', 'ADMIN', 'BOOKING_AGENT'].includes(String(m.role))).map((m) => m.userId);
}
