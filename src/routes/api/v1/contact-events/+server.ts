// An integration telling Connect that something happened with a person —
// they subscribed, they consented, they cancelled — where the thing worth having
// afterwards is a contact and a note in the inbox, not a WhatsApp message.
//
// This exists because the alternative integrations reach for is worse: sending
// themselves a WhatsApp message to create a record, which burns template quota and
// puts the business's own number in its own inbox.
//
// What it does, in one call:
//   1. finds or creates the customer by phone — never a duplicate;
//   2. finds or opens their conversation;
//   3. writes the note into it, so the inbox shows it and it is there next month;
//   4. pushes to whoever holds the thread, or to the people who could pick it up.
//
// It cannot send anything to the customer. There is no path from here to Meta.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { handle, idempotencyKeyOf, ok, parseBody, requireApiScope } from '$lib/server/http';
import { withIdempotency } from '$lib/server/idempotency';
import { findOrCreateCustomer } from '$lib/server/customers';
import { findOrCreateConversation, touchConversation } from '$lib/server/conversations';
import { db, schema } from '$lib/server/db';
import { pushToUsers, recipientsForConversation } from '$lib/server/push';
import { normalizePhone } from '$lib/server/phone';
import { AppError } from '$lib/server/errors';

const bodySchema = z.object({
	/** The person this is about. A phone is required — it is how they are matched. */
	phone: z.string().min(6).max(40),
	firstName: z.string().max(120).optional().nullable(),
	lastName: z.string().max(120).optional().nullable(),
	email: z.string().email().max(200).optional().nullable(),
	/** One line, written the way it should read in the inbox. */
	note: z.string().min(1).max(1000),
	/** Shown on the push. Defaults to the person's name. */
	title: z.string().max(120).optional(),
	/** Set false for a quiet record — no phone buzzes, it just appears in the inbox. */
	notify: z.boolean().default(true)
});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'customers:write');
		const body = await parseBody(event, bodySchema);

		const outcome = await withIdempotency(
			{
				tenantId: ctx.tenantId,
				endpoint: 'POST /api/v1/contact-events',
				key: idempotencyKeyOf(event),
				method: 'POST',
				path: event.url.pathname,
				body
			},
			async () => {
				const tenant = event.locals.tenant;
				const phone = normalizePhone(body.phone, tenant?.country);
				if (!phone) throw new AppError('VALIDATION_ERROR', 'A valid phone number is required.');

				const customer = await findOrCreateCustomer(
					ctx.tenantId,
					{
						firstName: body.firstName ?? undefined,
						lastName: body.lastName ?? undefined,
						email: body.email ?? undefined,
						phone: body.phone,
						whatsappPhone: body.phone
					},
					tenant?.country
				);

				const conversation = await findOrCreateConversation({
					tenantId: ctx.tenantId,
					channel: 'WHATSAPP',
					externalId: phone,
					customerId: customer.id
				});

				// Recorded as inbound so it reads as something that arrived, which is
				// what it is: the person acted, and this is Connect being told.
				const [message] = await db()
					.insert(schema.messages)
					.values({
						tenantId: ctx.tenantId,
						conversationId: conversation.id,
						direction: 'INBOUND',
						status: 'DELIVERED',
						type: 'text',
						body: body.note,
						fromAddress: phone,
						deliveredAt: new Date()
					})
					.returning();

				await touchConversation(conversation.id, { incrementUnread: body.notify });

				if (body.notify) {
					const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || `+${phone}`;
					const who = await recipientsForConversation(ctx.tenantId, {
						assignedToUserId: conversation.assignedToUserId,
						visibility: conversation.visibility
					});
					// Never block the caller on a fan-out to staff devices.
					void pushToUsers(ctx.tenantId, who, {
						title: body.title ?? name,
						body: body.note.slice(0, 140),
						data: { type: 'contact_event', conversationId: conversation.id }
					}).catch(() => undefined);
				}

				return {
					status: 201,
					body: {
						customerId: customer.id,
						conversationId: conversation.id,
						messageId: message?.id ?? null
					}
				};
			}
		);

		return ok(outcome.body, undefined, { status: outcome.status });
	});
