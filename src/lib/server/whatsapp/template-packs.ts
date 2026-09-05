// Canonical, VERSIONED template packs (§template-pack brief).
//
// The kit is central and reusable; Meta approval is not — every tenant's WABA needs
// its own approved copy. applyTemplatePack() drafts the workspace-relevant set with
// event mappings and variables pre-wired, submits each to the tenant's WABA, and
// records the pack version on the tenant. When Meta approves, the sync flips the
// status and the notification goes live with no further configuration.
//
// Rules:
//  - Workspace decides WHICH templates are submitted (a tour operator's WABA never
//    receives order templates). Shared templates (payments) are defined once.
//  - A name that already exists for the tenant is NEVER touched — an approved or
//    customized template always wins over the pack.
//  - The pack version lands in tenant settings, so V2 can later target exactly the
//    tenants still on V1 instead of silently overwriting anyone.
import { eq } from 'drizzle-orm';
import { audit } from '../audit';
import { db, schema } from '../db';
import { getTenantById } from '../tenants';
import { moduleRelevant, normalizeWorkspace, type Workspace } from '$lib/workspace';
import { createTemplateDraft, submitTemplateToMeta, type NotifyEvent } from './template-engine';
import { resolveCredentials } from './connections';
import { log } from '../logger';

export const PACK_VERSION = 8;

type PackTemplate = {
	name: string;
	eventKey: NotifyEvent;
	bodyText: string;
	/** Which workspace module makes this template relevant; 'always' ships to everyone. */
	module: 'enquiries' | 'bookings' | 'orders' | 'quotations' | 'always';
	buttons?: Array<{ type: 'QUICK_REPLY'; text: string }>;
};

/**
 * The proven bodies — the same set live on the first production tenant. Named
 * variables only; toPositional() turns them into Meta's {{1}}…{{n}} at submit time.
 * quotation_ready is deliberately link-free in the pack: not every tenant has a
 * public quote page, and a template that always sends beats one that skips.
 */
