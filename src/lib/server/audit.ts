// Append-only audit trail (§27). Writing an audit row must never break the operation
// that triggered it, so failures are logged and swallowed.
import { db, schema } from './db';
import { log } from './logger';

export type AuditActor = {
	type: 'user' | 'api_key' | 'system' | 'meta';
	userId?: string | null;
	apiKeyId?: string | null;
	ipHash?: string | null;
	requestId?: string | null;
};

export type AuditAction =
	| 'tenant.created'
	| 'tenant.updated'
	| 'tenant.suspended'
	| 'tenant.reactivated'
	| 'plan.changed'
	| 'plan.updated'
	| 'subscription.modified'
	| 'entitlement.overridden'
	| 'entitlement.override_removed'
	| 'user.invited'
	| 'user.login'
	| 'user.logout'
	| 'role.changed'
	| 'api_key.created'
	| 'api_key.revoked'
	| 'whatsapp.connected'
	| 'whatsapp.disconnected'
	| 'booking_request.created'
	| 'booking_request.updated'
	| 'booking.created'
	| 'booking.confirmed'
	| 'booking.cancelled'
	| 'quotation.created'
	| 'quotation.sent'
	| 'quotation.accepted'
	| 'quotation.converted'
	| 'order.created'
	| 'order.status_changed'
	| 'form.created'
	| 'form.updated'
	| 'form.submission'
	| 'payment.created'
	| 'payment.modified'
	| 'webhook_endpoint.created'
	| 'webhook_endpoint.deleted';

export async function audit(
	tenantId: string | null,
	action: AuditAction,
	actor: AuditActor,
	entity?: { type?: string; id?: string },
	metadata: Record<string, unknown> = {}
): Promise<void> {
	try {
		await db()
			.insert(schema.auditLogs)
			.values({
				tenantId,
				action,
				actorType: actor.type,
				actorUserId: actor.userId ?? null,
				actorApiKeyId: actor.apiKeyId ?? null,
				entityType: entity?.type ?? null,
				entityId: entity?.id ?? null,
				metadata,
				ipHash: actor.ipHash ?? null,
				requestId: actor.requestId ?? null
			});
	} catch (err) {
		log.error('audit_write_failed', { action, error: (err as Error)?.message });
	}
}
