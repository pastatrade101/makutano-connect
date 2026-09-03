// Hosted public forms and embeddable widgets — the no-code integration layer.
//
// A form is CONFIGURATION, not an engine: submissions are translated into calls to
// the existing domain services (createBookingRequest, createOrder, createLead), so a
// no-code tenant and an API tenant produce identical records.
//
// The browser only ever sees the form's opaque publicId. Tenant resolution happens
// server-side from that id; nothing a visitor sends can choose a tenant, and no API
// key is involved anywhere in the public path.
import { and, count, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { randomToken } from './encryption';
import { AppError } from './errors';
import { assertAllowed, assertWithinCount } from './entitlements';

export type FormType = schema.Form['type'];

/** Per-type field vocabulary. Keys double as payload keys on submission. */
export const FORM_FIELD_CATALOG: Record<FormType, Array<{ key: string; label: string; defaultEnabled: boolean; defaultRequired: boolean }>> = {
	BOOKING: [
		{ key: 'firstName', label: 'First name', defaultEnabled: true, defaultRequired: true },
		{ key: 'lastName', label: 'Last name', defaultEnabled: true, defaultRequired: false },
		{ key: 'email', label: 'Email', defaultEnabled: true, defaultRequired: false },
		{ key: 'phone', label: 'WhatsApp / phone', defaultEnabled: true, defaultRequired: true },
		{ key: 'country', label: 'Country', defaultEnabled: false, defaultRequired: false },
		{ key: 'service', label: 'Service / tour', defaultEnabled: true, defaultRequired: false },
		{ key: 'startDate', label: 'Start / travel date', defaultEnabled: true, defaultRequired: false },
		{ key: 'endDate', label: 'End date', defaultEnabled: false, defaultRequired: false },
		{ key: 'adults', label: 'Adults', defaultEnabled: true, defaultRequired: false },
		{ key: 'children', label: 'Children', defaultEnabled: true, defaultRequired: false },
		{ key: 'budget', label: 'Budget', defaultEnabled: false, defaultRequired: false },
		{ key: 'message', label: 'Message / notes', defaultEnabled: true, defaultRequired: false }
	],
	ORDER: [
		{ key: 'name', label: 'Customer name', defaultEnabled: true, defaultRequired: true },
		{ key: 'phone', label: 'WhatsApp / phone', defaultEnabled: true, defaultRequired: true },
		{ key: 'email', label: 'Email', defaultEnabled: true, defaultRequired: false },
		{ key: 'product', label: 'Product', defaultEnabled: true, defaultRequired: true },
		{ key: 'variant', label: 'Variant / size / colour', defaultEnabled: true, defaultRequired: false },
		{ key: 'quantity', label: 'Quantity', defaultEnabled: true, defaultRequired: false },
		{ key: 'deliveryMethod', label: 'Delivery or pickup', defaultEnabled: true, defaultRequired: false },
		{ key: 'deliveryLocation', label: 'Delivery location / address', defaultEnabled: true, defaultRequired: false },
		{ key: 'notes', label: 'Notes', defaultEnabled: true, defaultRequired: false }
	],
	QUOTE: [
		{ key: 'firstName', label: 'First name', defaultEnabled: true, defaultRequired: true },
		{ key: 'lastName', label: 'Last name', defaultEnabled: true, defaultRequired: false },
		{ key: 'email', label: 'Email', defaultEnabled: true, defaultRequired: false },
		{ key: 'phone', label: 'WhatsApp / phone', defaultEnabled: true, defaultRequired: true },
		{ key: 'service', label: 'What do you need quoted?', defaultEnabled: true, defaultRequired: true },
		{ key: 'message', label: 'Details', defaultEnabled: true, defaultRequired: false }
	],
	LEAD: [
		{ key: 'firstName', label: 'First name', defaultEnabled: true, defaultRequired: true },
		{ key: 'lastName', label: 'Last name', defaultEnabled: true, defaultRequired: false },
		{ key: 'email', label: 'Email', defaultEnabled: true, defaultRequired: false },
		{ key: 'phone', label: 'WhatsApp / phone', defaultEnabled: true, defaultRequired: false },
		{ key: 'message', label: 'Message', defaultEnabled: true, defaultRequired: true }
	]
};

export function defaultFieldsFor(type: FormType): Record<string, { enabled: boolean; required: boolean }> {
	return Object.fromEntries(
		FORM_FIELD_CATALOG[type].map((f) => [f.key, { enabled: f.defaultEnabled, required: f.defaultRequired }])
	);
}

const DEFAULT_COPY: Record<FormType, { heading: string; cta: string; success: string }> = {
	BOOKING: { heading: 'Book with us', cta: 'Send enquiry', success: 'Thank you — we have received your enquiry and will be in touch shortly.' },
	ORDER: { heading: 'Place an order', cta: 'Place order', success: 'Thank you — your order has been received and we will confirm it shortly.' },
	QUOTE: { heading: 'Request a quote', cta: 'Request quote', success: 'Thank you — we will prepare your quotation and get back to you.' },
	LEAD: { heading: 'Get in touch', cta: 'Send message', success: 'Thank you — we have received your message.' }
};

export async function createForm(tenantId: string, input: { type: FormType; name: string }): Promise<schema.Form> {
	await assertAllowed(tenantId, { feature: 'forms.hostedEnabled' });
	const [{ value: existing }] = await db()
		.select({ value: count() })
		.from(schema.forms)
		.where(eq(schema.forms.tenantId, tenantId));
	await assertWithinCount(tenantId, 'forms.maxForms', Number(existing));
	const copy = DEFAULT_COPY[input.type];
	const [row] = await db()
		.insert(schema.forms)
		.values({
			tenantId,
			publicId: `wf_${randomToken(18)}`,
			type: input.type,
			name: input.name,
			heading: copy.heading,
			ctaText: copy.cta,
			successMessage: copy.success,
			fields: defaultFieldsFor(input.type)
		})
		.returning();
	return row;
}

export async function getForm(tenantId: string, id: string): Promise<schema.Form> {
	const rows = await db()
		.select()
		.from(schema.forms)
		.where(and(eq(schema.forms.id, id), eq(schema.forms.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Form could not be found.');
	return rows[0];
}

export async function listForms(tenantId: string): Promise<schema.Form[]> {
	return db().select().from(schema.forms).where(eq(schema.forms.tenantId, tenantId)).orderBy(schema.forms.createdAt);
}

export type FormPatch = Partial<{
	name: string;
	heading: string | null;
	description: string | null;
	ctaText: string | null;
	successMessage: string | null;
	fields: Record<string, { enabled: boolean; required: boolean }>;
	allowedOrigins: string[];
	branding: Record<string, unknown>;
	isActive: boolean;
}>;

export async function updateForm(tenantId: string, id: string, patch: FormPatch): Promise<schema.Form> {
	const form = await getForm(tenantId, id);
	// Only known field keys for this form's type survive — a stray key cannot smuggle
	// arbitrary structure into the public config.
	let fields = patch.fields;
	if (fields) {
		const known = new Set(FORM_FIELD_CATALOG[form.type].map((f) => f.key));
		fields = Object.fromEntries(
			Object.entries(fields)
				.filter(([k]) => known.has(k))
				.map(([k, v]) => [k, { enabled: !!v.enabled, required: !!v.required && !!v.enabled }])
		);
	}
	const [row] = await db()
		.update(schema.forms)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.heading !== undefined ? { heading: patch.heading } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			...(patch.ctaText !== undefined ? { ctaText: patch.ctaText } : {}),
			...(patch.successMessage !== undefined ? { successMessage: patch.successMessage } : {}),
			...(fields !== undefined ? { fields } : {}),
			...(patch.allowedOrigins !== undefined ? { allowedOrigins: patch.allowedOrigins.filter(Boolean) } : {}),
			...(patch.branding !== undefined ? { branding: patch.branding } : {}),
			...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.forms.id, id), eq(schema.forms.tenantId, tenantId)))
		.returning();
	return row;
}

/** Rotate the public identifier — instantly invalidates every published embed/URL. */
export async function regeneratePublicId(tenantId: string, id: string): Promise<schema.Form> {
	await getForm(tenantId, id);
	const [row] = await db()
		.update(schema.forms)
		.set({ publicId: `wf_${randomToken(18)}`, updatedAt: new Date() })
		.where(and(eq(schema.forms.id, id), eq(schema.forms.tenantId, tenantId)))
		.returning();
	return row;
}

/* ------------------------------------------------------- public surface --- */

/** What a visitor's browser is allowed to know. No tenant id, no internal ids. */
export type PublicFormConfig = {
	publicId: string;
	type: FormType;
	heading: string | null;
	description: string | null;
	ctaText: string | null;
	successMessage: string | null;
	branding: Record<string, unknown>;
	businessName: string;
	fields: Array<{ key: string; label: string; required: boolean }>;
};

/** Resolve a live form by its opaque public id. Inactive and unknown ids 404 alike. */
export async function resolvePublicForm(publicId: string): Promise<{ form: schema.Form; tenant: schema.Tenant }> {
	const rows = await db()
		.select({ form: schema.forms, tenant: schema.tenants })
		.from(schema.forms)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.forms.tenantId))
		.where(eq(schema.forms.publicId, publicId))
		.limit(1);
	const row = rows[0];
	/*
	 * Stated as an EXCLUSION, not as `status === 'ACTIVE'`.
	 *
	 * A tenant on a free trial is 'TRIAL' and a self-signup awaiting billing is
	 * 'PENDING'. Both are real businesses whose forms are live on their websites.
	 * Requiring ACTIVE 404'd every hosted form and every embedded widget they had
	 * — and since production currently holds no ACTIVE tenant at all, that was the
	 * entire feature, for everyone: an operator could create a form, copy its URL,
	 * paste it on their site, and every visitor got a 404.
	 *
	 * marketplace.ts made exactly this mistake with enquiries and already carries
	 * the same fix and the same reasoning; this file never got it.
	 */
	const reachable = row && !row.tenant.deletedAt && !['SUSPENDED', 'CANCELLED'].includes(row.tenant.status);
	if (!reachable || !row.form.isActive) {
		throw new AppError('NOT_FOUND', 'This form is not available.');
	}
	return row;
}

