// Template Center engine.
//
// The idea: tenants author templates with NAMED variables ({{customer.first_name}},
// {{order.number}}, …) drawn from one standard registry. Connect converts that to
// Meta's positional {{1}},{{2}} form on submission, and at send time resolves each
// named variable from a context object built off the triggering business event.
//
//   business event ──► mapped, enabled, APPROVED template
//                  ──► variable values from context
//                  ──► tenant's WhatsApp number ──► customer
//
// Session (free-form) messages remain a separate path — this engine exists for
// structured, business-initiated notifications where Meta requires templates.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { AppError } from '../errors';
import { moduleRelevant, type Module, type Workspace } from '$lib/workspace';
import { log } from '../logger';
import { graphRequest } from './client';
import { resolveCredentials } from './connections';
import { queueMessage } from './messages';

/* ------------------------------------------------ standard variables ------ */

export type TemplateContext = {
	customer?: { firstName?: string | null; lastName?: string | null; whatsappPhone?: string | null } | null;
	business?: { name?: string | null } | null;
	order?: {
		number?: string | null;
		total?: string | null;
		currency?: string | null;
		itemsSummary?: string | null;
		deliveryLocation?: string | null;
	} | null;
	booking?: { reference?: string | null; startDate?: string | null; total?: string | null } | null;
	/** Generic transaction descriptor so one template serves bookings, orders and quotes. */
	transaction?: { typeLabel?: string | null; reference?: string | null } | null;
	quotation?: { reference?: string | null; total?: string | null; link?: string | null } | null;
	payment?: {
		amount?: string | null;
		amountDue?: string | null;
		link?: string | null;
		reference?: string | null;
		method?: string | null;
		instructions?: string | null;
	} | null;
};

/** The whole vocabulary a tenant can use. Adding here makes it available everywhere. */
export const TEMPLATE_VARIABLES: Record<string, { label: string; resolve: (ctx: TemplateContext) => string }> = {
	'customer.first_name': { label: 'Customer first name', resolve: (c) => c.customer?.firstName || 'there' },
	'customer.full_name': {
		label: 'Customer full name',
		resolve: (c) => [c.customer?.firstName, c.customer?.lastName].filter(Boolean).join(' ') || 'there'
	},
	'business.name': { label: 'Business name', resolve: (c) => c.business?.name || '' },
	'order.number': { label: 'Order number', resolve: (c) => c.order?.number || '' },
	'order.total': {
		label: 'Order total',
		resolve: (c) => (c.order?.total ? `${c.order.currency ?? ''} ${c.order.total}`.trim() : '')
	},
	'order.items_summary': { label: 'Order items summary', resolve: (c) => c.order?.itemsSummary || '' },
	'delivery.address': { label: 'Delivery address', resolve: (c) => c.order?.deliveryLocation || '' },
	'booking.reference': { label: 'Booking reference', resolve: (c) => c.booking?.reference || '' },
	'booking.start_date': { label: 'Booking start date', resolve: (c) => c.booking?.startDate || '' },
	'quotation.reference': { label: 'Quotation reference', resolve: (c) => c.quotation?.reference || '' },
	'quotation.total': { label: 'Quotation total', resolve: (c) => c.quotation?.total || '' },
	'payment.amount': { label: 'Payment amount', resolve: (c) => c.payment?.amount || '' },
	'payment.amount_due': { label: 'Amount due', resolve: (c) => c.payment?.amountDue || '' },
	'payment.link': { label: 'Payment link', resolve: (c) => c.payment?.link || '' },
	'payment.reference': { label: 'Payment reference', resolve: (c) => c.payment?.reference || '' },
	'payment.method': { label: 'Payment method', resolve: (c) => c.payment?.method || '' },
	'payment.instructions': { label: 'Payment instructions', resolve: (c) => c.payment?.instructions || '' },
	'quotation.link': { label: 'Quotation link', resolve: (c) => c.quotation?.link || '' },
	'transaction.type_label': {
		label: 'Transaction type (booking/order/quotation)',
		resolve: (c) => c.transaction?.typeLabel || ''
	},
	'transaction.reference': { label: 'Transaction reference', resolve: (c) => c.transaction?.reference || '' }
};

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

