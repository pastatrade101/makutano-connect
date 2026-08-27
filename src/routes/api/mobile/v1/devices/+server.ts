// Where to reach this person. One row per device, refreshed on every launch so a
// rotated Firebase token never silently stops delivering.
import type { RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { ok, problem, requireViewer } from '$lib/server/mobile';

export const POST: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const body = (await event.request.json().catch(() => ({}))) as {
			token?: string;
			platform?: string;
			deviceName?: string;
		};
		const token = String(body.token ?? '').trim();
		if (!token) return problem(new Error('A device token is required.'), event.locals.requestId);

		await db()
			.insert(schema.deviceTokens)
			.values({
				userId: viewer.userId,
				tenantId: viewer.tenantId,
				token,
				platform: String(body.platform ?? 'android').slice(0, 20),
				deviceName: String(body.deviceName ?? '').slice(0, 120) || null,
				lastSeenAt: new Date()
			})
			.onConflictDoUpdate({
				target: schema.deviceTokens.token,
				// A phone that changes hands must not keep notifying the previous owner.
				set: {
					userId: viewer.userId,
					tenantId: viewer.tenantId,
					lastSeenAt: new Date(),
					deviceName: String(body.deviceName ?? '').slice(0, 120) || null
				}
			});
		return ok({ registered: true });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const token = String(event.url.searchParams.get('token') ?? '').trim();
		if (token) {
			await db()
				.delete(schema.deviceTokens)
				.where(and(eq(schema.deviceTokens.token, token), eq(schema.deviceTokens.userId, viewer.userId)));
		}
		return ok({ removed: true });
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