export async function publicFormConfig(publicId: string): Promise<PublicFormConfig> {
	const { form, tenant } = await resolvePublicForm(publicId);
	const enabled = FORM_FIELD_CATALOG[form.type]
		.filter((f) => form.fields[f.key]?.enabled)
		.map((f) => ({ key: f.key, label: f.label, required: !!form.fields[f.key]?.required }));
	return {
		publicId: form.publicId,
		type: form.type,
		heading: form.heading,
		description: form.description,
		ctaText: form.ctaText,
		successMessage: form.successMessage,
		branding: form.branding ?? {},
		businessName: tenant.name,
		fields: enabled
	};
}

/** Origin allow-list check for embedded submissions. Empty list = any origin. */
export function originAllowed(form: schema.Form, origin: string | null): boolean {
	const allowed = (form.allowedOrigins ?? []).filter(Boolean);
	if (allowed.length === 0) return true;
	if (!origin) return false;
	try {
		const host = new URL(origin).hostname.toLowerCase();
		return allowed.some((entry) => {
			const pattern = entry.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
			return host === pattern || host.endsWith(`.${pattern}`);
		});
	} catch {
		return false;
	}
}

export async function bumpSubmissionCount(formId: string): Promise<void> {
	await db()
		.update(schema.forms)
		.set({ submissionCount: sql`${schema.forms.submissionCount} + 1` })
		.where(eq(schema.forms.id, formId));
}
