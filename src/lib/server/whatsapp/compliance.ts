// WhatsApp policy compliance — the layer entitlements cannot loosen.
//
// Ordering matters and is deliberate:
//
//     tenant active → plan permits → allowance left → COMPLIANCE → send
//
// Everything to the left of COMPLIANCE is commercial and configurable by us. This
// module is not: it encodes Meta's rules, so no plan, no admin override and no
// platform-admin action can switch it off. There is intentionally no bypass flag,
// no "trusted tenant" exemption and no force option anywhere in this file.
//
// What it enforces today:
//   * opt-out — a customer who sent STOP is never messaged again until they opt back in;
//   * the 24-hour customer-service window — free-form text only while it is open;
//   * template gating outside the window — and only templates Meta has APPROVED, which
//     the tenant has enabled.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { AppError } from '../errors';
import { log } from '../logger';
import { normalizePhone } from '../phone';
import type { OutboundContent } from './messages';

/** Meta's customer-service window. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Common opt-out keywords. Matched on the whole trimmed message, case-insensitive. */
const OPT_OUT_WORDS = new Set(['stop', 'unsubscribe', 'cancel', 'end', 'quit', 'simama', 'acha']);
const OPT_IN_WORDS = new Set(['start', 'unstop', 'subscribe', 'anza']);

export function isOptOutMessage(text: string | null | undefined): boolean {
	return OPT_OUT_WORDS.has(String(text ?? '').trim().toLowerCase());
}
export function isOptInMessage(text: string | null | undefined): boolean {
	return OPT_IN_WORDS.has(String(text ?? '').trim().toLowerCase());
}

export function serviceWindowOpen(lastInboundAt: Date | null | undefined): boolean {
	if (!lastInboundAt) return false;
	return Date.now() - new Date(lastInboundAt).getTime() < SERVICE_WINDOW_MS;
}

/**
 * Decide whether this exact message may be sent. Throws WHATSAPP_POLICY_BLOCKED with a
 * reason the agent can act on ("use an approved template"), never a generic failure.
 */
export async function assertSendCompliant(params: {
	tenantId: string;
	to: string;
	content: OutboundContent;
}): Promise<void> {
	const to = normalizePhone(params.to);
	if (!to) throw new AppError('VALIDATION_ERROR', 'A valid recipient phone number is required.');

	const rows = await db()
		.select({
			id: schema.customers.id,
			optedOut: schema.customers.whatsappOptedOut,
			lastInboundAt: schema.customers.lastInboundAt
		})
		.from(schema.customers)
		.where(and(eq(schema.customers.tenantId, params.tenantId), eq(schema.customers.whatsappPhone, to)))
		.limit(1);
	const customer = rows[0];

	// 1. Opt-out beats everything, including templates and any plan.
	if (customer?.optedOut) {
		throw new AppError('WHATSAPP_POLICY_BLOCKED', 'This customer has opted out of WhatsApp messages.', {
			reason: 'OPTED_OUT'
		});
	}

	const windowOpen = serviceWindowOpen(customer?.lastInboundAt);

	// 2. Outside the 24-hour window only an approved template may be sent.
	if (params.content.type !== 'template' && !windowOpen) {
		throw new AppError(
			'WHATSAPP_POLICY_BLOCKED',
			'The 24-hour customer service window has closed — send an approved template instead.',
			{ reason: 'SERVICE_WINDOW_CLOSED' }
		);
	}

	// 3. A template must exist for this tenant, be enabled, and be APPROVED by Meta.
	if (params.content.type === 'template') {
		const name = params.content.templateName;
		const language = params.content.language ?? 'en';
		const templates = await db()
			.select({ status: schema.whatsappTemplates.status, enabled: schema.whatsappTemplates.enabled })
			.from(schema.whatsappTemplates)
			.where(
				and(
					eq(schema.whatsappTemplates.tenantId, params.tenantId),
					eq(schema.whatsappTemplates.name, name),
					eq(schema.whatsappTemplates.language, language)
				)
			)
			.limit(1);
		const template = templates[0];

		// A template Connect has never synced is not proof of anything either way; Meta
		// remains the authority and will reject it. Templates we DO know about must be
		// approved and enabled — that check is ours to make and we make it strictly.
		if (template) {
			if (template.status !== 'APPROVED') {
				throw new AppError('WHATSAPP_POLICY_BLOCKED', `Template "${name}" is ${template.status.toLowerCase()}, not approved by Meta.`, {
					reason: 'TEMPLATE_NOT_APPROVED',
					template: name
				});
			}
			if (!template.enabled) {
				throw new AppError('WHATSAPP_POLICY_BLOCKED', `Template "${name}" is switched off for this account.`, {
					reason: 'TEMPLATE_DISABLED',
					template: name
				});
			}
		} else {
			log.info('template_not_in_registry', { tenantId: params.tenantId, name, language });
		}
	}
}

/* ------------------------------------------------- inbound-side upkeep ---- */

/**
 * Record an inbound message's compliance effects: it re-opens the service window, and
 * STOP/START toggles the opt-out flag. Called from the inbound webhook path.
 */
export async function applyInboundCompliance(params: {
	tenantId: string;
	customerId: string;
	text: string | null;
	receivedAt?: Date;
}): Promise<void> {
	const patch: Partial<typeof schema.customers.$inferInsert> = {
		lastInboundAt: params.receivedAt ?? new Date(),
		updatedAt: new Date()
	};
	if (isOptOutMessage(params.text)) {
		patch.whatsappOptedOut = true;
		patch.whatsappOptedOutAt = new Date();
		log.info('whatsapp_opt_out', { tenantId: params.tenantId, customerId: params.customerId });
	} else if (isOptInMessage(params.text)) {
		patch.whatsappOptedOut = false;
		patch.whatsappOptedOutAt = null;
		log.info('whatsapp_opt_in', { tenantId: params.tenantId, customerId: params.customerId });
	}
	await db()
		.update(schema.customers)
		.set(patch)
		.where(and(eq(schema.customers.id, params.customerId), eq(schema.customers.tenantId, params.tenantId)));
}
