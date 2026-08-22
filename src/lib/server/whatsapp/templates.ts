// WhatsApp message templates (§18). Templates live in Meta; this table mirrors them per
// tenant and maps our domain events onto approved template names.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { log } from '../logger';
import { graphRequest } from './client';
import { resolveCredentials } from './connections';

/** Event → template mapping keys (§18). */
export const TEMPLATE_EVENTS = [
	'BOOKING_REQUEST_RECEIVED',
	'QUOTATION_READY',
	'PAYMENT_REMINDER',
	'PAYMENT_RECEIVED',
	'BOOKING_CONFIRMED',
	'TRIP_REMINDER'
] as const;

export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export async function templateForEvent(
	tenantId: string,
	event: TemplateEvent
): Promise<schema.WhatsappTemplate | null> {
	const rows = await db()
		.select()
		.from(schema.whatsappTemplates)
		.where(
			and(
				eq(schema.whatsappTemplates.tenantId, tenantId),
				eq(schema.whatsappTemplates.eventKey, event),
				eq(schema.whatsappTemplates.status, 'APPROVED')
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function listTemplates(tenantId: string) {
	return db()
		.select()
		.from(schema.whatsappTemplates)
		.where(eq(schema.whatsappTemplates.tenantId, tenantId))
		.orderBy(schema.whatsappTemplates.name);
}

export async function setTemplateEvent(tenantId: string, templateId: string, event: TemplateEvent | null) {
	const [row] = await db()
		.update(schema.whatsappTemplates)
		.set({ eventKey: event, updatedAt: new Date() })
		.where(and(eq(schema.whatsappTemplates.id, templateId), eq(schema.whatsappTemplates.tenantId, tenantId)))
		.returning();
	return row ?? null;
}

/** Pull the tenant's approved templates from Meta into whatsapp_templates. */
export async function syncTemplates(tenantId: string): Promise<number> {
	const credentials = await resolveCredentials(tenantId);
	if (!credentials?.wabaId) {
		log.info('template_sync_skipped', { tenantId, reason: 'no_waba' });
		return 0;
	}

	const result = await graphRequest<{
		data?: Array<{
			id: string;
			name: string;
			language: string;
			category?: string;
			status?: string;
			components?: unknown[];
		}>;
	}>({
		credentials,
		path: `${credentials.wabaId}/message_templates`,
		method: 'GET',
		query: { fields: 'id,name,language,category,status,components', limit: '200' }
	});

	const templates = result?.data ?? [];
	const now = new Date();
	for (const t of templates) {
		const status = mapStatus(t.status);
		await db()
			.insert(schema.whatsappTemplates)
			.values({
				tenantId,
				metaTemplateId: t.id,
				name: t.name,
				language: t.language ?? 'en',
				category: t.category ?? null,
				status,
				components: t.components ?? [],
				lastSyncedAt: now
			})
			.onConflictDoUpdate({
				target: [schema.whatsappTemplates.tenantId, schema.whatsappTemplates.name, schema.whatsappTemplates.language],
				set: {
					metaTemplateId: t.id,
					category: t.category ?? null,
					status,
					components: t.components ?? [],
					lastSyncedAt: now,
					updatedAt: now
				}
			});
	}
	log.info('templates_synced', { tenantId, count: templates.length });
	return templates.length;
}

function mapStatus(metaStatus?: string): schema.WhatsappTemplate['status'] {
	switch ((metaStatus ?? '').toUpperCase()) {
		case 'APPROVED':
			return 'APPROVED';
		case 'REJECTED':
			return 'REJECTED';
		case 'PAUSED':
			return 'PAUSED';
		case 'DISABLED':
			return 'DISABLED';
		default:
			return 'PENDING';
	}
}
