// The one and only way a tenant comes into existence.
//
// Platform Admin provisioning and public self-signup both call `provisionTenant()`.
// Keeping a single implementation is the point: two code paths would inevitably drift,
// and the one that drifts is the one that skips a safety default or forgets an audit row.
//
// Everything below happens in ONE transaction — tenant, owner membership, subscription,
// usage period and audit trail commit together or not at all. A signup that fails
// halfway therefore leaves no half-built tenant for the user to get stuck inside.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { audit, type AuditActor } from './audit';
import { hashPassword } from './auth/password';
import { currentPeriod, type UsageMetric } from './billing';
import { db, schema, txDb, type Database } from './db';
import { invalidateEntitlements } from './entitlements';
import { env } from './env';
import { AppError } from './errors';
import { log } from './logger';
import { slugify } from './tenants';
import { workspaceForIndustry } from '$lib/workspace';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Industries offered at signup. `capabilities` seeds the tenant's default modules. */
export const INDUSTRIES = [
	{ value: 'TRAVEL_TOURISM', label: 'Travel & Tourism', capabilities: 'BOOKINGS' },
	{ value: 'HOSPITALITY', label: 'Hospitality', capabilities: 'BOOKINGS' },
	{ value: 'RETAIL', label: 'Retail', capabilities: 'ORDERS' },
	{ value: 'RESTAURANT_FOOD', label: 'Restaurant / Food', capabilities: 'ORDERS' },
	{ value: 'PROFESSIONAL_SERVICES', label: 'Professional Services', capabilities: 'BOTH' },
	{ value: 'EDUCATION', label: 'Education', capabilities: 'BOOKINGS' },
	{ value: 'REAL_ESTATE', label: 'Real Estate', capabilities: 'BOTH' },
	{ value: 'HEALTHCARE', label: 'Healthcare', capabilities: 'BOOKINGS' },
	{ value: 'GOVERNMENT_PUBLIC', label: 'Government / Public Sector', capabilities: 'BOTH' },
	{ value: 'OTHER', label: 'Other', capabilities: 'BOTH' }
] as const;

export type Industry = (typeof INDUSTRIES)[number]['value'];

/**
 * Short, honest plan-card bullets derived from the plan row itself.
 *
 * Older plan rows still use `limits`/`features`; newer rows can override them with
 * dotted entitlements. Absence is not the same as numeric zero (unlimited), so only
 * make an unlimited claim when a plan explicitly stores zero.
 */
export function planHighlights(
	entitlements: Record<string, boolean | number>,
	limits: Record<string, number> = {},
	features: Record<string, boolean> = {}
): string[] {
	const owns = (key: string) => Object.prototype.hasOwnProperty.call(entitlements, key);
	const out: string[] = [];

	let numberLabel = 'WhatsApp team workspace';
	if (owns('whatsapp.maxNumbers')) {
		const count = Number(entitlements['whatsapp.maxNumbers']);
		numberLabel = count === 0 ? 'Unlimited WhatsApp numbers' : `${count} WhatsApp number${count === 1 ? '' : 's'}`;
	} else if (features.multiple_numbers === true) {
		numberLabel = 'Multiple WhatsApp numbers';
	} else if (features.whatsapp === true) {
		numberLabel = '1 WhatsApp number';
	}

	const outbound = owns('whatsapp.maxOutboundPerMonth')
		? Number(entitlements['whatsapp.maxOutboundPerMonth'])
		: limits.whatsapp_outbound_per_month;
	if (Number.isFinite(outbound) && outbound > 0) {
		numberLabel += ` · ${outbound.toLocaleString()} outbound / month`;
	} else if (owns('whatsapp.maxOutboundPerMonth') && outbound === 0) {
		numberLabel += ' · unlimited outbound';
	}
	out.push(numberLabel);

	const members = owns('platform.maxUsers') ? Number(entitlements['platform.maxUsers']) : limits.members;
	if (Number.isFinite(members)) {
		out.push(members === 0 ? 'Unlimited team members' : `Up to ${members.toLocaleString()} team member${members === 1 ? '' : 's'}`);
	}

	if (entitlements['bookings.enabled'] !== false) {
		const requests = owns('bookings.maxRequestsPerMonth')
			? Number(entitlements['bookings.maxRequestsPerMonth'])
			: limits.booking_requests_per_month;
		if (Number.isFinite(requests)) {
			out.push(requests === 0 ? 'Unlimited enquiries' : `${requests.toLocaleString()} enquiries / month`);
		}
	}

	const payments = owns('payments.enabled') ? entitlements['payments.enabled'] === true : features.payments === true;
	const webhooks = owns('webhooks.enabled') ? entitlements['webhooks.enabled'] === true : features.client_webhooks === true;
	const quotations = owns('quotations.enabled') ? entitlements['quotations.enabled'] !== false : features.quotations !== false;
	const capabilities = [payments && 'Payments', webhooks && 'Webhooks', quotations && 'Quotations'].filter(Boolean);
	if (capabilities.length) out.push(capabilities.join(', '));

	return out.slice(0, 4);
}

