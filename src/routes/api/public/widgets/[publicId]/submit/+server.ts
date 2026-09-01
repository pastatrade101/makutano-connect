// Public form submission (§widget security).
//
// The contract that keeps this safe:
//   * the browser presents ONLY the opaque publicId — tenant resolution is server-side
//   * no API key exists anywhere in this path
//   * unknown, disabled, or foreign ids fail identically (404), leaking nothing
//   * per-IP and per-form rate limits, honeypot, size caps, origin allow-list
//   * submissions land through the SAME domain services as the authenticated API,
//     so tenant isolation, matching, notifications and webhooks all apply unchanged
//
// The shape leaves room for Cloudflare Turnstile: a `captchaToken` field is accepted
// and simply ignored until TURNSTILE_SECRET_KEY-style verification is enabled.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import { createBookingRequest } from '$lib/server/booking-requests';
import { findOrCreateCustomer } from '$lib/server/customers';
import { sha256 } from '$lib/server/encryption';
import { AppError, errorResponse, toAppError } from '$lib/server/errors';
import { bumpSubmissionCount, originAllowed, resolvePublicForm, FORM_FIELD_CATALOG } from '$lib/server/forms';
import { createLead } from '$lib/server/leads';
import { log } from '$lib/server/logger';
import { createOrder } from '$lib/server/orders';
import { enforce } from '$lib/server/rate-limit';

const MAX_BODY_BYTES = 32 * 1024;