// crew_invite is deliberately NOT here. Meta rejects it as INCORRECT_CATEGORY:
// handing somebody app access is not tied to a transaction, so it reads as
// MARKETING, and MARKETING needs opt-in and per-user limits nobody wants on a
// one-off message to their own driver. The portal already shows the invite link
// with Copy and a wa.me button, which needs no approval and lets the owner send
// it from their own WhatsApp. Shipping a template that reliably fails review
// only leaves every tenant a "Needs changes" row they cannot act on.
//
// PACK_VERSION is deliberately NOT bumped for the removal: tenants on 8 have
// nothing new to fetch, and bumping would show them an upgrade button with
// nothing behind it.
const PACK: PackTemplate[] = [
	{
		name: 'booking_request_received',
		eventKey: 'BOOKING_REQUEST_RECEIVED',
		module: 'enquiries',
		bodyText:
			"Hello {{customer.first_name}}, thanks for your enquiry with {{business.name}}. We've received it (reference {{booking.reference}}) and will reply here shortly."
	},
	{
		name: 'booking_confirmed',
		eventKey: 'BOOKING_CONFIRMED',
		module: 'bookings',
		bodyText:
			'Hello {{customer.first_name}}, your booking is confirmed. Reference: {{booking.reference}}. We will follow up with your itinerary and joining instructions.'
	},
	{
		// The traveller's booking changed after they confirmed it. UTILITY, and
		// the variable ORDER matters: a tenant site sending this through the
		// relay passes [first name, reference, change] positionally, and
		// toPositional numbers them by first appearance.
		name: 'booking_amended',
		eventKey: 'BOOKING_AMENDED',
		module: 'bookings',
		bodyText:
			"Hello {{customer.first_name}}, there's an update to your booking {{booking.reference}}. {{amendment.summary}} Everything else about your trip stays as arranged. Reply here if you have any questions."
	},
	{
		name: 'trip_reminder',
		eventKey: 'TRIP_REMINDER',
		module: 'bookings',
		bodyText:
			'Hi {{customer.first_name}}, your trip with {{business.name}} starts on {{booking.start_date}}. Reply here if you need anything before then.'
	},
	{
		name: 'quotation_ready',
		eventKey: 'QUOTATION_READY',
		module: 'quotations',
		bodyText:
			'Hello {{customer.first_name}}, your quotation {{quotation.reference}} is ready — total {{quotation.total}}. Reply here to accept it or ask us anything.'
	},
	{
		name: 'order_received',
		eventKey: 'ORDER_RECEIVED',
		module: 'orders',
		bodyText:
			"Hi {{customer.first_name}}, we've received your order {{order.number}} ({{order.items_summary}}). We'll confirm shortly."
	},
	{
		name: 'order_confirmed',
		eventKey: 'ORDER_CONFIRMED',
		module: 'orders',
		bodyText:
			"Hi {{customer.first_name}}, your order {{order.number}} is confirmed. Total: {{order.total}}. Thank you for shopping with {{business.name}} — we'll keep you updated."
	},
	{
		name: 'order_ready',
		eventKey: 'ORDER_READY',
		module: 'orders',
		bodyText:
			'Hi {{customer.first_name}}, your order {{order.number}} is ready for collection at {{business.name}}. Please contact us if you need any assistance.'
	},
	{
		name: 'order_dispatched',
		eventKey: 'ORDER_DISPATCHED',
		module: 'orders',
		bodyText:
			'Hi {{customer.first_name}}, your order {{order.number}} has been dispatched and is on its way. We will let you know as soon as it reaches {{delivery.address}}.'
	},
	{
		name: 'order_delivered',
		eventKey: 'ORDER_DELIVERED',
		module: 'orders',
		bodyText:
			"Hi {{customer.first_name}}, your order {{order.number}} has been delivered. Thank you for choosing {{business.name}} — reply here if anything isn't right."
	},
	{
		// V2: the actionable request — how to pay + one-tap customer response. One
		// generic template serves bookings, orders and quotations via transaction.*.
		name: 'payment_request',
		eventKey: 'PAYMENT_REQUESTED',
		module: 'always',
		bodyText:
			'Hi {{customer.first_name}}, {{payment.amount_due}} is due for your {{transaction.type_label}} with reference {{transaction.reference}}. Pay by {{payment.method}} using these details: {{payment.instructions}}. Quote reference {{payment.reference}} and tap I have paid once done.',
		buttons: [
			{ type: 'QUICK_REPLY', text: 'I have paid' },
			{ type: 'QUICK_REPLY', text: 'Need help' }
		]
	},
	{
		// V6: the quote is agreed — say so, and say what happens next, so the traveller
		// is not left wondering whether their "yes" arrived.
		name: 'quotation_accepted',
		eventKey: 'QUOTATION_ACCEPTED',
		module: 'quotations',
		bodyText:
			'Thank you {{customer.first_name}} — your quotation {{quotation.reference}} is accepted and we are preparing your booking. We will confirm the details here shortly.'
	},
	{
		// V6: an unanswered quote is the most common place a sale goes quiet.
		name: 'quotation_reminder',
		eventKey: 'QUOTATION_REMINDER',
		module: 'quotations',
		bodyText:
			'Hi {{customer.first_name}}, just checking in on quotation {{quotation.reference}} for {{quotation.total}}. Reply here to accept it, ask for changes, or tell us it is no longer needed.',
		buttons: [
			{ type: 'QUICK_REPLY', text: 'Accept quotation' },
			{ type: 'QUICK_REPLY', text: 'I have a question' }
		]
	},
	{
		// V6: staff checked and the money is not there. Saying nothing leaves the
		// customer believing they have paid.
		name: 'payment_not_found',
		eventKey: 'PAYMENT_NOT_FOUND',
		module: 'always',
		bodyText:
			'Hi {{customer.first_name}}, we could not find your payment of {{payment.amount_due}} for reference {{transaction.reference}} yet. Please check the details and send us the confirmation message, and we will look again.',
		buttons: [{ type: 'QUICK_REPLY', text: 'Send proof' }]
	},
	{
		// V6: a cancelled booking currently notifies nobody.
		name: 'booking_cancelled',
		eventKey: 'BOOKING_CANCELLED',
		module: 'bookings',
		bodyText:
			'Hello {{customer.first_name}}, your booking {{booking.reference}} with {{business.name}} has been cancelled. Reply here if this was not expected and we will look into it.'
	},
	{
		name: 'payment_received',
		eventKey: 'PAYMENT_RECEIVED',
		module: 'always',
		bodyText:
			"Thank you {{customer.first_name}} — we've received your payment of {{payment.amount}}. Your payment reference is {{payment.reference}}. We appreciate your business."
	},
	{
		name: 'payment_reminder',
		eventKey: 'PAYMENT_REMINDER',
		module: 'always',
		bodyText:
			'Hi {{customer.first_name}}, a balance of {{payment.amount_due}} is still due for your {{transaction.type_label}} with reference {{transaction.reference}}. Pay by {{payment.method}} using these details: {{payment.instructions}}. Quote reference {{payment.reference}} when paying.',
		buttons: [
			{ type: 'QUICK_REPLY', text: 'I have paid' },
			{ type: 'QUICK_REPLY', text: 'Need help' }
		]
	}
];

/**
 * The pack entry we ship under a given Meta template name, if any.
 *
 * Meta has no idea what our domain events are, so a template that arrives through
 * a plain sync carries no event mapping. A tenant whose templates were created
 * outside the pack therefore ends up with a screen full of APPROVED templates and
 * nothing wired to any of them — every event falls back to free text, which Meta
 * refuses outside the 24-hour window. Matching on the name we submitted in the
 * first place is what reconnects them.
 */
export function packEntryByEvent(event: NotifyEvent): PackTemplate | null {
	return PACK.find((t) => t.eventKey === event) ?? null;
}

export function packEntryByName(name: string): PackTemplate | null {
	return PACK.find((t) => t.name === name) ?? null;
}

/** The subset of the pack a given workspace should submit — deduped by definition. */
export function packForWorkspace(workspace: Workspace): PackTemplate[] {
	return PACK.filter((t) => t.module === 'always' || moduleRelevant(workspace, t.module));
}