/** Named body → Meta positional body + the ordered variable list to store. */
export function toPositional(body: string): { text: string; variables: string[] } {
	const variables: string[] = [];
	const text = body.replace(VARIABLE_PATTERN, (_match, name: string) => {
		if (!TEMPLATE_VARIABLES[name]) throw new AppError('VALIDATION_ERROR', `Unknown template variable: {{${name}}}`);
		let index = variables.indexOf(name);
		if (index === -1) {
			variables.push(name);
			index = variables.length - 1;
		}
		return `{{${index + 1}}}`;
	});
	return { text, variables };
}

/** Resolve stored variables against a context, in submission order. */
export function resolveVariables(variables: string[], ctx: TemplateContext): string[] {
	return variables.map((name) => TEMPLATE_VARIABLES[name]?.resolve(ctx) ?? '');
}

/* ------------------------------------------------- events → templates ----- */

export const NOTIFY_EVENTS = [
	'BOOKING_REQUEST_RECEIVED',
	'BOOKING_CONFIRMED',
	'QUOTATION_READY',
	'PAYMENT_REQUESTED',
	'PAYMENT_REMINDER',
	'PAYMENT_RECEIVED',
	'TRIP_REMINDER',
	'ORDER_RECEIVED',
	'ORDER_CONFIRMED',
	'ORDER_READY',
	'ORDER_DISPATCHED',
	'ORDER_DELIVERED',
	// V6 — moments the journeys reach but nobody was told about.
	'QUOTATION_ACCEPTED',
	'QUOTATION_REMINDER',
	'PAYMENT_NOT_FOUND',
	'BOOKING_CANCELLED'
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/**
 * Which module each event belongs to. Payment events are deliberately absent:
 * money is asked for in every workspace, so they are always offered.
 */
const EVENT_MODULE: Partial<Record<NotifyEvent, Module>> = {
	BOOKING_REQUEST_RECEIVED: 'enquiries',
	BOOKING_CONFIRMED: 'bookings',
	BOOKING_CANCELLED: 'bookings',
	TRIP_REMINDER: 'bookings',
	QUOTATION_READY: 'quotations',
	QUOTATION_ACCEPTED: 'quotations',
	QUOTATION_REMINDER: 'quotations',
	ORDER_RECEIVED: 'orders',
	ORDER_CONFIRMED: 'orders',
	ORDER_READY: 'orders',
	ORDER_DISPATCHED: 'orders',
	ORDER_DELIVERED: 'orders'
};

/**
 * The events this kind of business can actually reach.
 *
 * A shop is never going to send TRIP REMINDER, and a business that only pushes
 * notifications through the API has no use for any of them. Offering the full
 * list to everyone makes the mapping look broken — seventeen options, none of
 * which apply — so the list follows the same relevance rule as the rest of the
 * product. Existing mappings are never touched by this; it only decides what is
 * offered next.
 */
export function eventsForWorkspace(workspace: Workspace, keep: Array<string | null> = []): NotifyEvent[] {
	// Anything already mapped stays in the list even when the workspace has moved
	// on. Hiding it would leave a live mapping nobody can see or clear — which is
	// exactly what happened to a tenant whose workspace changed from ORDERS.
	const mapped = new Set(keep.filter(Boolean) as string[]);
	return NOTIFY_EVENTS.filter((event) => {
		if (mapped.has(event)) return true;
		const module = EVENT_MODULE[event];
		return module === undefined || moduleRelevant(workspace, module);
	});
}

/* ------------------------------------------------- authoring lifecycle ---- */

export type TemplateDraftInput = {
	name: string;
	language?: string;
	category?: 'UTILITY' | 'MARKETING';
	headerText?: string | null;
	bodyText: string;
	footerText?: string | null;
	buttons?: Array<{ type: 'QUICK_REPLY' | 'URL'; text: string; url?: string }>;
	eventKey?: NotifyEvent | null;
};

export async function createTemplateDraft(
	tenantId: string,
	input: TemplateDraftInput
): Promise<schema.WhatsappTemplate> {
	const name = input.name
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 512);
	if (!name) throw new AppError('VALIDATION_ERROR', 'Template name is required.');
	const { variables } = toPositional(input.bodyText); // validates variable names early

	const [row] = await db()
		.insert(schema.whatsappTemplates)
		.values({
			tenantId,
			name,
			language: input.language ?? 'en',
			category: input.category ?? 'UTILITY',
			status: 'DRAFT',
			headerText: input.headerText ?? null,
			bodyText: input.bodyText,
			footerText: input.footerText ?? null,
			buttons: (input.buttons ?? []) as Array<Record<string, unknown>>,
			variables,
			eventKey: input.eventKey ?? null,
			components: []
		})
		.onConflictDoNothing()
		.returning();
	if (!row) throw new AppError('CONFLICT', 'A template with this name and language already exists.');
	return row;
}

