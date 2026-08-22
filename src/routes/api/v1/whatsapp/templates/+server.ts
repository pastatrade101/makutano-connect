import type { RequestHandler } from './$types';
import { handle, ok, requireApiScope } from '$lib/server/http';
import { listTemplates } from '$lib/server/whatsapp/templates';
import { enqueue } from '$lib/server/jobs/queue';

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:read');
		const templates = await listTemplates(ctx.tenantId);
		return ok(
			templates.map((t) => ({
				id: t.id,
				name: t.name,
				language: t.language,
				category: t.category,
				status: t.status,
				eventKey: t.eventKey,
				lastSyncedAt: t.lastSyncedAt
			}))
		);
	});

/** Queue a refresh from Meta; the sync itself runs as a background job (§28). */
export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'whatsapp:send');
		await enqueue(
			'whatsapp.templates.sync',
			{ tenantId: ctx.tenantId },
			{ tenantId: ctx.tenantId, dedupeKey: `tpl-sync:${ctx.tenantId}:${Math.floor(Date.now() / 60000)}` }
		);
		return ok({ queued: true }, undefined, { status: 202 });
	});