export type PackState = {
	version: number | null;
	appliedAt: string | null;
	/** The WABA the pack was submitted to. Null for packs applied before this was recorded. */
	wabaId: string | null;
};

export function packState(settings: Record<string, unknown> | null | undefined): PackState {
	const raw = (settings?.templatePack ?? null) as {
		version?: number;
		appliedAt?: string;
		wabaId?: string;
	} | null;
	return { version: raw?.version ?? null, appliedAt: raw?.appliedAt ?? null, wabaId: raw?.wabaId ?? null };
}

/**
 * Does this tenant still need the pack submitting?
 *
 * The version alone was the whole test, and it stranded the first tenant that
 * moved WABA: templates live on a WABA, so reconnecting to a new one left them
 * marked "version 8 applied" with ZERO templates on the number they now send
 * from — and because the page reads that mark, it offered no button at all. An
 * empty Template Center, a "Sync from Meta" that correctly returns nothing, and
 * no way forward.
 */
export function packNeedsSetup(input: {
	pack: PackState;
	templateCount: number;
	liveWabaId: string | null;
}): boolean {
	if (!input.pack.version || input.pack.version < PACK_VERSION) return true;
	if (input.pack.wabaId && input.liveWabaId && input.pack.wabaId !== input.liveWabaId) return true;
	// Packs applied before wabaId was recorded have no WABA to compare, so fall
	// back to the plainest fact available: nothing to send with means not set up.
	return input.templateCount === 0;
}

export type ApplyResult = {
	submitted: string[];
	skippedExisting: string[];
	failed: Array<{ name: string; reason: string }>;
	packVersion: number;
};

/**
 * Draft + submit the workspace-relevant pack to the tenant's WABA. Idempotent and
 * conservative: any template name the tenant already has (approved, customized,
 * pending — anything) is left completely alone.
 */
export async function applyTemplatePack(
	tenantId: string,
	actor: { userId?: string | null } = {},
	options: { submit?: boolean } = {}
): Promise<ApplyResult> {
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new Error('Tenant not found.');
	const workspace = normalizeWorkspace((tenant.settings as Record<string, unknown>)?.capabilities);
	const wanted = packForWorkspace(workspace);
	const submit = options.submit ?? true;

	const existing = await db()
		.select({ name: schema.whatsappTemplates.name })
		.from(schema.whatsappTemplates)
		.where(eq(schema.whatsappTemplates.tenantId, tenantId));
	const existingNames = new Set(existing.map((t) => t.name));

	// Submission needs a WABA; drafting does not. With no connection we still create
	// the drafts so the Template Center shows what WILL be submitted after connecting.
	const credentials = submit ? await resolveCredentials(tenantId) : null;
	const canSubmit = submit && !!credentials?.wabaId;

	const result: ApplyResult = { submitted: [], skippedExisting: [], failed: [], packVersion: PACK_VERSION };

	for (const item of wanted) {
		if (existingNames.has(item.name)) {
			result.skippedExisting.push(item.name);
			continue;
		}
		try {
			const draft = await createTemplateDraft(tenantId, {
				name: item.name,
				bodyText: item.bodyText,
				category: 'UTILITY',
				eventKey: item.eventKey,
				buttons: item.buttons
			});
			if (canSubmit) {
				await submitTemplateToMeta(tenantId, draft.id);
				result.submitted.push(item.name);
			} else {
				result.failed.push({ name: item.name, reason: 'drafted only — WhatsApp not connected' });
			}
		} catch (err) {
			result.failed.push({ name: item.name, reason: (err as Error).message });
			log.warn('template_pack_item_failed', { tenantId, name: item.name, error: (err as Error).message });
		}
	}

	// Record the version even on partial success: skipped-existing means the tenant
	// intentionally has their own copy, which counts as covered.
	await db()
		.update(schema.tenants)
		.set({
			// Merge in JS and let drizzle serialize the jsonb column — a raw
			// ${...}::jsonb parameter double-encodes (see the workspace incident).
			settings: {
				...((tenant.settings as Record<string, unknown>) ?? {}),
				templatePack: {
					version: PACK_VERSION,
					appliedAt: new Date().toISOString(),
					workspace,
					// Which WABA these were submitted to — the difference between "set up"
					// and "set up somewhere this tenant no longer sends from".
					wabaId: credentials?.wabaId ?? null
				}
			},
			updatedAt: new Date()
		})
		.where(eq(schema.tenants.id, tenantId));

	await audit(
		tenantId,
		'tenant.updated',
		{ type: 'user', userId: actor.userId },
		{ type: 'tenant', id: tenantId },
		{
			templatePack: {
				version: PACK_VERSION,
				workspace,
				submitted: result.submitted,
				skippedExisting: result.skippedExisting,
				failed: result.failed.map((f) => f.name)
			}
		}
	);
	log.info('template_pack_applied', {
		tenantId,
		workspace,
		...{ submitted: result.submitted.length, skipped: result.skippedExisting.length, failed: result.failed.length }
	});
	return result;
}