/** Submit a DRAFT/REJECTED template to Meta for approval. */
export async function submitTemplateToMeta(tenantId: string, templateId: string): Promise<schema.WhatsappTemplate> {
	const rows = await db()
		.select()
		.from(schema.whatsappTemplates)
		.where(and(eq(schema.whatsappTemplates.id, templateId), eq(schema.whatsappTemplates.tenantId, tenantId)))
		.limit(1);
	const template = rows[0];
	if (!template) throw new AppError('NOT_FOUND', 'Template not found.');
	if (template.status !== 'DRAFT' && template.status !== 'REJECTED') {
		throw new AppError('CONFLICT', `A ${template.status} template cannot be submitted.`);
	}
	if (!template.bodyText) throw new AppError('VALIDATION_ERROR', 'The template has no body.');
	// Meta rejects bodies that start or end with a variable (error 2388299) — even a
	// trailing "{{var}}." counts. Fail fast with an explanation instead of Meta's
	// opaque "Invalid parameter".
	const body = template.bodyText.trim();
	if (/^\{\{/.test(body) || /\}\}[\s.,;:!?—-]*$/.test(body)) {
		throw new AppError(
			'VALIDATION_ERROR',
			'WhatsApp requires the message to start and end with words, not a variable — add a short opening or closing sentence.'
		);
	}

	const credentials = await resolveCredentials(tenantId);
	if (!credentials?.wabaId) throw new AppError('WHATSAPP_NOT_CONNECTED', 'Connect a WhatsApp number first.');

	const { text: positionalBody, variables } = toPositional(template.bodyText);
	// Meta requires example values for variables at review time.
	const examples = resolveVariables(variables, {
		customer: { firstName: 'Amina', lastName: 'Juma' },
		business: { name: 'Example Business' },
		order: {
			number: 'ORD-2026-00001',
			total: '250.00',
			currency: 'USD',
			itemsSummary: '2× Item',
			deliveryLocation: 'City centre'
		},
		booking: { reference: 'BK-2026-00001', startDate: '14 Oct 2026', total: '1200.00' },
		quotation: { reference: 'QT-2026-00001', total: '900.00' },
		payment: {
			amount: 'USD 100.00',
			amountDue: 'USD 50.00',
			link: 'https://example.com/pay',
			reference: 'PY-2026-00001',
			method: 'Bank Transfer',
			instructions: 'CRDB Bank · Name: Example Business · Number: 0150000000000'
		},
		transaction: { typeLabel: 'booking', reference: 'BK-2026-00001' }
	}).map((v) => v || 'example');

	const components: Array<Record<string, unknown>> = [];
	if (template.headerText) components.push({ type: 'HEADER', format: 'TEXT', text: template.headerText });
	components.push({
		type: 'BODY',
		text: positionalBody,
		...(variables.length ? { example: { body_text: [examples] } } : {})
	});
	if (template.footerText) components.push({ type: 'FOOTER', text: template.footerText });
	const buttons = (template.buttons ?? []) as Array<{ type: string; text: string; url?: string }>;
	if (buttons.length) {
		components.push({
			type: 'BUTTONS',
			buttons: buttons.map((b) =>
				b.type === 'URL' ? { type: 'URL', text: b.text, url: b.url } : { type: 'QUICK_REPLY', text: b.text }
			)
		});
	}

	const result = await graphRequest<{ id?: string; status?: string }>({
		credentials,
		path: `${credentials.wabaId}/message_templates`,
		method: 'POST',
		body: { name: template.name, language: template.language, category: template.category ?? 'UTILITY', components }
	});

	const metaStatus = String(result.status ?? 'PENDING').toUpperCase();
	const [updated] = await db()
		.update(schema.whatsappTemplates)
		.set({
			metaTemplateId: result.id ?? null,
			status: metaStatus === 'APPROVED' ? 'APPROVED' : 'SUBMITTED',
			variables,
			updatedAt: new Date()
		})
		.where(eq(schema.whatsappTemplates.id, template.id))
		.returning();
	log.info('template_submitted', { tenantId, name: template.name, metaId: result.id, metaStatus });
	return updated;
}

