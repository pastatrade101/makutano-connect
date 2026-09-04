// Notification fan-out (§20). One table, many channels; delivery happens in a job so a
// slow provider never blocks a booking from being created.
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { enqueue } from './jobs/queue';
import { log } from './logger';
import { queueMessage } from './whatsapp/messages';
import { resolveCredentials } from './whatsapp/connections';

export type NotifyParams = {
	tenantId: string;
	channel: schema.Notification['channel'];
	event: string;
	title?: string | null;
	body?: string | null;
	recipientUserId?: string | null;
	recipientAddress?: string | null;
	entityType?: string | null;
	entityId?: string | null;
	payload?: Record<string, unknown>;
};

export async function notify(params: NotifyParams): Promise<schema.Notification> {
	const [row] = await db()
		.insert(schema.notifications)
		.values({
			tenantId: params.tenantId,
			channel: params.channel,
			event: params.event,
			title: params.title ?? null,
			body: params.body ?? null,
			recipientUserId: params.recipientUserId ?? null,
			recipientAddress: params.recipientAddress ?? null,
			entityType: params.entityType ?? null,
			entityId: params.entityId ?? null,
			payload: params.payload ?? {}
		})
		.returning();

	// IN_APP is delivered by simply existing; everything else needs a transport.
	if (params.channel === 'IN_APP') {
		await db()
			.update(schema.notifications)
			.set({ status: 'SENT', sentAt: new Date() })
			.where(eq(schema.notifications.id, row.id));
	} else {
		await enqueue('notification.deliver', { notificationId: row.id }, { tenantId: params.tenantId });
	}
	return row;
}

export async function deliverNotification(notificationId: string): Promise<void> {
	const rows = await db()
		.select()
		.from(schema.notifications)
		.where(eq(schema.notifications.id, notificationId))
		.limit(1);
	const notification = rows[0];
	if (!notification || notification.status === 'SENT') return;

	try {
		switch (notification.channel) {
			case 'WHATSAPP': {
				if (!notification.recipientAddress) throw new Error('No recipient address for WhatsApp notification.');
				const credentials = await resolveCredentials(notification.tenantId);
				if (!credentials) {
					// Not an error worth retrying: the tenant simply has no WhatsApp today.
					await markFailed(notificationId, 'WhatsApp is not connected for this account.');
					return;
				}
				await queueMessage({
					tenantId: notification.tenantId,
					to: notification.recipientAddress,
					content: { type: 'text', text: notification.body ?? notification.title ?? '' },
					dedupeKey: `notification:${notification.id}`
				});
				break;
			}
			case 'EMAIL':
				// `text`, not `body`: the email.send handler reads html ?? text, so a
				// payload keyed `body` was dropped and every EMAIL notification would
				// have been delivered blank. Nothing had exercised this path yet.
				await enqueue(
					'email.send',
					{
						to: notification.recipientAddress,
						subject: notification.title,
						text: notification.body
					},
					{ tenantId: notification.tenantId }
				);
				break;
			case 'SMS':
			case 'WEBHOOK':
			case 'IN_APP':
				break;
		}
		await db()
			.update(schema.notifications)
			.set({ status: 'SENT', sentAt: new Date() })
			.where(eq(schema.notifications.id, notificationId));
	} catch (err) {
		log.error('notification_delivery_failed', { notificationId, error: (err as Error)?.message });
		await markFailed(notificationId, (err as Error)?.message ?? 'Delivery failed');
		throw err;
	}
}

async function markFailed(notificationId: string, message: string): Promise<void> {
	await db()
		.update(schema.notifications)
		.set({ status: 'FAILED', errorMessage: message.slice(0, 500) })
		.where(eq(schema.notifications.id, notificationId));
}
