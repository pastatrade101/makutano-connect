// Accepting a quotation, from the traveller's own page.
//
// The public quote page used to "accept" with a mailto: link. That took the
// traveller out of the page and into an email client, asked them to send a
// message, and left a human to press Accept in the portal afterwards. Everything
// downstream of acceptance — the booking, its confirmation, the traveller's
// QUOTATION_ACCEPTED and BOOKING_CONFIRMED messages — already existed and simply
// never ran, because nothing public could reach acceptQuotation().
//
// The safety contract is the GET's, unchanged: the 40-character token IS the
// credential, tenant resolution is server-side, and an unknown, withdrawn or
// draft quotation answers exactly like a wrong token. What is added here is a
// tighter rate limit, because this endpoint writes.
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { notify } from '$lib/server/notifications';
import { handlePublic, preflight, publicJson } from '$lib/server/public-api';
import { acceptQuotation } from '$lib/server/quotations';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 8 * 1024;

const bodySchema = z
	.object({
		// Honeypot, same convention as the widget submit route: humans never see it.
		hp_company: z.string().max(200).optional(),
		// Everything the traveller adds is optional. The point of the form is that
		// saying yes is one click and the extra detail is genuinely extra.
		note: z.string().trim().max(2000).optional().nullable()
	})
	.strict();

export const OPTIONS: RequestHandler = async () => preflight();

export const POST: RequestHandler = async (event) =>
	// Ten a minute. The GET allows thirty because reading a quote you hold the
	// link to is normal; accepting the same one eleven times in a minute is not.
	handlePublic(event, { scope: 'pub-quote-accept', limit: 10 }, async () => {
		const token = event.params.token ?? '';
		if (!/^[a-f0-9]{20,80}$/.test(token)) throw new AppError('NOT_FOUND', 'That quote could not be found.');

		const raw = await event.request.text();
		if (raw.length > MAX_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 'That message is too long.');
		let parsed: z.infer<typeof bodySchema>;
		try {
			parsed = bodySchema.parse(raw ? JSON.parse(raw) : {});
		} catch {
			throw new AppError('VALIDATION_ERROR', 'That request could not be read.');
		}

		const [row] = await db()
			.select({
				id: schema.quotations.id,
				tenantId: schema.quotations.tenantId,
				reference: schema.quotations.reference,
				status: schema.quotations.status,
				currency: schema.quotations.currency,
				total: schema.quotations.total,
				metadata: schema.quotations.metadata,
				convertedBookingId: schema.quotations.convertedBookingId,
				customerFirstName: schema.customers.firstName,
				customerLastName: schema.customers.lastName
			})
			.from(schema.quotations)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.quotations.customerId))
			.where(and(eq(schema.quotations.publicToken, token), isNull(schema.quotations.deletedAt)))
			.limit(1);

		if (!row || row.status === 'DRAFT') throw new AppError('NOT_FOUND', 'That quote could not be found.');

		// A bot that filled the hidden field gets the same answer a person would, and
		// nothing happens. Telling it apart is the point of not telling it apart.
		if (parsed.hp_company) return publicJson({ accepted: true, alreadyAccepted: false }, 'no-store');

		/*
		 * Coming back to a link you already used is ORDINARY.
		 *
		 * People re-open the message, or press the button twice on a slow connection.
		 * That is not an error and must not read like one: answer 200 with the state,
		 * and let the page say "you accepted this already". acceptQuotation is itself
		 * idempotent on CONVERTED, but returning early keeps the second visit from
		 * re-sending the traveller's confirmation messages.
		 */
		if (row.status === 'CONVERTED') {
			return publicJson({ accepted: true, alreadyAccepted: true, reference: row.reference }, 'no-store');
		}

		const { booking } = await acceptQuotation(row.tenantId, row.id, {});

		// Kept on the quotation rather than the booking: it is what the traveller said
		// WHEN ACCEPTING, and it should stay attached to the thing they accepted even
		// if the booking is later rebuilt.
		if (parsed.note) {
			await db()
				.update(schema.quotations)
				.set({
					metadata: { ...((row.metadata ?? {}) as Record<string, unknown>), acceptanceNote: parsed.note },
					updatedAt: new Date()
				})
				.where(eq(schema.quotations.id, row.id));
		}

		/*
		 * Tell the OPERATOR, by email.
		 *
		 * acceptQuotation already messages the traveller — QUOTATION_ACCEPTED, and
		 * BOOKING_CONFIRMED once the booking confirms. Nobody told the operator. Under
		 * the old mailto flow the traveller's own email WAS the notification; removing
		 * it would have made the sale silent, which is the one notification in this
		 * product that costs real money to miss.
		 *
		 * Best effort: a mail provider having a bad day must never undo an acceptance
		 * that has already created a confirmed booking.
		 */
		try {
			const who = `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || 'The traveller';
			const owners = await db()
				.select({ email: schema.users.email })
				.from(schema.tenantMemberships)
				.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
				.where(
					and(
						eq(schema.tenantMemberships.tenantId, row.tenantId),
						inArray(schema.tenantMemberships.role, ['OWNER', 'ADMIN']),
						isNull(schema.tenantMemberships.disabledAt)
					)
				);

			const lines = [
				`${who} accepted quotation ${row.reference}.`,
				`Value: ${row.currency} ${row.total}`,
				`Booking: ${booking.bookingReference}`,
				parsed.note ? '' : null,
				parsed.note ? 'They added:' : null,
				parsed.note ?? null,
				'',
				'The booking is already confirmed in Connect. Open it to arrange payment.'
			].filter((line) => line !== null) as string[];

			await notify({
				tenantId: row.tenantId,
				channel: 'IN_APP',
				event: 'quotation.accepted',
				title: `${who} accepted ${row.reference}`,
				body: `${row.currency} ${row.total} · booking ${booking.bookingReference}`,
				entityType: 'quotation',
				entityId: row.id
			});

			for (const owner of owners) {
				if (!owner.email) continue;
				await notify({
					tenantId: row.tenantId,
					channel: 'EMAIL',
					event: 'quotation.accepted',
					title: `Quote accepted — ${row.reference} · ${who}`,
					body: lines.join('\n'),
					recipientAddress: owner.email,
					entityType: 'quotation',
					entityId: row.id
				});
			}
		} catch (err) {
			log.warn('quotation_accept_notify_failed', {
				quotationId: row.id,
				error: (err as Error)?.message
			});
		}

		return publicJson(
			{ accepted: true, alreadyAccepted: false, reference: row.reference, bookingReference: booking.bookingReference },
			'no-store'
		);
	});
