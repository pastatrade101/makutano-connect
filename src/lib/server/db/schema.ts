// Makutano Connect — full relational schema (§25).
// Conventions: UUID primary keys, UTC timestamptz everywhere, every business-owned
// row carries tenant_id, and tenant-scoped uniqueness is expressed as compound unique
// indexes so two tenants can never collide (or read each other's rows by guessing).
import { relations, sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	boolean,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums -- */

export const tenantStatusEnum = pgEnum('tenant_status', [
	'ACTIVE',
	'SUSPENDED',
	'CANCELLED',
	'TRIAL',
	// Self-signup created the tenant but activation is still pending (no billing yet).
	'PENDING'
]);
/** How a tenant came into existence — Platform Admin, the public signup, or a legacy import. */
export const provisioningSourceEnum = pgEnum('provisioning_source', ['ADMIN', 'SELF_SERVICE', 'IMPORT']);
// Order matters: it must match the order the labels were added in the database,
// because ALTER TYPE ... ADD VALUE appends. OPERATIONS came last (0016), so it
// goes last here — a divergence would make any generated diff wrong.
export const roleEnum = pgEnum('role', ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'SALES', 'BOOKING_AGENT', 'VIEWER', 'OPERATIONS', 'CREW']);
export const apiKeyEnvEnum = pgEnum('api_key_environment', ['live', 'test']);
export const verificationPurposeEnum = pgEnum('verification_purpose', [
	'EMAIL_VERIFICATION',
	'PASSWORD_RESET',
	'TEAM_INVITE'
]);
export const apiKeyStatusEnum = pgEnum('api_key_status', ['ACTIVE', 'REVOKED']);
export const waConnectionStatusEnum = pgEnum('whatsapp_connection_status', [
	'CONNECTED',
	'DISCONNECTED',
	'ERROR',
	'REAUTH_REQUIRED'
]);
export const channelEnum = pgEnum('channel', ['WHATSAPP', 'WEB', 'EMAIL', 'MANUAL']);
/** Who inside the tenant may see a conversation (§team-access brief). */
export const conversationVisibilityEnum = pgEnum('conversation_visibility', [
	// Anyone on the team with inbox access — the default, matching prior behaviour.
	'TEAM',
	// Only the assigned member (plus view_all/owners).
	'ASSIGNED',
	// Only owners, holders of view_private, and explicitly shared members.
	'PRIVATE'
]);
export const messageDirectionEnum = pgEnum('message_direction', ['INBOUND', 'OUTBOUND']);
export const messageStatusEnum = pgEnum('message_status', ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED']);
export const leadStageEnum = pgEnum('lead_stage', [
	'NEW',
	'CONTACTED',
	'QUALIFIED',
	'QUOTED',
	'NEGOTIATING',
	'WON',
	'LOST'
]);
// MARKETPLACE is set by the marketplace enquiry route, never by an API caller —
// the /api/v1 zod schemas deliberately still omit it, so an integration key
// cannot forge an enquiry that looks like it came from the public marketplace.
export const sourceEnum = pgEnum('source', [
	'WEBSITE',
	'WHATSAPP',
	'ADMIN',
	'API',
	'PHONE',
	'EMAIL',
	'MARKETPLACE'
]);
export const bookingRequestStatusEnum = pgEnum('booking_request_status', [
	'NEW',
	'UNDER_REVIEW',
	'CONTACTED',
	'QUOTED',
	'ACCEPTED',
	'DECLINED',
	'CANCELLED',
	'CONVERTED'
]);
export const bookingStatusEnum = pgEnum('booking_status', [
	'DRAFT',
	'PENDING',
	'AWAITING_PAYMENT',
	'PARTIALLY_PAID',
	'CONFIRMED',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED',
	'REFUNDED'
]);
/**
 * A trip's OPERATIONAL life, which is not the booking's commercial life.
 *
 * A booking can be CONFIRMED and fully paid while the trip still has no driver; a
 * trip can be IN_PROGRESS while a balance is outstanding. Sharing one status
 * between them is what forces operations staff to read commercial fields to find
 * out whether a vehicle is assigned, so they are kept apart on purpose.
 */
/**
 * The people who actually run a trip.
 *
 * Deliberately NOT roles on a user account. A safari driver usually has no
 * company email and no reason to log in, and every membership consumes a plan
 * seat — so requiring an invite to record who is driving would price the
 * feature out of the job it exists for. Crew can be linked to a user later,
 * when one of them genuinely needs the app.
 */
export const crewTypeEnum = pgEnum('crew_type', ['DRIVER', 'GUIDE', 'SPECIALIST']);
/**
 * A marketplace listing's publishing lifecycle.
 *
 * SUBMITTED and IN_REVIEW are distinct on purpose: the first is the vendor's act,
 * the second is a platform reviewer picking it up. A vendor may not approve their
 * own listing — see the tours:publish permission.
 */
export const tourStatusEnum = pgEnum('tour_status', [
	'DRAFT',
	'SUBMITTED',
	'IN_REVIEW',
	'CHANGES_REQUESTED',
	'APPROVED',
	'PUBLISHED',
	'UNPUBLISHED',
	'ARCHIVED'
]);

/**
 * Where a place is, never what kind of trip it is. "Luxury" is not a destination.
 *
 * Kept in step with the destinations_type_check constraint in 0031 — if you add a
 * category here, add it there too.
 */
export const DESTINATION_TYPES = [
	'NATIONAL_PARK',
	'GAME_RESERVE',
	'CONSERVATION_AREA',
	'MOUNTAIN',
	'ISLAND',
	'BEACH',
	'CITY',
	'CULTURAL_AREA',
	'LAKE',
	'HERITAGE_SITE',
	'FOREST',
	'MARINE_AREA',
	/** The 31 administrative regions. Geography that CONTAINS the rest. */
	'REGION',
	'OTHER'
] as const;

export type DestinationType = (typeof DESTINATION_TYPES)[number];

/** How a traveller reaches the next stop. */
export const TRAVEL_MODES = ['DRIVE', 'FLY', 'BOAT'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export const contentStatusEnum = pgEnum('content_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const tripStatusEnum = pgEnum('trip_status', [
	'PREPARING',
	'READY',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED'
]);

export const bookingItemTypeEnum = pgEnum('booking_item_type', [
	'TOUR',
	'HOTEL',
	'ROOM',
	'TRANSFER',
	'ACTIVITY',
	'PARK_FEE',
	'EXTRA',
	'CUSTOM'
]);
export const quotationStatusEnum = pgEnum('quotation_status', [
	'DRAFT',
	'SENT',
	'VIEWED',
	'ACCEPTED',
	'DECLINED',
	'EXPIRED',
	'CONVERTED'
]);
export const paymentStatusEnum = pgEnum('payment_status', [
	'PENDING',
	'PROCESSING',
	'SUCCEEDED',
	'FAILED',
	'REFUNDED',
	'PARTIALLY_REFUNDED'
]);
export const paymentRequestStatusEnum = pgEnum('payment_request_status', [
	// Business asked the customer to pay.
	'REQUESTED',
	// Customer says they paid — NOT verified, never money.
	'REPORTED',
	// Verified in full / in part by staff or a trusted provider webhook.
	'PAID',
	'PARTIALLY_PAID',
	'CANCELLED'
]);
export const notificationChannelEnum = pgEnum('notification_channel', [
	'WHATSAPP',
	'EMAIL',
	'SMS',
	'IN_APP',
	'WEBHOOK'
]);
export const notificationStatusEnum = pgEnum('notification_status', ['PENDING', 'SENT', 'FAILED', 'READ']);
export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
	'TRIALING',
	'ACTIVE',
	'PAST_DUE',
	'CANCELLED',
	'EXPIRED'
]);
export const templateStatusEnum = pgEnum('template_status', [
	'APPROVED',
	'PENDING',
	'REJECTED',
	'PAUSED',
	'DISABLED',
	'DRAFT',
	'SUBMITTED'
]);

/* ------------------------------------------------------------- helpers ---- */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/* ------------------------------------------------------------- §3 core ---- */

export const plans = pgTable('plans', {
	id: uuid('id').primaryKey().defaultRandom(),
	code: text('code').notNull().unique(), // STARTER | BUSINESS | PRO | ENTERPRISE
	name: text('name').notNull(),
	priceMonthly: money('price_monthly').notNull().default('0'),
	currency: text('currency').notNull().default('USD'),
	// { bookingRequests: 500, whatsappMessages: 5000, apiRequestsPerMinute: 120, ... }
	limits: jsonb('limits')
		.$type<Record<string, number>>()
		.notNull()
		.default(sql`'{}'::jsonb`),
	// { whatsapp: true, quotations: true, payments: false, clientWebhooks: true }
	features: jsonb('features')
		.$type<Record<string, boolean>>()
		.notNull()
		.default(sql`'{}'::jsonb`),
	/**
	 * Canonical entitlements keyed generically: { 'orders.enabled': true,
	 * 'whatsapp.maxNumbers': 1, … }. For numeric keys 0 means UNLIMITED — the same
	 * convention the legacy `limits` column already uses, so ENTERPRISE keeps working.
	 */
	entitlements: jsonb('entitlements')
		.$type<Record<string, boolean | number>>()
		.notNull()
		.default(sql`'{}'::jsonb`),
	isActive: boolean('is_active').notNull().default(true),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const tenants = pgTable(
	'tenants',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(), // unique — see index below (§25)
		name: text('name').notNull(),
		status: tenantStatusEnum('status').notNull().default('ACTIVE'),
		planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
		// §26 white-label + operational settings
		logoUrl: text('logo_url'),
		timezone: text('timezone').notNull().default('Africa/Dar_es_Salaam'),
		currency: text('currency').notNull().default('USD'),
		country: text('country'),
		locale: text('locale').notNull().default('en'),
		bookingReferencePrefix: text('booking_reference_prefix').notNull().default('MKT'),
		// Nullable and defaultless on purpose: nextReference already contributes the
		// 'QT' kind, so a default of 'QT' here produced QT-QT-2026-00001 and lost
		// the tenant's own identity. NULL means "use the booking prefix" (0022).
		quotationPrefix: text('quotation_prefix'),
		// Business profile — collected during onboarding, editable in Settings afterwards.
		industry: text('industry'),
		businessPhone: text('business_phone'),
		websiteUrl: text('website_url'),
		/** ADMIN for Platform-Admin provisioning, SELF_SERVICE for the public signup. */
		provisioningSource: provisioningSourceEnum('provisioning_source').notNull().default('ADMIN'),
		onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
		settings: jsonb('settings')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		notificationPreferences: jsonb('notification_preferences')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/**
		 * Sparse per-tenant overrides — ONLY explicitly set keys live here, so a plan
		 * change still flows through for every key the tenant has not overridden.
		 */
		entitlementOverrides: jsonb('entitlement_overrides')
			.$type<Record<string, boolean | number>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [uniqueIndex('tenants_slug_key').on(t.slug), index('tenants_status_idx').on(t.status)]
);

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		passwordHash: text('password_hash'),
		fullName: text('full_name').notNull().default(''),
		isSuperAdmin: boolean('is_super_admin').notNull().default(false),
		isActive: boolean('is_active').notNull().default(true),
		/** Null until the user proves control of the address. Gates self-signup provisioning. */
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)]
);

export const tenantMemberships = pgTable(
	'tenant_memberships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: roleEnum('role').notNull().default('VIEWER'),
		/**
		 * Sparse per-user permission overrides: ONLY explicitly toggled keys live here
		 * ({'payments:verify': true, 'conversations:view_private': false}), so a role
		 * change still flows through for everything the admin has not customised.
		 * Ignored entirely for OWNER — owners can never lock themselves out (§12).
		 */
		permissionOverrides: jsonb('permission_overrides')
			.$type<Record<string, boolean>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/** Per-TENANT deactivation — the user may still belong to other tenants. */
		disabledAt: timestamp('disabled_at', { withTimezone: true }),
		invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('tenant_memberships_tenant_user_key').on(t.tenantId, t.userId),
		index('tenant_memberships_user_idx').on(t.userId)
	]
);

/**
 * Push targets. One row per device per user: a phone that signs out or reinstalls
 * gets a new token, and Firebase tells us when an old one dies so it can be pruned.
 */
export const deviceTokens = pgTable(
	'device_tokens',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		platform: text('platform').notNull().default('android'),
		deviceName: text('device_name'),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
		createdAt: createdAt()
	},
	(t) => [index('device_tokens_user_idx').on(t.userId), index('device_tokens_tenant_idx').on(t.tenantId)]
);