/** Substitute resolved values back into the authored body, for display only. */
export function renderPreview(bodyText: string | null, names: string[], values: string[]): string {
	if (!bodyText) return '';
	let out = bodyText;
	names.forEach((name, i) => {
		// Escape the variable name — dots are regex wildcards, and a stray one would
		// let "order.number" match "orderXnumber".
		const pattern = new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
		out = out.replace(pattern, values[i] ?? '');
	});
	return out.trim();
}

/* ---------------------------------------------------- event dispatch ------ */

/**
 * Send the tenant's mapped template for a business event, if one is mapped, enabled
 * and APPROVED. Quietly does nothing otherwise — notification wiring must never make
 * the underlying business operation fail or block.
 */
export async function sendEventTemplate(
	tenantId: string,
	event: NotifyEvent,
	to: string | null | undefined,
	ctx: TemplateContext,
	dedupeKey: string,
	options: { quickReplyPayloads?: string[] } = {}
): Promise<schema.Message | null> {
	try {
		if (!to) return null;
		const rows = await db()
			.select()
			.from(schema.whatsappTemplates)
			.where(
				and(
					eq(schema.whatsappTemplates.tenantId, tenantId),
					eq(schema.whatsappTemplates.eventKey, event),
					eq(schema.whatsappTemplates.status, 'APPROVED'),
					eq(schema.whatsappTemplates.enabled, true)
				)
			)
			.limit(1);
		const template = rows[0];
		if (!template) return null;

		const names = (template.variables ?? []) as string[];
		const values = resolveVariables(names, ctx);
		// Meta rejects empty body parameters outright; a skipped send that shows up in
		// the log beats a guaranteed FAILED message in the customer's thread. Name the
		// empty variables: "no message went out" is otherwise invisible to everyone.
		const missing = names.filter((_, i) => !values[i] || !values[i].trim());
		if (missing.length) {
			log.warn('template_send_skipped', {
				tenantId,
				event,
				template: template.name,
				reason: 'missing_variable_value',
				missing
			});
			return null;
		}
		const components: Array<Record<string, unknown>> = values.length
			? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
			: [];
		const quickReplyButtons = ((template.buttons ?? []) as Array<{ type?: string }>).filter(
			(button) => button.type === 'QUICK_REPLY'
		);
		for (let index = 0; index < quickReplyButtons.length; index += 1) {
			const payload = options.quickReplyPayloads?.[index];
			if (!payload) continue;
			components.push({
				type: 'button',
				sub_type: 'quick_reply',
				index: String(index),
				parameters: [{ type: 'payload', payload }]
			});
		}
		return await queueMessage({
			tenantId,
			to,
			dedupeKey,
			content: {
				type: 'template',
				// Staff should read what the customer read, not "[template:order_ready]".
				preview: renderPreview(template.bodyText, names, values),
				templateName: template.name,
				language: template.language,
				components: components.length ? components : undefined
			}
		});
	} catch (err) {
		log.warn('event_template_send_failed', { tenantId, event, error: (err as Error)?.message });
		return null;
	}
}
