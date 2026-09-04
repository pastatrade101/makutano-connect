import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { requirePermission } from '$lib/server/auth/permissions';
import { currentPeriod } from '$lib/server/billing';
import { effectiveEntitlements, invalidateEntitlements, usageSummary } from '$lib/server/entitlements';
import { db, schema } from '$lib/server/db';
import { normalizeWorkspace } from '$lib/workspace';
import { paymentMethodIssue, paymentMethods, type PaymentMethod } from '$lib/server/payment-requests';
import { availableProviders } from '$lib/server/payments/providers';
import { CURRENCIES } from '$lib/tour-options';
import type { PageServerLoad } from './$types';

/*
 * The four settings that were free text and should never have been.
 *
 * "Country (ISO-2)" asked an operator to know that Tanzania is TZ; "Locale"
 * asked for a BCP-47 tag. Both are codes the system needs and the person does
 * not have — a box that accepts "Tanzania" and silently stores "TA" is worse
 * than a list. Currencies come from tour-options so pricing and settings cannot
 * disagree about what this marketplace supports.
 *
 * Short on purpose. These are the places Makutano operators actually work from;
 * adding one is a decision about what the product supports, not something an
 * operator does by typing.
 */
const COUNTRY_OPTIONS = [
	{ code: 'TZ', name: 'Tanzania' },
	{ code: 'KE', name: 'Kenya' },
	{ code: 'UG', name: 'Uganda' },
	{ code: 'RW', name: 'Rwanda' },
	{ code: 'BI', name: 'Burundi' },
	{ code: 'ZM', name: 'Zambia' },
	{ code: 'MW', name: 'Malawi' },
	{ code: 'ZA', name: 'South Africa' },
	{ code: 'GB', name: 'United Kingdom' },
	{ code: 'US', name: 'United States' },
	{ code: 'AE', name: 'United Arab Emirates' }
];

const TIMEZONE_OPTIONS = [
	'Africa/Dar_es_Salaam',
	'Africa/Nairobi',
	'Africa/Kampala',
	'Africa/Kigali',
	'Africa/Lusaka',
	'Africa/Johannesburg',
	'Europe/London',
	'Asia/Dubai',
	'UTC'
];

const LOCALE_OPTIONS = [
	{ code: 'en', name: 'English' },
	{ code: 'sw', name: 'Kiswahili' },
	{ code: 'fr', name: 'French' }
];

export const load: PageServerLoad = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'tenant:read');
	const tenantId = requireTenant(locals).id;

	const [ent, usage, members, publicProfileRows] = await Promise.all([
		effectiveEntitlements(tenantId),
		usageSummary(tenantId),
		db()
			.select({ membership: schema.tenantMemberships, user: schema.users })
			.from(schema.tenantMemberships)
			.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
			.where(eq(schema.tenantMemberships.tenantId, tenantId)),
		db()
			.select({
				publicEmail: schema.operatorProfiles.publicEmail,
				publicPhone: schema.operatorProfiles.publicPhone
			})
			.from(schema.operatorProfiles)
			.where(eq(schema.operatorProfiles.tenantId, tenantId))
			.limit(1)
	]);
	const publicProfile = publicProfileRows[0] ?? null;

	return {
		// A quotation the traveller cannot answer is a dead end, and the operator has
		// no way to notice: the public page looks fine to them. So the settings page
		// says it, rather than leaving it to be discovered by a lost customer.
		publicContactMissing: !(publicProfile?.publicEmail?.trim() || publicProfile?.publicPhone?.trim()),
		settings: {
			capabilities: normalizeWorkspace((tenant.settings as Record<string, unknown>)?.capabilities),
			paymentMethods: paymentMethods(tenant.settings as Record<string, unknown>),
			name: tenant.name,
			slug: tenant.slug,
			timezone: tenant.timezone,
			currency: tenant.currency,
			country: tenant.country,
			locale: tenant.locale,
			logoUrl: tenant.logoUrl,
			bookingReferencePrefix: tenant.bookingReferencePrefix,
			quotationPrefix: tenant.quotationPrefix
		},
		options: {
			countries: COUNTRY_OPTIONS,
			timezones: TIMEZONE_OPTIONS,
			locales: LOCALE_OPTIONS,
			currencies: CURRENCIES.map((c) => ({ code: c.code, label: c.label }))
		},
		onlinePaymentProviders: availableProviders().filter(
			(provider) => provider.configured && provider.code !== 'MANUAL' && provider.code !== 'BANK_TRANSFER'
		),
		plan: { code: ent.planCode, name: ent.planName, status: ent.subscriptionStatus },
		period: currentPeriod(),
		// Used / limit for every metered entitlement, so the tenant sees headroom.
		usage: usage.map((u) => ({
			label: u.label,
			used: u.used,
			limit: u.unlimited ? null : u.limit,
			percent: u.percent
		})),
		members: members.map((m) => ({
			id: m.membership.id,
			role: m.membership.role,
			email: m.user.email,
			fullName: m.user.fullName
		}))
	};
};

