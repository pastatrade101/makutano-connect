// WhatsApp message templates (§18). Templates live in Meta; this table mirrors them per
// tenant and maps our domain events onto approved template names.
import { and, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { log } from '../logger';
import { graphRequest } from './client';
import { resolveCredentials } from './connections';

/** Event → template mapping keys — one vocabulary shared with the Template Center. */
export { NOTIFY_EVENTS as TEMPLATE_EVENTS } from './template-engine';
export type { NotifyEvent as TemplateEvent } from './template-engine';
import type { NotifyEvent as TemplateEventT } from './template-engine';

export async function templateForEvent(
	tenantId: string,
	event: TemplateEventT
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

export async function setTemplateEvent(tenantId: string, templateId: string, event: TemplateEventT | null) {
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

	// payment_reminder_v2 is deliberately submitted while disabled so the current
	// approved reminder keeps production traffic during Meta review. The first sync
	// that sees V2 APPROVED atomically promotes it and removes the old event mapping.
	// This is name-scoped and never edits either template's approved Meta body.
	await promoteApprovedPaymentReminderV2(tenantId);
	log.info('templates_synced', { tenantId, count: templates.length });
	return templates.length;
}

/**
 * Complete the pre-authorized reminder V2 rollout only after Meta is authoritative.
 * Exported so the database transition can be tested without calling Meta.
 */
export async function promoteApprovedPaymentReminderV2(tenantId: string): Promise<boolean> {
	const [approvedPaymentReminderV2] = await db()
		.select({ id: schema.whatsappTemplates.id })
		.from(schema.whatsappTemplates)
		.where(
			and(
				eq(schema.whatsappTemplates.tenantId, tenantId),
				eq(schema.whatsappTemplates.name, 'payment_reminder_v2'),
				eq(schema.whatsappTemplates.status, 'APPROVED')
			)
		)
		.limit(1);
	if (!approvedPaymentReminderV2) return false;
	await db()
		.update(schema.whatsappTemplates)
		.set({
			eventKey: sql`case when ${schema.whatsappTemplates.id} = ${approvedPaymentReminderV2.id}::uuid then 'PAYMENT_REMINDER' else null end`,
			enabled: sql`case when ${schema.whatsappTemplates.id} = ${approvedPaymentReminderV2.id}::uuid then true else ${schema.whatsappTemplates.enabled} end`,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schema.whatsappTemplates.tenantId, tenantId),
				or(
					eq(schema.whatsappTemplates.id, approvedPaymentReminderV2.id),
					eq(schema.whatsappTemplates.eventKey, 'PAYMENT_REMINDER')
				)
			)
		);
	log.info('payment_reminder_v2_promoted', { tenantId, templateId: approvedPaymentReminderV2.id });
	return true;
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