export const sessions = pgTable(
	'sessions',
	{
		id: text('id').primaryKey(), // sha-256 of the cookie value; the cookie itself is never stored
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
		userAgent: text('user_agent'),
		ipHash: text('ip_hash'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId), index('sessions_expiry_idx').on(t.expiresAt)]
);

/**
 * Single-use, expiring tokens for email verification and password reset.
 *
 * Only the sha-256 of the token is stored: a database leak must not yield a working
 * verification link, exactly as with `sessions`. A row is consumed (not deleted) so a
 * replayed link is recognisably spent rather than merely unknown.
 */
export const verificationTokens = pgTable(
	'verification_tokens',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		purpose: verificationPurposeEnum('purpose').notNull(),
		/** TEAM_INVITE only: which tenant the acceptance activates. */
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		ipHash: text('ip_hash'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('verification_tokens_hash_key').on(t.tokenHash),
		index('verification_tokens_user_idx').on(t.userId, t.purpose),
		index('verification_tokens_expiry_idx').on(t.expiresAt)
	]
);

export const apiKeys = pgTable(
	'api_keys',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		name: text('name').notNull().default('Default key'),
		keyHash: text('key_hash').notNull(), // sha-256 of the full secret — the secret is shown once (§6)
		prefix: text('prefix').notNull(), // mk_live_abcd1234 — display only
		environment: apiKeyEnvEnum('environment').notNull().default('live'),
		scopes: jsonb('scopes')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		status: apiKeyStatusEnum('status').notNull().default('ACTIVE'),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('api_keys_key_hash_key').on(t.keyHash),
		index('api_keys_tenant_idx').on(t.tenantId, t.status),
		index('api_keys_prefix_idx').on(t.prefix)
	]
);

export const auditLogs = pgTable(
	'audit_logs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
		actorApiKeyId: uuid('actor_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
		actorType: text('actor_type').notNull().default('system'), // user | api_key | system | meta
		action: text('action').notNull(), // tenant.created, api_key.revoked, booking.confirmed …
		entityType: text('entity_type'),
		entityId: text('entity_id'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		ipHash: text('ip_hash'),
		requestId: text('request_id'),
		createdAt: createdAt()
	},
	(t) => [
		index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt),
		index('audit_logs_action_idx').on(t.action),
		index('audit_logs_entity_idx').on(t.entityType, t.entityId)
	]
);

/* --------------------------------------------------- §8 WhatsApp layer ---- */

export const whatsappConnections = pgTable(
	'whatsapp_connections',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		metaBusinessId: text('meta_business_id'),
		wabaId: text('waba_id'),
		// Globally unique: this is how an inbound Meta webhook resolves its owning tenant.
		phoneNumberId: text('phone_number_id').notNull(),
		displayPhoneNumber: text('display_phone_number'),
		businessName: text('business_name'),
		// AES-256-GCM envelope: v<keyVersion>.<iv>.<tag>.<ciphertext> (§8)
		encryptedAccessToken: text('encrypted_access_token').notNull(),
		keyVersion: integer('key_version').notNull().default(1),
		tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
		status: waConnectionStatusEnum('status').notNull().default('CONNECTED'),
		isPrimary: boolean('is_primary').notNull().default(true), // multi-number ready (§8)
		// §32 connection health
		lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
		lastSuccessfulSendAt: timestamp('last_successful_send_at', { withTimezone: true }),
		lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
		lastErrorCode: text('last_error_code'),
		connectedAt: timestamp('connected_at', { withTimezone: true }),
		disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('whatsapp_connections_phone_number_id_key').on(t.phoneNumberId),
		index('whatsapp_connections_tenant_idx').on(t.tenantId, t.status)
	]
);

/** Short-lived, tenant-bound Embedded Signup session (§7, §31). */
export const whatsappOnboardingSessions = pgTable(
	'whatsapp_onboarding_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		nonce: text('nonce').notNull(),
		redirectUrl: text('redirect_url'),
		createdByApiKeyId: uuid('created_by_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('whatsapp_onboarding_sessions_token_key').on(t.tokenHash),
		index('whatsapp_onboarding_sessions_tenant_idx').on(t.tenantId, t.expiresAt)
	]
);

export const whatsappTemplates = pgTable(
	'whatsapp_templates',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		metaTemplateId: text('meta_template_id'),
		name: text('name').notNull(),
		language: text('language').notNull().default('en'),
		category: text('category'),
		status: templateStatusEnum('status').notNull().default('PENDING'),
		components: jsonb('components')
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		// Event mapping (§18): BOOKING_REQUEST_RECEIVED, ORDER_CONFIRMED, …
		eventKey: text('event_key'),
		/* --- Template Center authoring (named-variable canonical form) ---------- */
		// The tenant designs "Hello {{customer.first_name}}, order {{order.number}}…";
		// Connect converts named variables to Meta's positional {{1}},{{2}} on submit
		// and back-fills values from the standard variable registry at send time.
		headerText: text('header_text'),
		bodyText: text('body_text'),
		footerText: text('footer_text'),
		/** [{ type: 'QUICK_REPLY'|'URL', text: string, url?: string }] */
		buttons: jsonb('buttons')
			.$type<Array<Record<string, unknown>>>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** Ordered named variables as they appear in the body → positional index. */
		variables: jsonb('variables')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		enabled: boolean('enabled').notNull().default(true),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		// Meta's own words when it rejects one. Without this a REJECTED template
		// is a dead end: the tenant sees "Needs changes" and guesses, at a
		// 24-hour review cycle per guess.
		rejectedReason: text('rejected_reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('whatsapp_templates_tenant_name_lang_key').on(t.tenantId, t.name, t.language),
		index('whatsapp_templates_event_idx').on(t.tenantId, t.eventKey)
	]
);

/* --------------------------------------- §10 customers, leads, messages ---- */

export const customers = pgTable(
	'customers',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		firstName: text('first_name').notNull().default(''),
		lastName: text('last_name').notNull().default(''),
		email: text('email'),
		phone: text('phone'),
		whatsappPhone: text('whatsapp_phone'), // E.164 without '+', matches Meta's `from`
		country: text('country'),
		language: text('language'),
		source: sourceEnum('source').notNull().default('WEBSITE'),
		notes: text('notes'),
		externalReference: text('external_reference'),
		/** WhatsApp opt-out (STOP). Compliance state — no plan or admin overrides it. */
		whatsappOptedOut: boolean('whatsapp_opted_out').notNull().default(false),
		whatsappOptedOutAt: timestamp('whatsapp_opted_out_at', { withTimezone: true }),
		/** Last inbound WhatsApp message — drives Meta's 24-hour service window. */
		lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		index('customers_tenant_idx').on(t.tenantId, t.createdAt),
		uniqueIndex('customers_tenant_whatsapp_key')
			.on(t.tenantId, t.whatsappPhone)
			.where(sql`${t.whatsappPhone} is not null`),
		uniqueIndex('customers_tenant_email_key')
			.on(t.tenantId, sql`lower(${t.email})`)
			.where(sql`${t.email} is not null`),
		index('customers_tenant_phone_idx').on(t.tenantId, t.phone)
	]
);

export const leads = pgTable(
	'leads',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		stage: leadStageEnum('stage').notNull().default('NEW'),
		source: sourceEnum('source').notNull().default('WEBSITE'),
		title: text('title'),
		notes: text('notes'),
		value: money('value'),
		currency: text('currency'),
		assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
		lostReason: text('lost_reason'),
		externalReference: text('external_reference'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('leads_tenant_stage_idx').on(t.tenantId, t.stage, t.createdAt),
		index('leads_customer_idx').on(t.customerId)
	]
);

export const conversations = pgTable(
	'conversations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		channel: channelEnum('channel').notNull().default('WHATSAPP'),
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
		bookingRequestId: uuid('booking_request_id'),
		whatsappConnectionId: uuid('whatsapp_connection_id').references(() => whatsappConnections.id, {
			onDelete: 'set null'
		}),
		externalId: text('external_id'), // WhatsApp: the customer's wa phone
		subject: text('subject'),
		isOpen: boolean('is_open').notNull().default(true),
		visibility: conversationVisibilityEnum('visibility').notNull().default('TEAM'),
		assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
		/** Explicit per-user shares for PRIVATE threads ("selected staff"). */
		sharedWithUserIds: jsonb('shared_with_user_ids')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
		unreadCount: integer('unread_count').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('conversations_tenant_idx').on(t.tenantId, t.lastMessageAt),
		uniqueIndex('conversations_tenant_channel_external_key')
			.on(t.tenantId, t.channel, t.externalId)
			.where(sql`${t.externalId} is not null`)
	]
);

export const messages = pgTable(
	'messages',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		direction: messageDirectionEnum('direction').notNull(),
		channel: channelEnum('channel').notNull().default('WHATSAPP'),
		status: messageStatusEnum('status').notNull().default('QUEUED'),
		type: text('type').notNull().default('text'), // text | template | image | document | interactive
		body: text('body'),
		payload: jsonb('payload')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		// Meta's message id — globally unique, the idempotency anchor for webhooks (§9, §25)
		waMessageId: text('wa_message_id'),
		fromAddress: text('from_address'),
		toAddress: text('to_address'),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('messages_wa_message_id_key')
			.on(t.waMessageId)
			.where(sql`${t.waMessageId} is not null`),
		index('messages_conversation_idx').on(t.conversationId, t.createdAt),
		index('messages_tenant_idx').on(t.tenantId, t.createdAt)
	]
);

/* ------------------------------------------------- §12 booking requests ---- */

export const bookingRequests = pgTable(
	'booking_requests',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		reference: text('reference').notNull(), // EMN-RQ-2026-00001 — tenant-unique (§25)
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
		conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
		source: sourceEnum('source').notNull().default('WEBSITE'),
		status: bookingRequestStatusEnum('status').notNull().default('NEW'),
		currency: text('currency').notNull().default('USD'),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		adults: integer('adults').notNull().default(1),
		children: integer('children').notNull().default(0),
		estimatedTotal: money('estimated_total'),
		notes: text('notes'),
		assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
		// §13 — the client website keeps its own catalog; we only reference it.
		/** The marketplace listing this enquiry came from, when it came from one. */
		tourId: uuid('tour_id'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		convertedBookingId: uuid('converted_booking_id'),
		// Soft delete. A hard delete cascades into the trip and orphans
		// payments, so a swipe on a phone hides the row and nothing more.
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('booking_requests_tenant_reference_key').on(t.tenantId, t.reference),
		index('booking_requests_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
		index('booking_requests_customer_idx').on(t.customerId)
	]
);

export const bookingRequestItems = pgTable(
	'booking_request_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingRequestId: uuid('booking_request_id')
			.notNull()
			.references(() => bookingRequests.id, { onDelete: 'cascade' }),
		type: bookingItemTypeEnum('type').notNull().default('TOUR'),
		title: text('title').notNull(),
		description: text('description'),
		quantity: integer('quantity').notNull().default(1),
		unitPrice: money('unit_price'),
		total: money('total'),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('booking_request_items_request_idx').on(t.bookingRequestId)]
);

/** §15 — passport fields are optional at inquiry and access-controlled (see permissions). */
export const bookingRequestTravelers = pgTable(
	'booking_request_travelers',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingRequestId: uuid('booking_request_id')
			.notNull()
			.references(() => bookingRequests.id, { onDelete: 'cascade' }),
		firstName: text('first_name').notNull().default(''),
		lastName: text('last_name').notNull().default(''),
		nationality: text('nationality'),
		dateOfBirth: timestamp('date_of_birth', { withTimezone: true }),
		passportNumber: text('passport_number'),
		passportExpiry: timestamp('passport_expiry', { withTimezone: true }),
		dietaryRequirements: text('dietary_requirements'),
		specialRequests: text('special_requests'),
		isLead: boolean('is_lead').notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [index('booking_request_travelers_request_idx').on(t.bookingRequestId)]
);

export const bookingRequestNotes = pgTable(
	'booking_request_notes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingRequestId: uuid('booking_request_id')
			.notNull()
			.references(() => bookingRequests.id, { onDelete: 'cascade' }),
		authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
		body: text('body').notNull(),
		isInternal: boolean('is_internal').notNull().default(true),
		createdAt: createdAt()
	},
	(t) => [index('booking_request_notes_request_idx').on(t.bookingRequestId, t.createdAt)]
);

/* --------------------------------------------------------- §14 bookings ---- */