export const actions: Actions = {
	/** Add or update a way customers can pay — display data only, never credentials. */
	savePaymentMethod: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const displayName = String(data.get('displayName') ?? '').trim();
		if (!displayName) return fail(400, { message: 'Give the payment method a name, e.g. "M-Pesa Lipa Namba".' });
		const kindRaw = String(data.get('kind') ?? 'MOBILE');
		const method: PaymentMethod = {
			key:
				String(data.get('key') ?? '') ||
				displayName
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
					.slice(0, 40) ||
				`method-${Date.now()}`,
			kind: (['MOBILE', 'BANK', 'ONLINE'].includes(kindRaw) ? kindRaw : 'MOBILE') as PaymentMethod['kind'],
			displayName,
			provider:
				String(data.get('provider') ?? '')
					.trim()
					.slice(0, 100) || undefined,
			bank:
				String(data.get('bank') ?? '')
					.trim()
					.slice(0, 100) || undefined,
			accountName: String(data.get('accountName') ?? '').trim() || undefined,
			number:
				String(data.get('number') ?? '')
					.trim()
					.slice(0, 120) || undefined,
			accountNumber:
				String(data.get('accountNumber') ?? '')
					.trim()
					.slice(0, 120) || undefined,
			branch:
				String(data.get('branch') ?? '')
					.trim()
					.slice(0, 100) || undefined,
			swift:
				String(data.get('swift') ?? '')
					.trim()
					.slice(0, 32) || undefined,
			paymentUrl:
				String(data.get('paymentUrl') ?? '')
					.trim()
					.slice(0, 500) || undefined,
			instructions:
				String(data.get('instructions') ?? '')
					.trim()
					.slice(0, 500) || undefined,
			enabled: data.get('enabled') === 'on'
		};
		const issue = method.enabled ? paymentMethodIssue(method) : null;
		if (issue) return fail(400, { message: issue });
		const existing = paymentMethods(tenant.settings as Record<string, unknown>);
		const next = [...existing.filter((m) => m.key !== method.key), method];
		await db()
			.update(schema.tenants)
			.set({
				settings: { ...((tenant.settings as Record<string, unknown>) ?? {}), paymentMethods: next },
				updatedAt: new Date()
			})
			.where(eq(schema.tenants.id, tenant.id));
		await audit(
			tenant.id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: tenant.id },
			{
				paymentMethod: { key: method.key, kind: method.kind, enabled: method.enabled }
			}
		);
		return { success: true };
	},

	removePaymentMethod: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const next = paymentMethods(tenant.settings as Record<string, unknown>).filter((m) => m.key !== key);
		await db()
			.update(schema.tenants)
			.set({
				settings: { ...((tenant.settings as Record<string, unknown>) ?? {}), paymentMethods: next },
				updatedAt: new Date()
			})
			.where(eq(schema.tenants.id, tenant.id));
		await audit(
			tenant.id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: tenant.id },
			{
				paymentMethodRemoved: key
			}
		);
		return { success: true };
	},

	save: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Business name is required.' });

		const capabilities = String(data.get('capabilities') ?? 'BOTH');
		const tenant = requireTenant(locals);
		await db()
			.update(schema.tenants)
			.set({
				settings: {
					...((tenant.settings as Record<string, unknown>) ?? {}),
					capabilities: ['BOOKINGS', 'ORDERS', 'SERVICE', 'HYBRID'].includes(capabilities) ? capabilities : 'HYBRID'
				},
				name,
				timezone: String(data.get('timezone') ?? tenant.timezone),
				currency: String(data.get('currency') ?? tenant.currency)
					.toUpperCase()
					.slice(0, 3),
				country:
					String(data.get('country') ?? '')
						.toUpperCase()
						.slice(0, 2) || null,
				locale: String(data.get('locale') ?? 'en'),
				// logoUrl is deliberately NOT read from this form any more. It is a mirror
				// of the uploaded brand logo (see settings/profile), and a free-text box
				// here let an operator set a URL the marketplace never reads — they
				// changed their logo and nothing happened. Absent from the form means
				// untouched, never blanked.
				logoUrl: tenant.logoUrl,
				// Changing a prefix only affects NEW references; existing ones are immutable.
				bookingReferencePrefix:
					String(data.get('bookingReferencePrefix') ?? 'MKT')
						.toUpperCase()
						.replace(/[^A-Z0-9]/g, '')
						.slice(0, 8) || 'MKT',
				quotationPrefix:
					String(data.get('quotationPrefix') ?? 'QT')
						.toUpperCase()
						.replace(/[^A-Z0-9]/g, '')
						.slice(0, 8) || 'QT',
				updatedAt: new Date()
			})
			.where(eq(schema.tenants.id, requireTenant(locals).id));

		invalidateEntitlements(requireTenant(locals).id);
		await audit(
			requireTenant(locals).id,
			'tenant.updated',
			{ type: 'user', userId: locals.user!.id },
			{ type: 'tenant', id: requireTenant(locals).id }
		);
		return { success: true };
	}
};