export function industryLabel(value: string | null): string {
	return INDUSTRIES.find((i) => i.value === value)?.label ?? 'Other';
}

function capabilitiesFor(industry: string | null | undefined) {
	return workspaceForIndustry(industry);
}

/** Metrics pre-seeded at zero so the first period exists before anything is metered. */
const SEEDED_METRICS: UsageMetric[] = [
	'api_requests',
	'whatsapp_outbound',
	'booking_requests',
	'bookings',
	'orders',
	'quotations'
];

export type ProvisionOwner =
	/** Self-signup: the user already exists and has verified their email. */
	| { kind: 'existing'; userId: string }
	/** Platform Admin: create the account and hand the admin a temporary password. */
	| { kind: 'email'; email: string; fullName?: string };

export type ProvisionTenantInput = {
	name: string;
	/** Omit to derive from the name. Self-signup always omits it. */
	slug?: string;
	planCode?: string;
	/** Server-verified plan id. Never trusted for capabilities — the plan row is. */
	planId?: string;
	source: schema.ProvisioningSource;
	owner?: ProvisionOwner;
	industry?: string | null;
	/** UI preference only — which modules lead the portal. Never an authorization input. */
	capabilities?: 'BOOKINGS' | 'ORDERS' | 'SERVICE' | 'HYBRID' | null;
	country?: string | null;
	currency?: string | null;
	timezone?: string | null;
	businessPhone?: string | null;
	websiteUrl?: string | null;
	/** Presentation-only onboarding context. Never used to grant entitlements. */
	onboardingProfile?: {
		primaryGoal?: 'BOOKINGS' | 'ORDERS' | 'SERVICE' | 'PAYMENTS' | 'HYBRID';
		systemSource?: 'WEBSITE_CMS' | 'BOOKING_SYSTEM' | 'OTHER_SYSTEM' | 'CONNECT_MANUAL';
	};
	bookingReferencePrefix?: string;
	quotationPrefix?: string;
	actor: AuditActor;
};

export type ProvisionResult = {
	tenant: schema.Tenant;
	ownerUserId: string | null;
	/** Only ever set when this call created a brand-new user account. */
	temporaryPassword: string | null;
	subscriptionId: string | null;
	/** True when an existing tenant was returned instead of a new one being created. */
	reused: boolean;
};

/** Trial length in days. 0 disables trials — tenants then land in PENDING. */
export function trialDays(): number {
	return env().SIGNUP_TRIAL_DAYS;
}

/** Plan a self-signup lands on when the visitor does not pick one. */
export function defaultSignupPlanCode(): string {
	return env().SIGNUP_DEFAULT_PLAN.trim() || 'STARTER';
}

/** Is public self-signup switched on? Defaults to on; set SIGNUP_ENABLED=off to close it. */
export function signupEnabled(): boolean {
	return env().SIGNUP_ENABLED === 'on';
}

/**
 * Plans that are never offered publicly, whatever the request says. ENTERPRISE is a
 * negotiated deal, so it must not be reachable by posting its id to the signup form.
 */
const NOT_SELF_SERVICE = new Set(['ENTERPRISE']);

/** Plans a visitor may choose during signup: active, and never hidden ENTERPRISE deals. */
export async function selectablePlans() {
	const rows = await db()
		.select({
			id: schema.plans.id,
			code: schema.plans.code,
			name: schema.plans.name,
			priceMonthly: schema.plans.priceMonthly,
			currency: schema.plans.currency,
			entitlements: schema.plans.entitlements,
			limits: schema.plans.limits,
			features: schema.plans.features,
			sortOrder: schema.plans.sortOrder
		})
		.from(schema.plans)
		.where(eq(schema.plans.isActive, true))
		.orderBy(schema.plans.sortOrder);
	return rows.filter((p) => !NOT_SELF_SERVICE.has(p.code));
}