export const bookings = pgTable(
	'bookings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingReference: text('booking_reference').notNull(), // EMN-BK-2026-00001
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		bookingRequestId: uuid('booking_request_id').references(() => bookingRequests.id, { onDelete: 'set null' }),
		quotationId: uuid('quotation_id'),
		status: bookingStatusEnum('status').notNull().default('DRAFT'),
		currency: text('currency').notNull().default('USD'),
		subtotal: money('subtotal').notNull().default('0'),
		discount: money('discount').notNull().default('0'),
		tax: money('tax').notNull().default('0'),
		total: money('total').notNull().default('0'),
		amountPaid: money('amount_paid').notNull().default('0'),
		balanceDue: money('balance_due').notNull().default('0'),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		adults: integer('adults').notNull().default(1),
		children: integer('children').notNull().default(0),
		source: sourceEnum('source').notNull().default('WEBSITE'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		// Soft delete. A hard delete cascades into the trip and orphans
		// payments, so a swipe on a phone hides the row and nothing more.
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('bookings_tenant_reference_key').on(t.tenantId, t.bookingReference),
		index('bookings_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
		index('bookings_customer_idx').on(t.customerId)
	]
);

export const bookingItems = pgTable(
	'booking_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		type: bookingItemTypeEnum('type').notNull().default('TOUR'),
		title: text('title').notNull(),
		description: text('description'),
		quantity: integer('quantity').notNull().default(1),
		unitPrice: money('unit_price').notNull().default('0'),
		total: money('total').notNull().default('0'),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('booking_items_booking_idx').on(t.bookingId)]
);

export const bookingTravelers = pgTable(
	'booking_travelers',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		firstName: text('first_name').notNull().default(''),
		lastName: text('last_name').notNull().default(''),
		nationality: text('nationality'),
		dateOfBirth: timestamp('date_of_birth', { withTimezone: true }),
		passportNumber: text('passport_number'),
		passportExpiry: timestamp('passport_expiry', { withTimezone: true }),
		dietaryRequirements: text('dietary_requirements'),
		specialRequests: text('special_requests'),
		isLead: boolean('is_lead').notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [index('booking_travelers_booking_idx').on(t.bookingId)]
);

export const bookingNotes = pgTable(
	'booking_notes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
		body: text('body').notNull(),
		isInternal: boolean('is_internal').notNull().default(true),
		createdAt: createdAt()
	},
	(t) => [index('booking_notes_booking_idx').on(t.bookingId, t.createdAt)]
);

export const bookingStatusHistory = pgTable(
	'booking_status_history',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		fromStatus: bookingStatusEnum('from_status'),
		toStatus: bookingStatusEnum('to_status').notNull(),
		reason: text('reason'),
		changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		changedByApiKeyId: uuid('changed_by_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('booking_status_history_booking_idx').on(t.bookingId, t.createdAt)]
);

// ── trips ─────────────────────────────────────────────────────────────────────
//
// The operational half of a sale. A booking answers "what did they buy and have
// they paid"; a trip answers "can this actually depart". They are separate tables
// because they are separate jobs done by separate people at separate times — the
// agent who closed the sale is usually not the person confirming the hotel.
//
// A trip is CREATED FROM a booking and then diverges: operations may move a day,
// change a hotel or add a transfer without touching what the customer was sold.

export const trips = pgTable(
	'trips',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		tripReference: text('trip_reference').notNull(), // EMN-TR-2026-00001
		// The commercial record this came from. Kept for money and customer identity,
		// which the trip never duplicates.
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		status: tripStatusEnum('status').notNull().default('PREPARING'),
		title: text('title').notNull(),
		// The handover. Whoever owns getting this trip out of the door.
		operationsUserId: uuid('operations_user_id').references(() => users.id, { onDelete: 'set null' }),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		adults: integer('adults').notNull().default(1),
		children: integer('children').notNull().default(0),
		// Phase 1 keeps the crew as free text rather than as entities. A tenant's first
		// trips teach us the shape; promoting these to real records later is a
		// migration, whereas guessing the shape now and being wrong is a rewrite.
		vehicle: text('vehicle'),
		/*
		 * The registry link, paired with the snapshot above.
		 *
		 * Nullable and additive on purpose: `vehicle` text remains authoritative for
		 * readiness (the CHECKS entry and the blocked-trip SQL both read it), and a
		 * trip written before the registry existed must keep working untouched.
		 * Assigning from the registry writes BOTH.
		 */
		vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
		// The NAME stays on the trip as a snapshot, and the id links to the
		// registry. Two reasons for keeping both: a trip that ran last year must
		// still say who drove it even if that person has since left, and every
		// readiness check already reads these columns — so the registry can be
		// adopted without rewriting what "ready" means.
		driver: text('driver'),
		driverCrewId: uuid('driver_crew_id').references(() => crew.id, { onDelete: 'set null' }),
		guide: text('guide'),
		guideCrewId: uuid('guide_crew_id').references(() => crew.id, { onDelete: 'set null' }),
		// A seat of its own, not a guide by another name: a Kilimanjaro climb
		// carries a mountain guide AND a driver-guide, and a trip sheet that
		// called one of them "Guide" would be lying about who did what.
		specialist: text('specialist'),
		specialistCrewId: uuid('specialist_crew_id').references(() => crew.id, { onDelete: 'set null' }),
		accommodation: text('accommodation'),
		/**
		 * The directory property, where the night is at a listed one.
		 *
		 * Declared WITH its foreign key: this column already had one in the
		 * database (to the old catalog) that the schema file did not mention, and
		 * a migration failed on the constraint nobody knew was there.
		 */
		accommodationItemId: uuid('accommodation_item_id').references(() => accommodations.id, {
			onDelete: 'set null'
		}),
		hotelConfirmed: boolean('hotel_confirmed').notNull().default(false),
		notes: text('notes'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		readyAt: timestamp('ready_at', { withTimezone: true }),
		startedAt: timestamp('started_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('trips_tenant_reference_key').on(t.tenantId, t.tripReference),
		// At most one LIVE trip per booking. Two departures for one sale is always a
		// mistake, and a constraint is cheaper than the code that would have to
		// detect it — but a cancelled trip must not block the sale from being handed
		// over again, so the index is partial (see 0017).
		uniqueIndex('trips_booking_live_key')
			.on(t.bookingId)
			.where(sql`${t.status} <> 'CANCELLED'`),
		index('trips_tenant_status_idx').on(t.tenantId, t.status, t.startDate),
		// The operations home screen's only query: my trips, soonest first.
		index('trips_operations_idx').on(t.tenantId, t.operationsUserId, t.startDate),
		// One per link column: the crew scope ORs across all three, and Postgres
		// cannot serve an OR from a single composite index. Partial, because most
		// trips leave these null and indexing nulls buys nothing (see 0020).
		index('trips_driver_crew_idx').on(t.driverCrewId).where(sql`${t.driverCrewId} is not null`),
		index('trips_guide_crew_idx').on(t.guideCrewId).where(sql`${t.guideCrewId} is not null`),
		index('trips_specialist_crew_idx').on(t.specialistCrewId).where(sql`${t.specialistCrewId} is not null`)
	]
);

/** What actually happens on the ground, copied forward from the booking's items. */
export const tripItems = pgTable(
	'trip_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		// Same vocabulary as booking items — TOUR, HOTEL, ROOM, TRANSFER, ACTIVITY,
		// PARK_FEE — so a copied line keeps its meaning.
		type: bookingItemTypeEnum('type').notNull().default('TOUR'),
		title: text('title').notNull(),
		description: text('description'),
		// Deliberately NO price. The moment operations can change a number the customer
		// was quoted, the booking stops being the truth about what was sold.
		dayNumber: integer('day_number'),
		sortOrder: integer('sort_order').notNull().default(0),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		confirmed: boolean('confirmed').notNull().default(false),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('trip_items_trip_idx').on(t.tripId, t.dayNumber, t.sortOrder)]
);

/** A tenant's drivers, guides and specialists. */
export const crew = pgTable(
	'crew',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		type: crewTypeEnum('type').notNull().default('DRIVER'),
		name: text('name').notNull(),
		phone: text('phone'),
		email: text('email'),
		/** Driving licence, guiding licence, or whatever the tenant tracks. */
		licenceNumber: text('licence_number'),
		notes: text('notes'),
		/** Optional: the same person as a portal user, once they need the app. */
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		// Where this person came from. A synced record is keyed on the source id so
		// re-syncing updates rather than duplicates; a record added by hand in the
		// portal has neither, and a sync must never touch it — somebody typed that
		// person in precisely because the source did not have them.
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		// Deactivated rather than deleted: a trip that ran last year still names
		// the driver who ran it, and deleting the row would rewrite that history.
		isActive: boolean('is_active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('crew_tenant_type_idx').on(t.tenantId, t.type, t.isActive),
		index('crew_user_idx').on(t.userId),
		index('crew_source_idx').on(t.tenantId, t.externalSource, t.externalReference)
	]
);

/**
 * The vehicles a tenant runs, and where a tracker is mapped to them.
 *
 * A twin of `crew`, deliberately: same ownership, same deactivate-never-delete
 * rule, same provenance columns. A trip has always NAMED its vehicle as free
 * text, which is right for "2x Land Cruiser T 123 ABC / T 456 DEF" and wrong for
 * "which physical vehicle is this, and where is it". This is the promotion the
 * comment on trips.vehicle already prescribes — the text snapshot stays, and the
 * id points at the registry.
 *
 * The tracker lives on this row rather than in its own table because V1 maps one
 * device to one vehicle and stores NO positions: a join table would buy nothing
 * until trackers move between vehicles. The ceiling, stated plainly: swapping a
 * tracker between vehicles keeps no history of the swap.
 */
export const vehicles = pgTable(
	'vehicles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		/** What an operator calls it on the radio: "Land Cruiser 3". */
		name: text('name').notNull(),
		/** The plate. The vehicle's analogue of crew.licence_number. */
		registration: text('registration'),
		make: text('make'),
		model: text('model'),
		/** Free-form on purpose — 4X4, MINIBUS, SEDAN, BOAT. Not a lifecycle, so not an enum. */
		type: text('type'),
		seats: integer('seats'),
		notes: text('notes'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		// Deactivated rather than deleted, for the same reason as crew: a trip that
		// ran last year still names the vehicle that ran it.
		isActive: boolean('is_active').notNull().default(true),

		/* ---------------------------------------------------------- tracking ---- */

		/** Named by provider so the column outlives the provider. 'TRACCAR' today. */
		trackerProvider: text('tracker_provider'),
		/*
		 * The provider's identifier for the tracker.
		 *
		 * NOT called device_id: `device_tokens` and /api/mobile/v1/devices already
		 * own the word "device" in this schema and mean a Firebase push handle.
		 */
		trackerDeviceRef: text('tracker_device_ref'),
		trackerLinkedAt: timestamp('tracker_linked_at', { withTimezone: true }),
		/** The ledger row that authorises this mapping. The ledger is the authority. */
		trackerEnrollmentId: uuid('tracker_enrollment_id'),

		/*
		 * The newest fix, cached as ONE row — not a time series.
		 *
		 * The tracking provider stays the source of truth for history (V1 stores no
		 * position table). This exists so a trip list can say "last seen 2h ago"
		 * without calling out to the provider once per row.
		 */
		lastFixAt: timestamp('last_fix_at', { withTimezone: true }),
		lastFixLat: numeric('last_fix_lat', { precision: 9, scale: 6 }),
		lastFixLng: numeric('last_fix_lng', { precision: 9, scale: 6 }),
		lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
		lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
		lastErrorCode: text('last_error_code'),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('vehicles_tenant_active_idx').on(t.tenantId, t.isActive),
		index('vehicles_source_idx').on(t.tenantId, t.externalSource, t.externalReference),
		/*
		 * GLOBALLY unique, not tenant-scoped, and that is the point.
		 *
		 * On a shared tracking server the device reference is what says whose
		 * position stream this is. Scoped per tenant, tenant B could map tenant A's
		 * device and quietly receive its positions. The cost is real and accepted:
		 * two tenants cannot share one physical tracker.
		 */
		uniqueIndex('vehicles_tracker_ref_key')
			.on(t.trackerProvider, t.trackerDeviceRef)
			.where(sql`${t.trackerDeviceRef} is not null`)
	]
);

export const tripStatusHistory = pgTable(
	'trip_status_history',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		fromStatus: tripStatusEnum('from_status'),
		toStatus: tripStatusEnum('to_status').notNull(),
		reason: text('reason'),
		changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		changedByApiKeyId: uuid('changed_by_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('trip_status_history_trip_idx').on(t.tripId, t.createdAt)]
);

/* ------------------------------------------------------- §16 quotations ---- */

export const quotations = pgTable(
	'quotations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		reference: text('reference').notNull(), // EMN-QT-2026-00001
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
		bookingRequestId: uuid('booking_request_id').references(() => bookingRequests.id, { onDelete: 'set null' }),
		conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
		status: quotationStatusEnum('status').notNull().default('DRAFT'),
		version: integer('version').notNull().default(1),
		currency: text('currency').notNull().default('USD'),
		subtotal: money('subtotal').notNull().default('0'),
		discount: money('discount').notNull().default('0'),
		tax: money('tax').notNull().default('0'),
		total: money('total').notNull().default('0'),
		validUntil: timestamp('valid_until', { withTimezone: true }),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		adults: integer('adults').notNull().default(1),
		children: integer('children').notNull().default(0),
		notes: text('notes'),
		terms: text('terms'),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		viewedAt: timestamp('viewed_at', { withTimezone: true }),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		declinedAt: timestamp('declined_at', { withTimezone: true }),
		convertedBookingId: uuid('converted_booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		/**
		 * The traveller's way in. Minted on first send, never guessable, and the
		 * only credential the public quotation page accepts — there is no login
		 * on the customer side of this product.
		 */
		publicToken: text('public_token'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		// Soft delete: a quotation can be the provenance of a booking, so it is
		// hidden rather than destroyed. Also the only way a deletion in the
		// source system can be expressed here — the mirror only pushes what
		// still exists (0025).
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('quotations_tenant_reference_key').on(t.tenantId, t.reference),
		index('quotations_tenant_status_idx').on(t.tenantId, t.status, t.createdAt)
	]
);

export const quotationItems = pgTable(
	'quotation_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		quotationId: uuid('quotation_id')
			.notNull()
			.references(() => quotations.id, { onDelete: 'cascade' }),
		type: bookingItemTypeEnum('type').notNull().default('TOUR'),
		title: text('title').notNull(),
		description: text('description'),
		quantity: integer('quantity').notNull().default(1),
		unitPrice: money('unit_price').notNull().default('0'),
		total: money('total').notNull().default('0'),
		startDate: timestamp('start_date', { withTimezone: true }),
		endDate: timestamp('end_date', { withTimezone: true }),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [index('quotation_items_quotation_idx').on(t.quotationId, t.sortOrder)]
);

/** Immutable snapshot of a quotation each time it is (re)sent. */
export const quotationVersions = pgTable(
	'quotation_versions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		quotationId: uuid('quotation_id')
			.notNull()
			.references(() => quotations.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('quotation_versions_quotation_version_key').on(t.quotationId, t.version)]
);

/* --------------------------------------------------------- §19 payments ---- */

export const payments = pgTable(
	'payments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		orderId: uuid('order_id'), // nullable commerce link; FK added in migration, bookings unaffected
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		reference: text('reference').notNull(), // EMN-PY-2026-00001
		provider: text('provider').notNull().default('MANUAL'), // STRIPE|FLUTTERWAVE|PESAPAL|AZAMPAY|BANK_TRANSFER|MANUAL
		providerPaymentId: text('provider_payment_id'),
		status: paymentStatusEnum('status').notNull().default('PENDING'),
		currency: text('currency').notNull().default('USD'),
		amount: money('amount').notNull().default('0'),
		amountRefunded: money('amount_refunded').notNull().default('0'),
		description: text('description'),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		failureCode: text('failure_code'),
		failureMessage: text('failure_message'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('payments_tenant_reference_key').on(t.tenantId, t.reference),
		uniqueIndex('payments_provider_payment_key')
			.on(t.provider, t.providerPaymentId)
			.where(sql`${t.providerPaymentId} is not null`),
		index('payments_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
		index('payments_booking_idx').on(t.bookingId)
	]
);

/**
 * A payment REQUEST: the unit of "please pay X for Y" (§payment-workflow brief).
 *
 * Distinct from `payments` (money actually recorded): a request is asked, maybe
 * reported by the customer, then verified — at which point a real payments row is
 * created through the existing createPayment path and the two are linked. A booking
 * can carry several requests over its life (deposit now, balance later); history is
 * never overwritten.
 */
// A payment request RESTRICTS its parent rather than cascading from it: a hard
// delete of the booking, order or quotation must fail loudly instead of taking
// the money records with it (0027). tenant_id still cascades — removing a
// tenant is meant to take everything.
export const paymentRequests = pgTable(
	'payment_requests',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
		quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'restrict' }),
		conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
		status: paymentRequestStatusEnum('status').notNull().default('REQUESTED'),
		amountRequested: money('amount_requested').notNull(),
		amountReceived: money('amount_received').notNull().default('0'),
		currency: text('currency').notNull().default('USD'),
		/** Key of the tenant payment method presented to the customer (settings.paymentMethods). */
		methodKey: text('method_key'),
		methodLabel: text('method_label'),
		/** Immutable, display-only snapshot of the instructions shown when this request was sent. */
		methodDetails: jsonb('method_details')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/** Customer-facing reference to put on the transfer; normally the transaction reference. */
		paymentReference: text('payment_reference'),
		note: text('note'),
		requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		/** Local outbound message row, used to audit delivery/read without parsing message bodies. */
		requestMessageId: uuid('request_message_id').references(() => messages.id, { onDelete: 'set null' }),
		reportedAt: timestamp('reported_at', { withTimezone: true }),
		/** WhatsApp message id of the customer's "I have paid" press, for traceability. */
		reportedMessageId: text('reported_message_id'),
		/** Short-lived compare-and-set lock that prevents two staff confirmations recording money twice. */
		verificationStartedAt: timestamp('verification_started_at', { withTimezone: true }),
		verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		verifiedAt: timestamp('verified_at', { withTimezone: true }),
		/** The payments row created at verification — the actual money record. */
		paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
		lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('payment_requests_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
		index('payment_requests_booking_idx').on(t.bookingId),
		index('payment_requests_order_idx').on(t.orderId),
		index('payment_requests_customer_idx').on(t.customerId),
		index('payment_requests_conversation_idx').on(t.conversationId),
		uniqueIndex('payment_requests_reported_message_key')
			.on(t.tenantId, t.reportedMessageId)
			.where(sql`${t.reportedMessageId} is not null`),
		// The select-before-insert check in createPaymentRequest is friendly UX; these
		// indexes are the actual concurrency guarantee for double-clicked requests.
		uniqueIndex('payment_requests_active_booking_amount_key')
			.on(t.tenantId, t.bookingId, t.amountRequested)
			.where(sql`${t.bookingId} is not null and ${t.status} in ('REQUESTED','REPORTED','PARTIALLY_PAID')`),
		uniqueIndex('payment_requests_active_order_amount_key')
			.on(t.tenantId, t.orderId, t.amountRequested)
			.where(sql`${t.orderId} is not null and ${t.status} in ('REQUESTED','REPORTED','PARTIALLY_PAID')`),
		uniqueIndex('payment_requests_active_quotation_amount_key')
			.on(t.tenantId, t.quotationId, t.amountRequested)
			.where(sql`${t.quotationId} is not null and ${t.status} in ('REQUESTED','REPORTED','PARTIALLY_PAID')`)
	]
);

export const paymentTransactions = pgTable(
	'payment_transactions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		paymentId: uuid('payment_id')
			.notNull()
			.references(() => payments.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(), // authorize | capture | charge | refund | webhook
		status: paymentStatusEnum('status').notNull().default('PENDING'),
		amount: money('amount').notNull().default('0'),
		currency: text('currency').notNull().default('USD'),
		providerReference: text('provider_reference'),
		rawResponse: jsonb('raw_response')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('payment_transactions_payment_idx').on(t.paymentId, t.createdAt)]
);

export const refunds = pgTable(
	'refunds',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		paymentId: uuid('payment_id')
			.notNull()
			.references(() => payments.id, { onDelete: 'cascade' }),
		amount: money('amount').notNull().default('0'),
		currency: text('currency').notNull().default('USD'),
		reason: text('reason'),
		status: paymentStatusEnum('status').notNull().default('PENDING'),
		providerRefundId: text('provider_refund_id'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('refunds_payment_idx').on(t.paymentId)]
);

/* -------------------------------------- §20 notifications + client hooks ---- */

export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		channel: notificationChannelEnum('channel').notNull(),
		event: text('event').notNull(),
		status: notificationStatusEnum('status').notNull().default('PENDING'),
		recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'cascade' }),
		recipientAddress: text('recipient_address'),
		title: text('title'),
		body: text('body'),
		entityType: text('entity_type'),
		entityId: text('entity_id'),
		payload: jsonb('payload')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		readAt: timestamp('read_at', { withTimezone: true }),
		errorMessage: text('error_message'),
		createdAt: createdAt()
	},
	(t) => [
		index('notifications_tenant_idx').on(t.tenantId, t.createdAt),
		index('notifications_recipient_idx').on(t.recipientUserId, t.readAt)
	]
);

