// Cookie sessions for the portal/admin UI (§23). The cookie carries a random token;
// only its sha-256 is stored, so a database leak cannot be replayed as a login.
import type { Cookies } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../encryption';
import { isProduction } from '../env';

export const SESSION_COOKIE = 'mk_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RENEW_WITHIN_MS = 1000 * 60 * 60 * 24 * 15;

export type SessionContext = {
	sessionId: string;
	user: schema.User;
	activeTenantId: string | null;
};

export async function createSession(
	userId: string,
	opts: { activeTenantId?: string | null; userAgent?: string | null; ipHash?: string | null } = {}
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await db()
		.insert(schema.sessions)
		.values({
			id: sha256(token),
			userId,
			activeTenantId: opts.activeTenantId ?? null,
			userAgent: opts.userAgent?.slice(0, 300) ?? null,
			ipHash: opts.ipHash ?? null,
			expiresAt
		});
	return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
	if (!token) return null;
	const id = sha256(token);
	const rows = await db()
		.select({ session: schema.sessions, user: schema.users })
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
		.limit(1);

	const row = rows[0];
	if (!row || !row.user.isActive) return null;

	// Sliding expiry: extend when the session is closer than half its life to expiring.
	if (row.session.expiresAt.getTime() - Date.now() < RENEW_WITHIN_MS) {
		await db()
			.update(schema.sessions)
			.set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
			.where(eq(schema.sessions.id, id));
	}

	return { sessionId: id, user: row.user, activeTenantId: row.session.activeTenantId };
}

export async function setActiveTenant(sessionId: string, tenantId: string | null): Promise<void> {
	await db().update(schema.sessions).set({ activeTenantId: tenantId }).where(eq(schema.sessions.id, sessionId));
}

export async function destroySession(token: string | undefined): Promise<void> {
	if (!token) return;
	await db()
		.delete(schema.sessions)
		.where(eq(schema.sessions.id, sha256(token)));
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isProduction(),
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