/** A slug nobody else holds. Self-signup must not fail because a name is popular. */
async function availableSlug(tx: Tx, desired: string): Promise<string> {
	const base = slugify(desired) || 'tenant';
	for (let attempt = 0; attempt < 25; attempt++) {
		const candidate = attempt === 0 ? base : `${base.slice(0, 55)}-${attempt + 1}`;
		const taken = await tx
			.select({ id: schema.tenants.id })
			.from(schema.tenants)
			.where(eq(schema.tenants.slug, candidate))
			.limit(1);
		if (taken.length === 0) return candidate;
	}
	return `${base.slice(0, 46)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Serialise concurrent provisioning for the same actor. A double-clicked submit or a
 * refreshed browser tab arrives as two simultaneous requests; without this they both
 * pass the "does this user already own a tenant?" check and create two tenants.
 */
async function lockFor(tx: Tx, key: string): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provision:${key}`}))`);
}

/** The tenant this user already owns, if any — the basis of idempotent signup. */
async function ownedTenant(tx: Tx, userId: string): Promise<schema.Tenant | null> {
	const rows = await tx
		.select({ tenant: schema.tenants })
		.from(schema.tenantMemberships)
		.innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
		.where(
			and(
				eq(schema.tenantMemberships.userId, userId),
				eq(schema.tenantMemberships.role, 'OWNER'),
				isNull(schema.tenants.deletedAt)
			)
		)
		.limit(1);
	return rows[0]?.tenant ?? null;
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionResult> {
	const name = input.name.trim();
	if (!name) throw new AppError('VALIDATION_ERROR', 'A business name is required.');

	const lockKey =
		input.owner?.kind === 'existing'
			? `user:${input.owner.userId}`
			: input.owner?.kind === 'email'
				? `email:${input.owner.email.toLowerCase()}`
				: `slug:${slugify(input.slug ?? name)}`;

	// txDb(), not db(): see the note on txConnection() — a transaction over the
	// transaction pooler breaks the pool for every request that follows.
	const result = await txDb().transaction(async (tx) => {
		await lockFor(tx, lockKey);

		// ---- idempotency -------------------------------------------------------
		// One owner, one tenant. Re-running signup resumes the tenant that exists
		// rather than minting a second one.
		if (input.owner?.kind === 'existing') {
			const existing = await ownedTenant(tx, input.owner.userId);
			if (existing) {
				return {
					tenant: existing,
					ownerUserId: input.owner.userId,
					temporaryPassword: null,
					subscriptionId: null,
					reused: true
				};
			}
		}

		// ---- plan --------------------------------------------------------------
		// The plan row is authoritative. A planId from the browser only ever selects
		// WHICH active plan applies; the entitlements come from the database, so a
		// tampered id can never conjure capabilities that plan does not carry.
		const wanted = input.planId
			? await tx
					.select()
					.from(schema.plans)
					.where(and(eq(schema.plans.id, input.planId), eq(schema.plans.isActive, true)))
					.limit(1)
			: await tx
					.select()
					.from(schema.plans)
					.where(eq(schema.plans.code, input.planCode ?? 'STARTER'))
					.limit(1);
		// A plan that is active but not publicly offered is treated as no choice at all.
		const offered =
			wanted[0] && !(input.source === 'SELF_SERVICE' && NOT_SELF_SERVICE.has(wanted[0].code)) ? wanted[0] : null;
		let plan = offered;
		if (!plan) {
			// Fall back to the configured default rather than trusting the request.
			const fallbackCode = input.source === 'SELF_SERVICE' ? defaultSignupPlanCode() : 'STARTER';
			const fallback = await tx.select().from(schema.plans).where(eq(schema.plans.code, fallbackCode)).limit(1);
			plan = fallback[0];
		}
		if (!plan && input.source === 'SELF_SERVICE') {
			throw new AppError('INTERNAL_ERROR', 'No plan is available for signup. Please contact support.');
		}

		// ---- slug --------------------------------------------------------------
		// An admin naming a slug explicitly gets told when it clashes; self-signup
		// silently disambiguates, because the visitor never chose the slug.
		let slug: string;
		if (input.slug && input.source !== 'SELF_SERVICE') {
			slug = slugify(input.slug);
			const clash = await tx
				.select({ id: schema.tenants.id })
				.from(schema.tenants)
				.where(eq(schema.tenants.slug, slug))
				.limit(1);
			if (clash.length) throw new AppError('CONFLICT', `A tenant with the slug "${slug}" already exists.`);
		} else {
			slug = await availableSlug(tx, input.slug || name);
		}

		// ---- lifecycle ---------------------------------------------------------
		// No pretending a card was charged: a self-signup either enters a real,
		// time-boxed trial or sits in PENDING until billing activates it.
		const days = trialDays();
		const trialing = input.source === 'SELF_SERVICE' && days > 0;
		const status: schema.Tenant['status'] =
			input.source === 'SELF_SERVICE' ? (trialing ? 'TRIAL' : 'PENDING') : 'ACTIVE';

		const prefix =
			(input.bookingReferencePrefix || slug.slice(0, 3))
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, '')
				.slice(0, 6) || 'MKT';

		const [tenant] = await tx
			.insert(schema.tenants)
			.values({
				name,
				slug,
				status,
				planId: plan?.id ?? null,
				timezone: input.timezone || 'Africa/Dar_es_Salaam',
				currency: (input.currency || 'USD').toUpperCase().slice(0, 3),
				country: input.country ? input.country.toUpperCase().slice(0, 2) : null,
				industry: input.industry ?? null,
				businessPhone: input.businessPhone ?? null,
				websiteUrl: input.websiteUrl ?? null,
				provisioningSource: input.source,
				bookingReferencePrefix: prefix,
				// Not 'QT': that is the document kind nextReference already adds.
				quotationPrefix: input.quotationPrefix ?? null,
				// Safe defaults. Nothing here grants a capability — every module is still
				// gated by the plan's entitlements at the point of use.
				settings: {
					capabilities: input.capabilities ?? capabilitiesFor(input.industry),
					...(input.onboardingProfile?.primaryGoal
						? { onboardingGoal: input.onboardingProfile.primaryGoal }
						: {}),
					...(input.onboardingProfile?.systemSource
						? { systemSource: input.onboardingProfile.systemSource }
						: {})
				},
				notificationPreferences: { inApp: true, email: true }
			})
			.returning();

		// ---- owner -------------------------------------------------------------
		// Self-signup can only ever produce an OWNER of one tenant. isSuperAdmin is
		// never written here, so no public path can manufacture a platform admin.
		let ownerUserId: string | null = null;
		let temporaryPassword: string | null = null;
		if (input.owner?.kind === 'existing') {
			ownerUserId = input.owner.userId;
		} else if (input.owner?.kind === 'email') {
			const email = input.owner.email.trim().toLowerCase();
			const found = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
			if (found[0]) {
				ownerUserId = found[0].id;
			} else {
				temporaryPassword = `mk-${crypto.randomUUID().slice(0, 12)}`;
				const [created] = await tx
					.insert(schema.users)
					.values({
						email,
						passwordHash: await hashPassword(temporaryPassword),
						fullName: input.owner.fullName ?? '',
						// Admin-created accounts are trusted by the admin who typed the address.
						emailVerifiedAt: new Date()
					})
					.returning({ id: schema.users.id });
				ownerUserId = created.id;
			}
		}
		if (ownerUserId) {
			await tx
				.insert(schema.tenantMemberships)
				.values({ tenantId: tenant.id, userId: ownerUserId, role: 'OWNER', acceptedAt: new Date() })
				.onConflictDoNothing();
		}

		// ---- subscription ------------------------------------------------------
		let subscriptionId: string | null = null;
		if (plan && status !== 'PENDING') {
			const now = new Date();
			const periodEnd = new Date(now);
			if (trialing) periodEnd.setDate(periodEnd.getDate() + days);
			else periodEnd.setMonth(periodEnd.getMonth() + 1);
			const [sub] = await tx
				.insert(schema.subscriptions)
				.values({
					tenantId: tenant.id,
					planId: plan.id,
					status: trialing ? 'TRIALING' : 'ACTIVE',
					currentPeriodStart: now,
					currentPeriodEnd: periodEnd,
					trialEndsAt: trialing ? periodEnd : null
				})
				.returning({ id: schema.subscriptions.id });
			subscriptionId = sub.id;
		}

		// ---- usage period ------------------------------------------------------
		const period = currentPeriod();
		await tx
			.insert(schema.usageRecords)
			.values(SEEDED_METRICS.map((metric) => ({ tenantId: tenant.id, metric, period, quantity: 0 })))
			.onConflictDoNothing();

		// ---- audit (same transaction) -------------------------------------------
		await audit(
			tenant.id,
			'tenant.provisioned',
			input.actor,
			{ type: 'tenant', id: tenant.id },
			{ source: input.source, slug, status, planCode: plan?.code ?? null, trialDays: trialing ? days : 0 },
			tx
		);
		if (plan) {
			await audit(tenant.id, 'plan.selected', input.actor, { type: 'plan', id: plan.id }, { code: plan.code }, tx);
		}
		if (subscriptionId) {
			await audit(
				tenant.id,
				'subscription.created',
				input.actor,
				{ type: 'subscription', id: subscriptionId },
				{ status: trialing ? 'TRIALING' : 'ACTIVE', trialEndsAt: trialing ? days : null },
				tx
			);
		}
		if (ownerUserId) {
			await audit(tenant.id, 'user.invited', input.actor, { type: 'user', id: ownerUserId }, { role: 'OWNER' }, tx);
		}

		return { tenant, ownerUserId, temporaryPassword, subscriptionId, reused: false };
	});

	if (!result.reused) {
		invalidateEntitlements(result.tenant.id);
		log.info('tenant_provisioned', { tenantId: result.tenant.id, source: input.source, slug: result.tenant.slug });
	}
	return result;
}