export const webhookEndpoints = pgTable(
	'webhook_endpoints',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		description: text('description'),
		// Per-tenant signing secret (§20). Encrypted at rest like every other credential.
		encryptedSecret: text('encrypted_secret').notNull(),
		keyVersion: integer('key_version').notNull().default(1),
		events: jsonb('events')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		isActive: boolean('is_active').notNull().default(true),
		lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
		lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('webhook_endpoints_tenant_idx').on(t.tenantId, t.isActive)]
);

export const webhookDeliveries = pgTable(
	'webhook_deliveries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		endpointId: uuid('endpoint_id')
			.notNull()
			.references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
		event: text('event').notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		status: jobStatusEnum('status').notNull().default('PENDING'),
		attempts: integer('attempts').notNull().default(0),
		responseStatus: integer('response_status'),
		responseBody: text('response_body'),
		errorMessage: text('error_message'),
		nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
		index('webhook_deliveries_pending_idx').on(t.status, t.nextRetryAt)
	]
);

/* ---------------------------------------------- §27 billing and usage ---- */

export const subscriptions = pgTable(
	'subscriptions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		planId: uuid('plan_id')
			.notNull()
			.references(() => plans.id, { onDelete: 'restrict' }),
		status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
		currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull().defaultNow(),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
		/** Set while status is TRIALING; null once the tenant is on a paid period. */
		trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('subscriptions_tenant_idx').on(t.tenantId, t.status)]
);

export const subscriptionInvoices = pgTable(
	'subscription_invoices',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		subscriptionId: uuid('subscription_id')
			.notNull()
			.references(() => subscriptions.id, { onDelete: 'cascade' }),
		number: text('number').notNull(),
		status: text('status').notNull().default('OPEN'), // OPEN | PAID | VOID | UNCOLLECTIBLE
		currency: text('currency').notNull().default('USD'),
		amountDue: money('amount_due').notNull().default('0'),
		amountPaid: money('amount_paid').notNull().default('0'),
		periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
		paidAt: timestamp('paid_at', { withTimezone: true }),
		lineItems: jsonb('line_items')
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('subscription_invoices_number_key').on(t.number),
		index('subscription_invoices_tenant_idx').on(t.tenantId)
	]
);

/** One row per tenant/metric/period bucket; incremented atomically by recordUsage(). */
export const usageRecords = pgTable(
	'usage_records',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		metric: text('metric').notNull(), // api_requests | whatsapp_out | booking_requests | …
		period: text('period').notNull(), // YYYY-MM
		quantity: integer('quantity').notNull().default(0),
		updatedAt: updatedAt(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('usage_records_tenant_metric_period_key').on(t.tenantId, t.metric, t.period)]
);

/* ------------------------------------------------------- §28 infra ------- */

/** Idempotency-Key support for write operations (§28). */
export const idempotencyKeys = pgTable(
	'idempotency_keys',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		endpoint: text('endpoint').notNull(),
		requestFingerprint: text('request_fingerprint').notNull(), // sha-256 of method+path+body
		status: text('status').notNull().default('IN_PROGRESS'), // IN_PROGRESS | COMPLETED
		responseStatus: integer('response_status'),
		responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
		lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('idempotency_keys_tenant_endpoint_key').on(t.tenantId, t.endpoint, t.key),
		index('idempotency_keys_expiry_idx').on(t.expiresAt)
	]
);

/** Postgres-backed job queue — no extra infrastructure required (§28). */
export const jobs = pgTable(
	'jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		payload: jsonb('payload')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		status: jobStatusEnum('status').notNull().default('PENDING'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		lastError: text('last_error'),
		// Optional de-duplication handle: "wa-send:<messageId>" etc.
		dedupeKey: text('dedupe_key'),
		createdAt: createdAt()
	},
	(t) => [
		index('jobs_claim_idx').on(t.status, t.runAt),
		uniqueIndex('jobs_dedupe_key_key')
			.on(t.dedupeKey)
			.where(sql`${t.dedupeKey} is not null`)
	]
);

