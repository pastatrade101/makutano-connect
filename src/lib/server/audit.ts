// Append-only audit trail (§27). Writing an audit row must never break the operation
// that triggered it, so failures are logged and swallowed.
import { db, schema, type Database } from './db';
import { log } from './logger';

/** Anything that can run an insert — the pool, or an open transaction. */
type Executor = Pick<Database, 'insert'>;

export type AuditActor = {
	type: 'user' | 'api_key' | 'system' | 'meta';
	userId?: string | null;
	apiKeyId?: string | null;
	ipHash?: string | null;
	requestId?: string | null;
};

export type AuditAction =
	| 'signup.started'
	| 'signup.verification_sent'
	| 'email.verified'
	| 'tenant.provisioned'
	| 'plan.selected'
	| 'subscription.created'
	| 'onboarding.completed'
	| 'tenant.created'
	| 'tenant.updated'
	| 'tenant.suspended'
	| 'tenant.reactivated'
	| 'tenant.deleted'
	| 'order_link.created'
	| 'order_link.updated'
	| 'order_link.status_changed'
	| 'plan.changed'
	| 'plan.updated'
	| 'subscription.modified'
	| 'entitlement.overridden'
	| 'entitlement.override_removed'
	| 'user.invited'
	| 'user.invite_resent'
	| 'user.invite_accepted'
	| 'user.deactivated'
	| 'user.reactivated'
	| 'user.removed'
	| 'permission.changed'
	// Operations. The handover and the readiness verdict are both worth being able
	// to reconstruct later: "who said this trip could depart" is a real question
	// after something goes wrong on the ground.
	| 'trip.created'
	| 'trip.updated'
	| 'trip.status_changed'
	| 'trip.assigned'
	| 'crew.created'
	| 'crew.updated'
	| 'conversation.visibility_changed'
	| 'conversation.assigned'
	| 'conversation.closed'
	| 'conversation.reopened'
	| 'conversation.deleted'
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
	// Soft deletes get their own names. "booking.updated" would bury the one
	// action anybody searching this log after a row vanished is looking for.
	| 'booking.deleted'
	| 'booking.restored'
	| 'booking_request.deleted'
	| 'booking_request.restored'
	| 'quotation.deleted'
	| 'quotation.restored'
	| 'quotation.created'
	| 'quotation.sent'
	| 'quotation.accepted'
	| 'quotation.converted'
	| 'order.created'
	| 'order.status_changed'
	| 'order_batch.created'
	| 'order_batch.updated'
	| 'form.created'
	| 'form.updated'
	| 'form.submission'
	| 'payment.created'
	| 'payment.modified'
	| 'payment.requested'
	| 'payment.whatsapp_request_queued'
	| 'payment.whatsapp_request_delivered'
	| 'payment.whatsapp_request_read'
	| 'payment.reported'
	| 'payment.verified'
	| 'payment.provider_verified'
	| 'payment.partial_recorded'
	| 'payment.not_found'
	| 'payment.reminder_sent'
	| 'payment.received_notification_sent'
	| 'webhook_endpoint.created'
	| 'webhook_endpoint.deleted'
	// §35 marketplace. Publishing puts the marketplace's name on a listing, so
	// every state change is recorded with who made it.
	| 'tour.created'
	| 'tour.updated'
	| 'tour.submitted'
	| 'tour.published'
	| 'tour.rejected'
	| 'tour.unpublished'
	| 'tour.archived'
	| 'tour.deleted'
	| 'tour.media_added'
	| 'tour.media_removed'
	// Reviews. The traveller's words, the operator's answer, the platform's call —
	// each recorded separately so an audit can tell which party did what.
	| 'review.invited'
	| 'review.responded'
	| 'review.publish'
	| 'review.hide'
	| 'review.reject'
	| 'review.restore';

export async function audit(
	tenantId: string | null,
	action: AuditAction,
	actor: AuditActor,
	entity?: { type?: string; id?: string },
	metadata: Record<string, unknown> = {},
	// Pass an open transaction to make the audit row part of the same atomic unit —
	// provisioning does this so a rolled-back tenant leaves no trace of having existed.
	exec?: Executor
): Promise<void> {
	try {
		await (exec ?? db()).insert(schema.auditLogs).values({
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
		// Inside a transaction a failed insert has already poisoned it, so swallowing
		// here would only defer the error to a confusing later statement.
		if (exec) throw err;
	}
}