const submissionSchema = z
	.object({
		// Honeypot: humans never see it; bots that fill it get a fake success.
		hp_company: z.string().max(200).optional(),
		captchaToken: z.string().max(4096).optional(),
		fields: z.record(z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
		items: z
			.array(
				z.object({
					title: z.string().max(300).optional(),
					variant: z.string().max(200).optional().nullable(),
					quantity: z.number().int().min(1).max(999).optional()
				})
			)
			.max(20)
			.optional()
	})
	.strict();

const str = (v: unknown, max = 500): string => String(v ?? '').slice(0, max).trim();
const num = (v: unknown, fallback: number): number => {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, {
		headers: {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'POST, OPTIONS',
			'access-control-allow-headers': 'content-type'
		}
	});

export const POST: RequestHandler = async (event) => {
	const cors = { 'access-control-allow-origin': '*' };
	try {
		const raw = await event.request.text();
		if (raw.length > MAX_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 'Submission too large.');

		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(raw);
		} catch {
			throw new AppError('VALIDATION_ERROR', 'Submission must be valid JSON.');
		}
		const body = submissionSchema.parse(parsedBody);

		// Per-IP gate BEFORE resolution, so a flood against unknown ids is throttled too
		// (the sibling GET config route does the same). The per-form limits below then
		// bound abuse of any single published form.
		const ip = ipHash(event);
		await enforce(`widget-submit:${ip}`, 30, 60);

		const { form, tenant } = await resolvePublicForm(event.params.publicId ?? '');

		if (!originAllowed(form, event.request.headers.get('origin'))) {
			throw new AppError('FORBIDDEN', 'This form cannot be submitted from this website.');
		}

		// Burst + sustained limits, keyed on visitor AND on the form itself.
		await enforce(`widget:${form.publicId}:${ip}`, 5, 120);
		await enforce(`widget:${form.publicId}`, 200, 3600);

		// Honeypot filled → pretend success, create nothing, log for the audit trail.
		if (body.hp_company) {
			log.warn('widget_honeypot_tripped', { publicId: form.publicId });
			return json({ success: true, data: { message: form.successMessage ?? 'Thank you.' } }, { headers: cors });
		}

		// Required-field enforcement from the form's own configuration.
		const enabledKeys = new Set(FORM_FIELD_CATALOG[form.type].filter((f) => form.fields[f.key]?.enabled).map((f) => f.key));
		for (const fieldDef of FORM_FIELD_CATALOG[form.type]) {
			if (form.fields[fieldDef.key]?.enabled && form.fields[fieldDef.key]?.required) {
				const value = body.fields[fieldDef.key];
				if (value === undefined || String(value).trim() === '') {
					throw new AppError('VALIDATION_ERROR', `${fieldDef.label} is required.`, [{ path: fieldDef.key, message: 'Required' }]);
				}
			}
		}
		// Drop anything not enabled on this form — a visitor cannot invent fields.
		const f: Record<string, unknown> = Object.fromEntries(Object.entries(body.fields).filter(([k]) => enabledKeys.has(k)));

		let resultRef: string;
		if (form.type === 'BOOKING' || form.type === 'QUOTE') {
			const { request } = await createBookingRequest(tenant.id, {
				customer: {
					firstName: str(f.firstName, 120) || str(f.name, 120) || 'Visitor',
					lastName: str(f.lastName, 120),
					email: str(f.email, 200) || null,
					phone: str(f.phone, 40) || null,
					whatsappPhone: str(f.phone, 40) || null,
					country: str(f.country, 2).toUpperCase() || null
				},
				source: 'WEBSITE',
				startDate: toIsoDate(f.startDate),
				endDate: toIsoDate(f.endDate),
				adults: num(f.adults, 1) || 1,
				children: num(f.children, 0),
				estimatedTotal: /^\d+(\.\d{1,2})?$/.test(str(f.budget, 20)) ? str(f.budget, 20) : null,
				notes: [str(f.service, 300), str(f.message, 3000)].filter(Boolean).join('\n\n') || null,
				metadata: { form_public_id: form.publicId, form_type: form.type, ...(form.type === 'QUOTE' ? { quote_request: true } : {}) },
				items: str(f.service, 300) ? [{ title: str(f.service, 300) }] : undefined
			});
			resultRef = request.reference;
		} else if (form.type === 'ORDER') {
			const items = buildOrderItems(f);
			const customer = await findOrCreateCustomer(
				tenant.id,
				{
					firstName: str(f.name, 240).split(/\s+/)[0] || 'Customer',
					lastName: str(f.name, 240).split(/\s+/).slice(1).join(' '),
					email: str(f.email, 200) || null,
					phone: str(f.phone, 40) || null,
					whatsappPhone: str(f.phone, 40) || null,
					source: 'WEBSITE'
				},
				tenant.country
			);
			const order = await createOrder(tenant.id, {
				customerId: customer.id,
				status: 'PENDING_CONFIRMATION', // never auto-fulfilled, never auto-paid
				source: 'WEBSITE',
				deliveryMethod: str(f.deliveryMethod, 20).toUpperCase() === 'PICKUP' ? 'PICKUP' : str(f.deliveryMethod, 20) ? 'DELIVERY' : null,
				deliveryLocation: str(f.deliveryLocation, 500) || null,
				notes: str(f.notes, 3000) || null,
				metadata: { form_public_id: form.publicId },
				items
			});
			resultRef = order.orderNumber;
		} else {
			const customer = await findOrCreateCustomer(
				tenant.id,
				{
					firstName: str(f.firstName, 120) || 'Visitor',
					lastName: str(f.lastName, 120),
					email: str(f.email, 200) || null,
					phone: str(f.phone, 40) || null,
					whatsappPhone: str(f.phone, 40) || null,
					source: 'WEBSITE'
				},
				tenant.country
			);
			const lead = await createLead(tenant.id, {
				customerId: customer.id,
				source: 'WEBSITE',
				title: str(f.message, 120) || 'Website enquiry',
				notes: str(f.message, 3000) || null
			});
			resultRef = lead.id;
		}

		await bumpSubmissionCount(form.id);
		await audit(tenant.id, 'form.submission', { type: 'system' }, { type: 'form', id: form.id }, { formType: form.type, reference: resultRef });

		return json(
			{ success: true, data: { message: form.successMessage ?? 'Thank you.', reference: resultRef } },
			{ headers: cors }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			const res = errorResponse(new AppError('VALIDATION_ERROR', 'Submission validation failed.'));
			res.headers.set('access-control-allow-origin', '*');
			return res;
		}
		const appError = toAppError(err);
		if (appError.status >= 500) log.error('widget_submit_failed', { publicId: event.params.publicId, message: (err as Error)?.message });
		const res = errorResponse(appError);
		res.headers.set('access-control-allow-origin', '*');
		return res;
	}
};

function ipHash(event: Parameters<RequestHandler>[0]): string {
	try {
		return sha256(event.getClientAddress()).slice(0, 24);
	} catch {
		return 'unknown';
	}
}

function toIsoDate(v: unknown): string | null {
	const s = String(v ?? '').slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : null;
}

/**
 * Order lines from a submission.
 *
 * Always unpriced: a public form takes what somebody typed, and a member of staff
 * puts a price on it before confirming. A visitor has never been able to set an
 * amount here and still cannot.
 */
function buildOrderItems(f: Record<string, unknown>) {
	const title = str(f.product, 300);
	if (!title) throw new AppError('VALIDATION_ERROR', 'Please tell us what you would like to order.');
	return [
		{
			title,
			variant: str(f.variant, 200) || null,
			quantity: Math.min(999, Math.max(1, num(f.quantity, 1) || 1)),
			unitPrice: '0'
		}
	];
}