/** Fixed-window rate limit counters, per tenant/plan — never one global limit (§28). */
export const rateLimitCounters = pgTable(
	'rate_limit_counters',
	{
		bucket: text('bucket').primaryKey(), // "<scope>:<window-start-epoch>"
		count: integer('count').notNull().default(0),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [index('rate_limit_counters_expiry_idx').on(t.expiresAt)]
);

/** Atomic, gap-free reference sequences — the database-safe alternative to COUNT+1 (§14). */
export const referenceCounters = pgTable(
	'reference_counters',
	{
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(), // RQ | BK | QT | PY
		year: integer('year').notNull(),
		value: integer('value').notNull().default(0)
	},
	(t) => [uniqueIndex('reference_counters_pk').on(t.tenantId, t.kind, t.year)]
);

/** Processed Meta webhook events — makes inbound processing idempotent (§9). */
export const webhookEvents = pgTable(
	'webhook_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		provider: text('provider').notNull().default('meta'),
		externalId: text('external_id').notNull(), // wamid / status id
		kind: text('kind').notNull(),
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		payload: jsonb('payload')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		processedAt: timestamp('processed_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('webhook_events_provider_external_key').on(t.provider, t.externalId, t.kind)]
);

/* ------------------------------------------------------------ relations --- */

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
	memberships: many(tenantMemberships),
	apiKeys: many(apiKeys),
	customers: many(customers),
	plan: one(plans, { fields: [tenants.planId], references: [plans.id] })
}));

export const usersRelations = relations(users, ({ many }) => ({
	memberships: many(tenantMemberships),
	sessions: many(sessions)
}));

export const tenantMembershipsRelations = relations(tenantMemberships, ({ one }) => ({
	tenant: one(tenants, { fields: [tenantMemberships.tenantId], references: [tenants.id] }),
	user: one(users, { fields: [tenantMemberships.userId], references: [users.id] })
}));

export const bookingRequestsRelations = relations(bookingRequests, ({ one, many }) => ({
	customer: one(customers, { fields: [bookingRequests.customerId], references: [customers.id] }),
	lead: one(leads, { fields: [bookingRequests.leadId], references: [leads.id] }),
	conversation: one(conversations, { fields: [bookingRequests.conversationId], references: [conversations.id] }),
	items: many(bookingRequestItems),
	travelers: many(bookingRequestTravelers),
	notes: many(bookingRequestNotes)
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
	customer: one(customers, { fields: [bookings.customerId], references: [customers.id] }),
	request: one(bookingRequests, { fields: [bookings.bookingRequestId], references: [bookingRequests.id] }),
	items: many(bookingItems),
	travelers: many(bookingTravelers),
	notes: many(bookingNotes),
	statusHistory: many(bookingStatusHistory),
	payments: many(payments)
}));

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
	customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
	request: one(bookingRequests, { fields: [quotations.bookingRequestId], references: [bookingRequests.id] }),
	items: many(quotationItems),
	versions: many(quotationVersions)
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
	customer: one(customers, { fields: [conversations.customerId], references: [customers.id] }),
	lead: one(leads, { fields: [conversations.leadId], references: [leads.id] }),
	messages: many(messages)
}));

export const messagesRelations = relations(messages, ({ one }) => ({
	conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] })
}));

/* ------------------------------------------------------- inferred types --- */

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type VerificationPurpose = (typeof verificationPurposeEnum.enumValues)[number];
export type ProvisioningSource = (typeof provisioningSourceEnum.enumValues)[number];
export type ApiKey = typeof apiKeys.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type WhatsappConnection = typeof whatsappConnections.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type BookingRequest = typeof bookingRequests.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Crew = typeof crew.$inferSelect;
/**
 * A tenant's own identity on the tracking provider.
 *
 * Connect used to hold ONE administrator credential for the whole platform, so
 * the provider's permission system was doing nothing and isolation existed only
 * because Connect remembered to filter its own results. Each tenant now has a
 * read-only provider identity scoped to its own devices, which makes a
 * cross-tenant position unreachable AT THE PROVIDER rather than merely
 * unrendered here.
 *
 * The password uses the same AES-256-GCM envelope as WhatsApp tokens, so this
 * codebase has one encryption story rather than two.
 */
export const trackingAccounts = pgTable(
	'tracking_accounts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// RESTRICT: deleting a tenant that still owns a provider identity would
		// strand a user and its devices with nothing in Connect naming them.
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		provider: text('provider').notNull().default('TRACCAR'),
		/** Non-routable by RFC 2606 — this address must never receive mail. */
		providerLogin: text('provider_login').notNull(),
		providerUserId: integer('provider_user_id'),
		/** v<keyVersion>.<iv>.<tag>.<ciphertext>, never logged, never rendered. */
		encryptedPassword: text('encrypted_password').notNull(),
		keyVersion: integer('key_version').notNull().default(1),
		/** Proven read-only and correctly scoped. Null = provisioned, not proven. */
		verifiedAt: timestamp('verified_at', { withTimezone: true }),
		disabledAt: timestamp('disabled_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('tracking_accounts_tenant_provider_key').on(t.tenantId, t.provider),
		uniqueIndex('tracking_accounts_provider_user_key')
			.on(t.provider, t.providerUserId)
			.where(sql`provider_user_id IS NOT NULL`)
	]
);

export type TrackingAccount = typeof trackingAccounts.$inferSelect;

/**
 * Who owns a tracker, and the proof.
 *
 * Ownership used to flow the wrong way — the tracker existed first and a tenant
 * claimed it by naming it, so knowledge equalled control. Here Connect mints the
 * reference for a named vehicle of a named tenant BEFORE the provider is
 * touched, and the first fix proves LIVENESS rather than ownership.
 *
 * A minted reference is used once and burned. A retired phone flushing its
 * offline buffer into a different vehicle's track is the failure that rule
 * prevents, and 200 bytes per retirement is the whole cost.
 */
export const trackerEnrollments = pgTable(
	'tracker_enrollments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// RESTRICT on both parents: a cascade would release the forever-lock on a
		// reference whose physical device may still be reporting.
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		vehicleId: uuid('vehicle_id')
			.notNull()
			.references(() => vehicles.id, { onDelete: 'restrict' }),
		provider: text('provider').notNull().default('TRACCAR'),
		/** Credential material. Never rendered after the setup screen. */
		deviceRef: text('device_ref').notNull(),
		/** MINTED | ADMIN_ASSERTED | LEGACY */
		identifierSource: text('identifier_source').notNull(),
		/** PHONE | HARDWARE */
		kind: text('kind').notNull(),
		profile: text('profile').notNull().default('SAFARI'),
		/** What the operator calls it — "Juma's phone". The reference is not shown. */
		label: text('label'),
		/** PENDING | ACTIVE | CLOSED | RELEASED */
		status: text('status').notNull(),
		closedReason: text('closed_reason'),
		trust: text('trust').notNull().default('VERIFIED'),
		providerDeviceId: integer('provider_device_id'),
		providerDeleteAfter: timestamp('provider_delete_after', { withTimezone: true }),
		hardwareSimMsisdn: text('hardware_sim_msisdn'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		boundAt: timestamp('bound_at', { withTimezone: true }),
		confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		supersededById: uuid('superseded_by_id'),
		firstFixAt: timestamp('first_fix_at', { withTimezone: true }),
		firstFixLat: numeric('first_fix_lat', { precision: 9, scale: 6 }),
		firstFixLng: numeric('first_fix_lng', { precision: 9, scale: 6 }),
		pollAttempts: integer('poll_attempts').notNull().default(0),
		lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`)
	},
	(t) => [
		uniqueIndex('te_ref_forever_key').on(t.provider, t.deviceRef).where(sql`status <> 'RELEASED'`),
		uniqueIndex('te_one_pending_key').on(t.vehicleId).where(sql`status = 'PENDING'`),
		uniqueIndex('te_one_active_key').on(t.vehicleId).where(sql`status = 'ACTIVE'`),
		index('te_pending_idx').on(t.status, t.expiresAt).where(sql`status = 'PENDING'`),
		index('te_tenant_idx').on(t.tenantId, t.createdAt),
		index('te_gc_idx').on(t.providerDeleteAfter).where(sql`provider_delete_after IS NOT NULL`)
	]
);

export type TrackerEnrollment = typeof trackerEnrollments.$inferSelect;


export type Vehicle = typeof vehicles.$inferSelect;
export type TripItem = typeof tripItems.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type WhatsappOnboardingSession = typeof whatsappOnboardingSessions.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];

/* ========================= Conversational commerce: orders + forms ======= */
/* All additive. Nothing above this line changed — the booking domain keeps  */
/* its exact shape and behaviour.                                            */

export const orderStatusEnum = pgEnum('order_status', [
	'DRAFT',
	'PENDING_CONFIRMATION',
	'CONFIRMED',
	'PROCESSING',
	'READY',
	'DISPATCHED',
	'DELIVERED',
	'CANCELLED',
	'REFUNDED'
]);

export const orderPaymentStatusEnum = pgEnum('order_payment_status', [
	'UNPAID',
	'PARTIALLY_PAID',
	'PAID',
	'REFUNDED',
	'FAILED'
]);

/** Acquisition channels for commerce — deliberately wider than the booking `source`
 *  enum, which stays untouched. */
export const orderSourceEnum = pgEnum('order_source', [
	'WHATSAPP_DIRECT',
	'WHATSAPP_STATUS',
	// The merchant records that the customer came from a group they run. Connect never
	// reads or scrapes groups — this is provenance the staff member types in.
	'WHATSAPP_GROUP',
	'WEBSITE',
	'INSTAGRAM',
	'FACEBOOK',
	'MANUAL',
	'API',
	'PHONE',
	'WALK_IN',
	// A public Connect-hosted Order Link (/o/<publicId>) — one offer, one form.
	'ORDER_LINK',
	'OTHER'
]);

export const orderBatchStatusEnum = pgEnum('order_batch_status', ['OPEN', 'CLOSED']);


export const deliveryMethodEnum = pgEnum('delivery_method', ['DELIVERY', 'PICKUP']);

export const formTypeEnum = pgEnum('form_type', ['BOOKING', 'ORDER', 'QUOTE', 'LEAD']);


/**
 * Order Batch — one selling round with shared defaults (§fish-seller workflow).
 *
 * "Saturday Fish Delivery — 4 July: Fresh Fish, KG, TZS 14,000" is created once; each
 * order in the batch then only needs a customer and a quantity. This replaces the
 * numbered list the seller maintains by hand inside a WhatsApp message. It is NOT
 * inventory: nothing is reserved, counted or forecast.
 */
export const orderBatches = pgTable(
	'order_batches',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		status: orderBatchStatusEnum('status').notNull().default('OPEN'),
		/** The day everyone gets their fish. Inherited by orders created in the batch. */
		fulfilmentDate: timestamp('fulfilment_date', { withTimezone: true }),
		defaultItemTitle: text('default_item_title').notNull(),
		defaultUnit: text('default_unit'),
		defaultUnitPrice: money('default_unit_price').notNull().default('0'),
		currency: text('currency').notNull().default('USD'),
		defaultDeliveryMethod: deliveryMethodEnum('default_delivery_method'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('order_batches_tenant_idx').on(t.tenantId, t.status, t.fulfilmentDate)]
);

/**
 * Every AI call, metered. Written AFTER the call with real token counts so spend is
 * visible per tenant and per feature, and so the monthly ceiling has something honest
 * to count. Deliberately append-only: this is a ledger, not a cache.
 */
export const aiUsage = pgTable(
	'ai_usage',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		/** Which surface spent it — 'order_extraction' today, more later. */
		feature: text('feature').notNull(),
		model: text('model').notNull(),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
		cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
		/** Estimated USD at first-party list prices — for visibility, not billing.
		 *  6dp, not money()'s 2dp: one extraction costs a fraction of a cent and
		 *  would otherwise round to zero, making the whole ledger read 0.00. */
		costUsd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
		ok: boolean('ok').notNull().default(true),
		/** ACCEPTED | EDITED | DISCARDED once a human acts on the suggestion. Null
		 *  means "not yet decided" — the honest state, not a silent success. */
		outcome: text('outcome'),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('ai_usage_tenant_idx').on(t.tenantId, t.createdAt)]
);

export type AiUsage = typeof aiUsage.$inferSelect;

export const orderLinkStatusEnum = pgEnum('order_link_status', ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);

/**
 * Order Link — ONE offer behind ONE public link (§order-links). A WhatsApp-group
 * seller posts /o/<publicId>; customers submit a tiny form; the submission flows
 * through the canonical createOrder(). Deliberately NOT ecommerce: no cart, no
 * browsing, no inventory. "Expired" is computed from `deadline`, never stored.
 */
export const orderLinks = pgTable(
	'order_links',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		/** The ONLY identifier the public ever sees. */
		publicId: text('public_id').notNull(),
		status: orderLinkStatusEnum('status').notNull().default('DRAFT'),
		title: text('title').notNull(),
		description: text('description'),
		imageUrl: text('image_url'),
		/** KG, Piece, Pack… free text — presets are a UI convenience, never an enum. */
		unit: text('unit').notNull().default('Piece'),
		unitPrice: money('unit_price').notNull().default('0'),
		currency: text('currency').notNull().default('TZS'),
		minQuantity: integer('min_quantity').notNull().default(1),
		maxQuantity: integer('max_quantity'),
		/** Optional total capacity across all orders (e.g. 200 KG). Not inventory. */
		capacityTotal: integer('capacity_total'),
		/** Orders close automatically after this moment. */
		deadline: timestamp('deadline', { withTimezone: true }),
		deliveryDate: timestamp('delivery_date', { withTimezone: true }),
		pickupEnabled: boolean('pickup_enabled').notNull().default(true),
		deliveryEnabled: boolean('delivery_enabled').notNull().default(true),
		deliveryFee: money('delivery_fee').notNull().default('0'),
		/** Predefined field visibility: { email|deliveryLocation|note: HIDDEN|OPTIONAL|REQUIRED } */
		fieldConfig: jsonb('field_config')
			.$type<Record<string, 'HIDDEN' | 'OPTIONAL' | 'REQUIRED'>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/** AFTER_CONFIRMATION (default — safest for informal sellers) or IMMEDIATE. */
		paymentTiming: text('payment_timing').notNull().default('AFTER_CONFIRMATION'),
		/** [{ key: 'wa-group-a', label: 'WhatsApp Group A' }] — ?s=<key> provenance tags. */
		shareTags: jsonb('share_tags')
			.$type<Array<{ key: string; label: string }>>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		batchId: uuid('batch_id').references(() => orderBatches.id, { onDelete: 'set null' }),
		viewCount: integer('view_count').notNull().default(0),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('order_links_public_id_key').on(t.publicId),
		index('order_links_tenant_idx').on(t.tenantId, t.status)
	]
);

export const orders = pgTable(
	'orders',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		orderNumber: text('order_number').notNull(), // e.g. MKD-OR-2026-00001, race-free (§14)
		customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
		leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
		status: orderStatusEnum('status').notNull().default('DRAFT'),
		/** Independent of fulfilment status: a CONFIRMED order may still be UNPAID. */
		paymentStatus: orderPaymentStatusEnum('payment_status').notNull().default('UNPAID'),
		source: orderSourceEnum('source').notNull().default('MANUAL'),
		currency: text('currency').notNull().default('USD'),
		subtotal: money('subtotal').notNull().default('0'),
		discount: money('discount').notNull().default('0'),
		deliveryFee: money('delivery_fee').notNull().default('0'),
		total: money('total').notNull().default('0'),
		amountPaid: money('amount_paid').notNull().default('0'),
		batchId: uuid('batch_id').references(() => orderBatches.id, { onDelete: 'set null' }),
		orderLinkId: uuid('order_link_id').references(() => orderLinks.id, { onDelete: 'set null' }),
		/** Public-form idempotency token. Unique per link so concurrent retries create one order. */
		orderLinkSubmissionToken: text('order_link_submission_token'),
		deliveryMethod: deliveryMethodEnum('delivery_method'),
		deliveryLocation: text('delivery_location'),
		/** When the customer gets it — a promise, not a shipping engine. */
		deliveryDate: timestamp('delivery_date', { withTimezone: true }),
		/** Intended method ("Cash on Delivery", "Mobile Payment"). Actual money recorded in payments. */
		paymentMethod: text('payment_method'),
		notes: text('notes'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
		dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('orders_tenant_number_key').on(t.tenantId, t.orderNumber),
		index('orders_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
		index('orders_tenant_payment_idx').on(t.tenantId, t.paymentStatus),
		index('orders_customer_idx').on(t.customerId),
		index('orders_conversation_idx').on(t.conversationId),
		index('orders_batch_idx').on(t.batchId),
		index('orders_order_link_idx').on(t.orderLinkId),
		uniqueIndex('orders_order_link_submission_key').on(t.tenantId, t.orderLinkId, t.orderLinkSubmissionToken)
	]
);

export const orderItems = pgTable(
	'order_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		variant: text('variant'), // "Black / Size 43", "256GB / Black"
		sku: text('sku'),
		quantity: integer('quantity').notNull().default(1),
		/** KG, Piece, Pack, Box… free text, shown next to the quantity. Never an enum. */
		unit: text('unit'),
		unitPrice: money('unit_price').notNull().default('0'),
		discount: money('discount').notNull().default('0'),
		total: money('total').notNull().default('0'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt()
	},
	(t) => [index('order_items_order_idx').on(t.orderId)]
);

export const orderStatusHistory = pgTable(
	'order_status_history',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		fromStatus: orderStatusEnum('from_status'),
		toStatus: orderStatusEnum('to_status').notNull(),
		reason: text('reason'),
		changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		changedByApiKeyId: uuid('changed_by_api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('order_status_history_order_idx').on(t.orderId, t.createdAt)]
);

/** Hosted public forms / embeddable widgets. publicId is the OPAQUE identifier the
 *  browser sees — never a tenant id, never an API key. */
export const forms = pgTable(
	'forms',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		publicId: text('public_id').notNull(),
		type: formTypeEnum('type').notNull(),
		name: text('name').notNull(),
		heading: text('heading'),
		description: text('description'),
		ctaText: text('cta_text'),
		successMessage: text('success_message'),
		/** { fieldKey: { enabled: boolean, required: boolean } } */
		fields: jsonb('fields')
			.$type<Record<string, { enabled: boolean; required: boolean }>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/** Allowed embedding origins; empty = any origin. */
		allowedOrigins: jsonb('allowed_origins')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		branding: jsonb('branding')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		isActive: boolean('is_active').notNull().default(true),
		submissionCount: integer('submission_count').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('forms_public_id_key').on(t.publicId), index('forms_tenant_idx').on(t.tenantId)]
);

export type Order = typeof orders.$inferSelect;
export type OrderBatch = typeof orderBatches.$inferSelect;
export type OrderLink = typeof orderLinks.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Form = typeof forms.$inferSelect;


/* ------------------------------------------------- §35 marketplace ---- */

/**
 * One media table for every marketplace asset.
 *
 * `tenantId IS NULL` means PLATFORM-owned — a country or destination photograph.
 * Tour and operator assets are always tenant-scoped.
 *
 * Credentials are never stored here and never reach a browser: `objectKey` is the
 * private handle that can delete an object, `url` is the public delivery address,
 * and uploads are proxied through the server so no signed write URL is minted for
 * the client.
 */
export const media = pgTable(
	'media',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** NULL = platform-owned. */
		tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
		storageProvider: text('storage_provider').notNull().default('R2'),
		/** Server-generated from the resolved owner, never from a browser-supplied path. */
		objectKey: text('object_key').notNull(),
		url: text('url').notNull(),
		mimeType: text('mime_type'),
		size: integer('size'),
		width: integer('width'),
		height: integer('height'),
		altText: text('alt_text'),
		/*
		 * Where this came from and what it obliges us to say.
		 *
		 * Destination photography is sourced from Wikimedia Commons, which is free
		 * to use but almost always CC BY / CC BY-SA — attribution is a CONDITION,
		 * not a courtesy. An operator's own photograph needs none of this, so all
		 * three are nullable.
		 */
		attribution: text('attribution'),
		license: text('license'),
		sourceUrl: text('source_url'),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('media_object_key_idx').on(t.objectKey), index('media_tenant_idx').on(t.tenantId)]
);

/**
 * A country the marketplace sells into. PLATFORM data — deliberately no tenantId.
 *
 * Tanzania is Tanzania for every operator selling it, and /countries/tanzania has
 * to be one page. Tenant-owning this would let six operators create six rival
 * "Tanzania" pages chasing the same search result.
 */
export const countries = pgTable(
	'countries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		/** ISO 3166-1 alpha-2 — the stable key for anything external. */
		isoCode: text('iso_code'),
		shortDescription: text('short_description'),
		description: text('description'),
		heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
		isActive: boolean('is_active').notNull().default(true),
		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('countries_slug_idx').on(t.slug),
		uniqueIndex('countries_iso_code_idx').on(t.isoCode).where(sql`${t.isoCode} is not null`)
	]
);

/** A place within a country. Platform data, like countries. */
export const destinations = pgTable(
	'destinations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** RESTRICT: a country with destinations cannot be deleted from under them. */
		countryId: uuid('country_id')
			.notNull()
			.references(() => countries.id, { onDelete: 'restrict' }),
		name: text('name').notNull(),
		/** Unique GLOBALLY: the public URL is /destinations/<slug>, with no country segment. */
		slug: text('slug').notNull(),
		/**
		 * Text with a CHECK constraint rather than a pg enum.
		 *
		 * Postgres refuses to USE a newly added enum value in the transaction that
		 * added it, and drizzle applies pending migrations together — so growing
		 * this taxonomy could not be expressed as migrations while it was an enum.
		 * The CHECK gives the same integrity; DestinationType keeps it typed here.
		 */
		destinationType: text('destination_type').$type<DestinationType>().notNull().default('OTHER'),
		shortDescription: text('short_description'),
		description: text('description'),
		heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
		/** "How long should I stay?" is one of the questions the page exists to answer. */
		recommendedStayMin: integer('recommended_stay_min'),
		recommendedStayMax: integer('recommended_stay_max'),
		bestTimeSummary: text('best_time_summary'),
		highlights: jsonb('highlights').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		travelTips: jsonb('travel_tips').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		/**
		 * Where this place IS. Rendered as a pin on the bundled national basemap;
		 * there is no tile provider and no API key behind these two numbers.
		 * A CHECK keeps them both-or-neither -- half a coordinate renders at the
		 * equator rather than failing.
		 */
		latitude: numeric('latitude', { precision: 9, scale: 6 }),
		longitude: numeric('longitude', { precision: 9, scale: 6 }),
		/** Basemap region slug: the join key between this row and a static polygon. */
		mapRegion: text('map_region'),
		/**
		 * The region that contains this place. SET NULL, not cascade: removing a
		 * region must never delete the Serengeti along with it.
		 */
		parentId: uuid('parent_id').references((): AnyPgColumn => destinations.id, { onDelete: 'set null' }),
		status: contentStatusEnum('status').notNull().default('DRAFT'),
		/**
		 * Seed broadly, feature selectively.
		 *
		 * The directory knows every place a real itinerary needs; these two decide
		 * the far smaller set the public sees as filters. Which is an editorial
		 * decision, not a consequence of what happens to be in the table.
		 */
		isFeatured: boolean('is_featured').notNull().default(false),
		sortOrder: integer('sort_order').notNull().default(0),
		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('destinations_slug_idx').on(t.slug),
		index('destinations_featured_idx')
			.on(t.sortOrder, t.name)
			.where(sql`${t.isFeatured} and ${t.status} = 'PUBLISHED'`),
		index('destinations_country_idx').on(t.countryId, t.status),
		index('destinations_type_idx').on(t.destinationType).where(sql`${t.status} = 'PUBLISHED'`),
		index('destinations_parent_idx').on(t.parentId).where(sql`${t.parentId} is not null`),
		index('destinations_map_region_idx').on(t.mapRegion).where(sql`${t.status} = 'PUBLISHED'`)
	]
);

/**
 * The public face of a tenant.
 *
 * Separate from `tenants` because that row is operational — plan, billing,
 * provisioning, credentials — and must never be handed to a browser field by
 * field. This table IS the allow-list, by construction.
 */
export const operatorProfiles = pgTable(
	'operator_profiles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		displayName: text('display_name').notNull(),
		about: text('about'),
		logoMediaId: uuid('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
		coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
		location: text('location'),
		specialties: jsonb('specialties').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		languages: jsonb('languages').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		yearsInBusiness: integer('years_in_business'),
		/** A PLATFORM claim about an operator. A vendor cannot mark themselves verified. */
		isVerified: boolean('is_verified').notNull().default(false),
		verifiedAt: timestamp('verified_at', { withTimezone: true }),
		/**
		 * Who signed the verification off.
		 *
		 * SET NULL, not cascade: an admin leaving must not erase the fact that the
		 * operator was verified — only the record of who approved it.
		 */
		verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
		isActive: boolean('is_active').notNull().default(true),

		/*
		 * Public contact block.
		 *
		 * Deliberately NOT tenants.businessPhone / tenants.websiteUrl. Those are
		 * operational — how Makutano reaches the business — and reusing them would
		 * publish a private number the day somebody filled it in for billing.
		 * NULL here means "do not show it", which is the right default for a page
		 * that is crawled and scraped.
		 */
		websiteUrl: text('website_url'),
		publicEmail: text('public_email'),
		publicPhone: text('public_phone'),

		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('operator_profiles_slug_idx').on(t.slug),
		uniqueIndex('operator_profiles_tenant_idx').on(t.tenantId),
		index('operator_profiles_verified_idx').on(t.verifiedAt).where(sql`${t.isVerified}`)
	]
);

/**
 * An operator's marketplace listing. TENANT data, unlike countries and destinations.
 *
 * The tour is also what RESOLVES OWNERSHIP: a public browser names a tour, and the
 * server derives the tenant from it. The browser never says who owns anything.
 *
 * Separate from what a tenant syncs in by design — that content is externally-sourced
 * product list owned by a sync feed, while a tour is authored here and has ordered
 * days, media and a publishing lifecycle.
 */
export const tours = pgTable(
	'tours',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		/** RESTRICT: removing a country must never silently delete the listings selling it. */
		primaryCountryId: uuid('primary_country_id').references(() => countries.id, { onDelete: 'restrict' }),

		title: text('title').notNull(),
		/** Unique among LIVE rows across the whole marketplace: it is the public URL. */
		slug: text('slug').notNull(),
		shortDescription: text('short_description'),
		description: text('description'),

		durationDays: integer('duration_days').notNull().default(1),
		durationNights: integer('duration_nights'),
		priceFrom: money('price_from'),
		currency: text('currency'),
		/** PER_PERSON | PER_GROUP | FROM — what priceFrom actually means. */
		pricingType: text('pricing_type').notNull().default('PER_PERSON'),

		/** Experience, never geography. Safari, Honeymoon, Photography. */
		/**
		 * WHAT this tour is. Navigation, SEO titles and the category landing page
		 * key off this one; tourCategoryLinks carries the full set for filtering.
		 *
		 * RESTRICT: a category tours are filed under is deactivated, never deleted.
		 */
		primaryCategoryId: uuid('primary_category_id').references(() => tourCategories.id, { onDelete: 'restrict' }),
		/** @deprecated Superseded by tourCategories + tourTravelStyles. Kept until the composer stops writing it. */
		travelStyle: text('travel_style'),
		groupType: text('group_type'),
		groupSizeMin: integer('group_size_min'),
		groupSizeMax: integer('group_size_max'),
		ageRequirement: text('age_requirement'),

		heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),

		accommodationSummary: text('accommodation_summary'),
		transportSummary: text('transport_summary'),
		mealsSummary: text('meals_summary'),
		bestTimeSummary: text('best_time_summary'),

		/** YEAR_ROUND | SEASONAL | DATE_RANGE */
		availabilityType: text('availability_type').notNull().default('YEAR_ROUND'),
		availableFrom: date('available_from'),
		availableTo: date('available_to'),

		/*
		 * Facts a traveller filters on, as booleans the operator ticks rather than
		 * prose a page has to interpret. False means "not claimed", so the page can
		 * stay silent instead of guessing.
		 */
		customisable: boolean('customisable').notNull().default(false),
		soloFriendly: boolean('solo_friendly').notNull().default(false),
		startsAnyDay: boolean('starts_any_day').notNull().default(false),

		status: tourStatusEnum('status').notNull().default('DRAFT'),
		featured: boolean('featured').notNull().default(false),

		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),

		// Editorial lists the tour page renders. Read whole, never queried by
		// element, so jsonb rather than three more tables.
		highlights: jsonb('highlights').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		included: jsonb('included').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		excluded: jsonb('excluded').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

		// Moderation trail. A vendor may not approve their own listing, so who
		// reviewed it is part of the record rather than an afterthought.
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
		reviewNote: text('review_note'),
		publishedAt: timestamp('published_at', { withTimezone: true }),

		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		uniqueIndex('tours_slug_live_idx').on(t.slug).where(sql`${t.deletedAt} is null`),
		index('tours_tenant_idx').on(t.tenantId, t.status, t.updatedAt).where(sql`${t.deletedAt} is null`),
		index('tours_public_idx')
			.on(t.publishedAt)
			.where(sql`${t.status} = 'PUBLISHED' and ${t.deletedAt} is null`),
		index('tours_country_idx')
			.on(t.primaryCountryId)
			.where(sql`${t.status} = 'PUBLISHED' and ${t.deletedAt} is null`),
		index('tours_review_idx')
			.on(t.submittedAt)
			.where(sql`${t.status} in ('SUBMITTED','IN_REVIEW') and ${t.deletedAt} is null`),
		/**
		 * For WRITES, not reads. tourCategories is referenced with RESTRICT, and
		 * without this Postgres enforces that by scanning and locking all of
		 * `tours` — so retiring a category queues behind every concurrent insert.
		 */
		index('tours_primary_category_idx')
			.on(t.primaryCategoryId)
			.where(sql`${t.primaryCategoryId} is not null`)
	]
);

/**
 * Which places a tour visits. Many-to-many, relationally.
 *
 * NOT "1,2,3" in a text column and not a jsonb array of names: "every tour visiting
 * Ngorongoro" is the destination page's core query, and renaming a place must not
 * orphan the tours that mention it.
 */
export const tourDestinations = pgTable(
	'tour_destinations',
	{
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		/** RESTRICT: a destination tours point at cannot be deleted from under them. */
		destinationId: uuid('destination_id')
			.notNull()
			.references(() => destinations.id, { onDelete: 'restrict' }),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		primaryKey({ name: 'tour_destinations_pkey', columns: [t.tourId, t.destinationId] }),
		index('tour_destinations_destination_idx').on(t.destinationId, t.sortOrder)
	]
);

/**
 * WHAT the product is — Safari, Beach & Island, Mountain & Trekking.
 *
 * Deliberately tiny and deliberately separate from travel styles. A category is
 * what a tour IS; a style is HOW it is experienced. "Luxury Safari" is those two
 * facts, not a third thing — treating it as one is how a taxonomy ends up with
 * forty entries that each match three tours.
 */
export const tourCategories = pgTable(
	'tour_categories',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		shortDescription: text('short_description'),
		description: text('description'),
		icon: text('icon'),
		heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
		isActive: boolean('is_active').notNull().default(true),
		/** The set is small enough that all of it is normally shown. */
		isFeatured: boolean('is_featured').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('tour_categories_slug_idx').on(t.slug),
		index('tour_categories_featured_idx')
			.on(t.sortOrder, t.name)
			.where(sql`${t.isFeatured} and ${t.isActive}`)
	]
);

/**
 * Every category a tour spans, including its primary one.
 *
 * A safari-and-Zanzibar itinerary genuinely is two categories, so filtering
 * needs the set while navigation needs the one. Writing the primary in here too
 * means a category filter is a single join rather than a union of a column and
 * a table.
 */
export const tourCategoryLinks = pgTable(
	'tour_category_links',
	{
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => tourCategories.id, { onDelete: 'restrict' }),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		primaryKey({ name: 'tour_category_links_pkey', columns: [t.tourId, t.categoryId] }),
		index('tour_category_links_category_idx').on(t.categoryId, t.sortOrder)
	]
);

/**
 * What KIND of trip this is — the second discovery axis beside destination.
 *
 * A platform-managed table rather than free text on tours, for exactly the
 * reason destinations are: left to vendors, "Luxury", "Luxury Safari", "luxury
 * trip" and "Premium Luxury" all become separate filters that each match a
 * fraction of the inventory, and the navigation stops working.
 *
 * Deliberately small. A taxonomy a traveller can hold in their head beats one
 * that is technically exhaustive.
 */
export const travelStyles = pgTable(
	'travel_styles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		shortDescription: text('short_description'),
		description: text('description'),
		/** A theme icon name, not an uploaded asset — these render inline in filters. */
		icon: text('icon'),
		heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
		isActive: boolean('is_active').notNull().default(true),
		isFeatured: boolean('is_featured').notNull().default(false),
		sortOrder: integer('sort_order').notNull().default(0),
		seoTitle: text('seo_title'),
		seoDescription: text('seo_description'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('travel_styles_slug_idx').on(t.slug),
		index('travel_styles_featured_idx')
			.on(t.sortOrder, t.name)
			.where(sql`${t.isFeatured} and ${t.isActive}`)
	]
);

/**
 * A tour is legitimately several things at once — a luxury honeymoon safari is
 * all three — so this is many-to-many rather than a category column.
 */
export const tourTravelStyles = pgTable(
	'tour_travel_styles',
	{
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		/** RESTRICT: a style tours are tagged with is deactivated, never deleted. */
		travelStyleId: uuid('travel_style_id')
			.notNull()
			.references(() => travelStyles.id, { onDelete: 'restrict' }),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		primaryKey({ name: 'tour_travel_styles_pkey', columns: [t.tourId, t.travelStyleId] }),
		index('tour_travel_styles_style_idx').on(t.travelStyleId, t.sortOrder)
	]
);

/**
 * What a traveller DOES on the trip.
 *
 * A fourth axis, deliberately separate from the other three: a category is what
 * the trip IS, a travel style is HOW it is experienced, a destination is WHERE.
 * "Game drive" is none of those — two tours can share a category, a style and a
 * country and still differ on whether anybody gets in a boat.
 *
 * Platform taxonomy, exactly like categories and styles: an operator selects
 * from it and cannot add to it. One flat list, no parent/child — a hierarchy
 * here would be a guess about a shape nobody has needed yet.
 */
export const activities = pgTable(
	'activities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		shortDescription: text('short_description'),
		/** A theme icon name, not an uploaded asset — same as styles and categories. */
		icon: text('icon'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('activities_slug_idx').on(t.slug),
		index('activities_active_idx')
			.on(t.sortOrder, t.name)
			.where(sql`${t.isActive}`)
	]
);

export const tourActivities = pgTable(
	'tour_activities',
	{
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		/** RESTRICT, as with styles: an activity in use is deactivated, never deleted. */
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activities.id, { onDelete: 'restrict' }),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		primaryKey({ name: 'tour_activities_pkey', columns: [t.tourId, t.activityId] }),
		index('tour_activities_activity_idx').on(t.activityId, t.sortOrder)
	]
);

/**
 * Reusable PACKAGE content — deliberately not `tripItems`, which belong to one
 * operational departure that actually ran. Blurring those two would make a
 * template and a record of a real trip the same row.
 */
/**
 * Where people sleep — a platform directory, like countries and destinations.
 *
 * A lodge is a place, not a tenant's property: two operators selling the same
 * camp should point at one record, which is the whole reason this is not a
 * per-tenant table. Tenants LINK to accommodations; they never own them.
 *
 * Deliberately thin. The first import carries names and photographs and nothing
 * else, so location and description are nullable and stay empty rather than
 * being guessed — an invented address on a lodge listing is worse than none.
 */
export const accommodations = pgTable(
	'accommodations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		countryId: uuid('country_id').references(() => countries.id, { onDelete: 'set null' }),
		destinationId: uuid('destination_id').references(() => destinations.id, { onDelete: 'set null' }),
		shortDescription: text('short_description'),
		/** Rich text (HTML) from the source system, like tour descriptions. */
		description: text('description'),
		/** LUXURY | MID_RANGE | BUDGET — what it costs in comfort, not in money. */
		accommodationLevel: text('accommodation_level'),
		/** SAFARI_LODGE | HOTEL | TENTED_CAMP | BEACH_RESORT | ECO_LODGE | BOUTIQUE_HOTEL. */
		lodgeType: text('lodge_type'),
		/** The operator's own case for it. Rich text; only a handful have one. */
		whyWeRecommend: text('why_we_recommend'),
		websiteUrl: text('website_url'),
		currency: text('currency'),
		isFeatured: boolean('is_featured').notNull().default(false),
		flyInAvailable: boolean('fly_in_available').notNull().default(false),
		transferAvailable: boolean('transfer_available').notNull().default(false),
		/** Free-form audience tags from the source; normalised on the way in. */
		bestFor: jsonb('best_for').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		/** Provenance, so an import can be traced and re-run without duplicating. */
		source: text('source'),
		externalRef: text('external_ref'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		uniqueIndex('accommodations_slug_key').on(t.slug),
		index('accommodations_active_idx').on(t.isActive, t.name),
		index('accommodations_destination_idx').on(t.destinationId)
	]
);

/**
 * Photographs, as urls.
 *
 * NOT rows in `media`, and that is not laziness: a media row carries an
 * object_key which is the handle for DELETING an object. These images live in
 * another bucket, so pointing Connect's delete path at one of their keys is a
 * way to destroy a file that was never ours to remove.
 */
export const accommodationImages = pgTable(
	'accommodation_images',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accommodationId: uuid('accommodation_id')
			.notNull()
			.references(() => accommodations.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		/** hero | hero_mobile | card | cover | gallery — the role it played at source. */
		role: text('role'),
		altText: text('alt_text'),
		caption: text('caption'),
		category: text('category'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [
		index('accommodation_images_parent_idx').on(t.accommodationId, t.sortOrder),
		uniqueIndex('accommodation_images_url_key').on(t.accommodationId, t.url)
	]
);

/**
 * Where you stay on this trip, as an ordered list.
 *
 * RESTRICT on the accommodation: a lodge that tours point at is deactivated,
 * never deleted — the same rule travel styles follow, for the same reason.
 */
export const tourAccommodations = pgTable(
	'tour_accommodations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		/** Null for a one-off the operator typed; see [customName]. */
		accommodationId: uuid('accommodation_id').references(() => accommodations.id, { onDelete: 'restrict' }),
		/**
		 * A place the directory does not list, and its photographs.
		 *
		 * The directory will never be complete — a new camp, a private house, a
		 * lodge nobody has added. Making an operator either pollute a shared
		 * platform table or settle for a nameless line of free text is a false
		 * choice, so a row is EITHER a directory property or one of these. A
		 * CHECK enforces exactly one, because a row that is both is a row whose
		 * rendering is a guess.
		 */
		customName: text('custom_name'),
		customImages: jsonb('custom_images').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		sortOrder: integer('sort_order').notNull().default(0),
		nights: integer('nights'),
		note: text('note')
	},
	(t) => [
		index('tour_accommodations_tour_idx').on(t.tourId, t.sortOrder),
		uniqueIndex('tour_accommodations_unique_property').on(t.tourId, t.accommodationId)
	]
);

export const tourItineraryDays = pgTable(
	'tour_itinerary_days',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		dayNumber: integer('day_number').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		/**
		 * Optional link to a canonical destination. This is what lets the UI DERIVE
		 * the route (Arusha → Tarangire → Serengeti) rather than asking the vendor
		 * to type it a second time.
		 */
		destinationId: uuid('destination_id').references(() => destinations.id, { onDelete: 'set null' }),
		/**
		 * Where the night is spent, from the directory.
		 *
		 * The free-text column below it stays and is not deprecated: a day can
		 * name a fly camp or a farmhouse that is not — and should not be — a
		 * directory entry, and losing that would be a regression. The id is the
		 * upgrade for the properties that ARE listed, so "Serengeti Serena" and
		 * "Serena Serengeti" stop being two lodges.
		 */
		accommodationId: uuid('accommodation_id').references(() => accommodations.id, { onDelete: 'set null' }),
		accommodation: text('accommodation'),
		/**
		 * Photographs for a night spent somewhere the directory does not list.
		 *
		 * Read only when accommodationId is null — a directory property brings
		 * its own pictures, and a second set on the day would be two answers to
		 * one question.
		 */
		accommodationImages: jsonb('accommodation_images').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		/**
		 * BREAKFAST | LUNCH | DINNER — a closed set, not a sentence.
		 *
		 * See MEALS in $lib/tour-options. The old free text is preserved in
		 * [mealsNote] wherever the backfill could not read it, so a guess made by
		 * pattern-matching English is checkable rather than destructive.
		 */
		meals: jsonb('meals').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		/** What the operator had typed, kept only while it has not been understood. */
		mealsNote: text('meals_note'),
		activities: jsonb('activities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		distance: text('distance'),
		estimatedTravelTime: text('estimated_travel_time'),
		/**
		 * DRIVE | FLY | BOAT — how you reach this stop from the last one.
		 *
		 * NULL means the operator has not said, and the map draws a neutral line.
		 * Six hours by road and fifty minutes in a Cessna are not the same day,
		 * and a route that draws them identically says they are.
		 */
		travelMode: text('travel_mode').$type<TravelMode>(),
		/**
		 * An optional pin for a stop that is NOT a canonical destination -- a camp,
		 * a viewpoint, a river crossing. Seeding the directory with those would
		 * fragment it, so the day carries the coordinate instead.
		 */
		latitude: numeric('latitude', { precision: 9, scale: 6 }),
		longitude: numeric('longitude', { precision: 9, scale: 6 }),
		mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('tour_itinerary_days_tour_day_idx').on(t.tourId, t.dayNumber)]
);

/** The gallery. The hero lives on tours.heroMediaId, so there is exactly one answer
 *  to "which image represents this tour". */
export const tourMedia = pgTable(
	'tour_media',
	{
		tourId: uuid('tour_id')
			.notNull()
			.references(() => tours.id, { onDelete: 'cascade' }),
		mediaId: uuid('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		primaryKey({ name: 'tour_media_pkey', columns: [t.tourId, t.mediaId] }),
		index('tour_media_order_idx').on(t.tourId, t.sortOrder)
	]
);

export const mediaRelations = relations(media, ({ one }) => ({
	tenant: one(tenants, { fields: [media.tenantId], references: [tenants.id] })
}));

export const countriesRelations = relations(countries, ({ one, many }) => ({
	heroMedia: one(media, { fields: [countries.heroMediaId], references: [media.id] }),
	destinations: many(destinations),
	tours: many(tours)
}));

export const destinationsRelations = relations(destinations, ({ one, many }) => ({
	country: one(countries, { fields: [destinations.countryId], references: [countries.id] }),
	heroMedia: one(media, { fields: [destinations.heroMediaId], references: [media.id] }),
	tourLinks: many(tourDestinations)
}));

export const operatorProfilesRelations = relations(operatorProfiles, ({ one }) => ({
	tenant: one(tenants, { fields: [operatorProfiles.tenantId], references: [tenants.id] }),
	logo: one(media, { fields: [operatorProfiles.logoMediaId], references: [media.id] }),
	cover: one(media, { fields: [operatorProfiles.coverMediaId], references: [media.id] })
}));

export const toursRelations = relations(tours, ({ one, many }) => ({
	tenant: one(tenants, { fields: [tours.tenantId], references: [tenants.id] }),
	primaryCountry: one(countries, { fields: [tours.primaryCountryId], references: [countries.id] }),
	heroMedia: one(media, { fields: [tours.heroMediaId], references: [media.id] }),
	destinationLinks: many(tourDestinations),
	itinerary: many(tourItineraryDays),
	gallery: many(tourMedia)
}));

export const tourCategoriesRelations = relations(tourCategories, ({ many }) => ({
	tourLinks: many(tourCategoryLinks)
}));

export const tourCategoryLinksRelations = relations(tourCategoryLinks, ({ one }) => ({
	tour: one(tours, { fields: [tourCategoryLinks.tourId], references: [tours.id] }),
	category: one(tourCategories, { fields: [tourCategoryLinks.categoryId], references: [tourCategories.id] })
}));

export const travelStylesRelations = relations(travelStyles, ({ many }) => ({
	tourLinks: many(tourTravelStyles)
}));

export const tourActivitiesRelations = relations(tourActivities, ({ one }) => ({
	tour: one(tours, { fields: [tourActivities.tourId], references: [tours.id] }),
	activity: one(activities, { fields: [tourActivities.activityId], references: [activities.id] })
}));

export const tourTravelStylesRelations = relations(tourTravelStyles, ({ one }) => ({
	tour: one(tours, { fields: [tourTravelStyles.tourId], references: [tours.id] }),
	style: one(travelStyles, { fields: [tourTravelStyles.travelStyleId], references: [travelStyles.id] })
}));

export const tourDestinationsRelations = relations(tourDestinations, ({ one }) => ({
	tour: one(tours, { fields: [tourDestinations.tourId], references: [tours.id] }),
	destination: one(destinations, { fields: [tourDestinations.destinationId], references: [destinations.id] })
}));

export const tourItineraryDaysRelations = relations(tourItineraryDays, ({ one }) => ({
	tour: one(tours, { fields: [tourItineraryDays.tourId], references: [tours.id] }),
	destination: one(destinations, { fields: [tourItineraryDays.destinationId], references: [destinations.id] })
}));

export const tourMediaRelations = relations(tourMedia, ({ one }) => ({
	tour: one(tours, { fields: [tourMedia.tourId], references: [tours.id] }),
	asset: one(media, { fields: [tourMedia.mediaId], references: [media.id] })
}));

/* ====================== Reviews: platform trust data ===================== */

/**
 * PENDING → PUBLISHED | HIDDEN | REJECTED.
 *
 * HIDDEN and REJECTED are different facts and both are kept: rejected never
 * went public, hidden did and was pulled. A review is never deleted for being
 * hidden — the traveller wrote it, and destroying it to tidy a page would be
 * the platform editing someone else's words.
 */
export const reviewStatusEnum = pgEnum('review_status', ['PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED']);

/**
 * A traveller's review, backed by a real booking.
 *
 * A row cannot exist without a booking behind it, and that is the whole design:
 * "verified" is not a flag anybody can switch on, it is the shape of the table.
 * `bookingId` is NOT NULL and UNIQUE, and the service resolves the customer, the
 * tenant and the tour FROM the booking rather than from anything a browser sent.
 *
 * Three parties with three different rights, drawn in the columns:
 *   the traveller owns rating, title and body
 *   the operator owns operatorResponse and nothing else
 *   the platform owns status and the moderation columns
 *
 * Deliberately NOT here: category ratings (guide/value/…). One honest overall
 * number beats five fields nobody fills in, and adding them later is additive.
 */
export const reviews = pgTable(
	'reviews',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** The source of truth. Everything below is derived from it, server-side. */
		bookingId: uuid('booking_id')
			.notNull()
			.references(() => bookings.id, { onDelete: 'cascade' }),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		customerId: uuid('customer_id')
			.notNull()
			.references(() => customers.id, { onDelete: 'cascade' }),
		/**
		 * Null for a custom trip.
		 *
		 * An accepted quotation need not come from a published listing, and
		 * refusing the review would punish the traveller for how they booked. It
		 * still counts towards the operator's rating.
		 */
		tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),

		rating: integer('rating').notNull(),
		title: text('title'),
		body: text('body').notNull(),

		status: reviewStatusEnum('status').notNull().default('PENDING'),

		/**
		 * The traveller's way in — a HASH, never the token itself.
		 *
		 * There is no customer login anywhere in this product, so an unguessable
		 * token is how a traveller reaches their own review. The quotation flow
		 * proved the shape but stores its token raw; a review invitation sits in
		 * an inbox for months, so storing it in the clear would let anyone with
		 * read access to this table write reviews as any traveller. Only the
		 * sha256 is kept — the raw token exists in the email and nowhere else.
		 */
		inviteTokenHash: text('invite_token_hash'),
		invitedAt: timestamp('invited_at', { withTimezone: true }),
		/**
		 * Expiry blocks WRITING, never reading.
		 *
		 * A link that works forever is a link that leaks forever; a traveller
		 * coming back after it lapses still sees what they wrote.
		 */
		expiresAt: timestamp('expires_at', { withTimezone: true }),

		submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		/** Set on every traveller edit. The fact of an edit is never erased. */
		editedAt: timestamp('edited_at', { withTimezone: true }),

		moderatedAt: timestamp('moderated_at', { withTimezone: true }),
		moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
		moderationReason: text('moderation_reason'),

		/** The operator's only writable field. */
		operatorResponse: text('operator_response'),
		operatorRespondedAt: timestamp('operator_responded_at', { withTimezone: true }),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('reviews_booking_key').on(t.bookingId),
		uniqueIndex('reviews_invite_token_key').on(t.inviteTokenHash),
		index('reviews_tour_published_idx').on(t.tourId, t.publishedAt),
		index('reviews_tenant_published_idx').on(t.tenantId, t.publishedAt),
		index('reviews_tenant_status_idx').on(t.tenantId, t.status, t.submittedAt),
		index('reviews_status_idx').on(t.status, t.submittedAt),
		index('reviews_customer_idx').on(t.customerId)
	]
);

export type Media = typeof media.$inferSelect;
export type Country = typeof countries.$inferSelect;
export type Destination = typeof destinations.$inferSelect;
export type OperatorProfile = typeof operatorProfiles.$inferSelect;
export type Tour = typeof tours.$inferSelect;
export type TourDestination = typeof tourDestinations.$inferSelect;
export type TravelStyle = typeof travelStyles.$inferSelect;
export type TourCategory = typeof tourCategories.$inferSelect;
export type TourCategoryLink = typeof tourCategoryLinks.$inferSelect;
export type TourTravelStyle = typeof tourTravelStyles.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type TourActivity = typeof tourActivities.$inferSelect;
export type TourItineraryDay = typeof tourItineraryDays.$inferSelect;
export type Accommodation = typeof accommodations.$inferSelect;
export type AccommodationImage = typeof accommodationImages.$inferSelect;
export type TourAccommodation = typeof tourAccommodations.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type TourMedia = typeof tourMedia.$inferSelect;
