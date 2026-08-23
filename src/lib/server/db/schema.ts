// Makutano Connect — full relational schema (§25).
// Conventions: UUID primary keys, UTC timestamptz everywhere, every business-owned
// row carries tenant_id, and tenant-scoped uniqueness is expressed as compound unique
// indexes so two tenants can never collide (or read each other's rows by guessing).
import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums -- */

export const tenantStatusEnum = pgEnum('tenant_status', ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'TRIAL']);
export const roleEnum = pgEnum('role', ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'SALES', 'BOOKING_AGENT', 'VIEWER']);
export const apiKeyEnvEnum = pgEnum('api_key_environment', ['live', 'test']);
export const apiKeyStatusEnum = pgEnum('api_key_status', ['ACTIVE', 'REVOKED']);
export const waConnectionStatusEnum = pgEnum('whatsapp_connection_status', [
	'CONNECTED',
	'DISCONNECTED',
	'ERROR',
	'REAUTH_REQUIRED'
]);
export const channelEnum = pgEnum('channel', ['WHATSAPP', 'WEB', 'EMAIL', 'MANUAL']);
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
export const sourceEnum = pgEnum('source', ['WEBSITE', 'WHATSAPP', 'ADMIN', 'API', 'PHONE', 'EMAIL']);
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
export const notificationChannelEnum = pgEnum('notification_channel', [
	'WHATSAPP',
	'EMAIL',
	'SMS',
	'IN_APP',
	'WEBHOOK'
]);
export const notificationStatusEnum = pgEnum('notification_status', ['PENDING', 'SENT', 'FAILED', 'READ']);
export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']);
export const templateStatusEnum = pgEnum('template_status', ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'DRAFT', 'SUBMITTED']);

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
		quotationPrefix: text('quotation_prefix').notNull().default('QT'),
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
		buttons: jsonb('buttons').$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
		/** Ordered named variables as they appear in the body → positional index. */
		variables: jsonb('variables').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		enabled: boolean('enabled').notNull().default(true),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
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
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		convertedBookingId: uuid('converted_booking_id'),
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
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
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
export type ApiKey = typeof apiKeys.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type WhatsappConnection = typeof whatsappConnections.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type BookingRequest = typeof bookingRequests.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type WhatsappOnboardingSession = typeof whatsappOnboardingSessions.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];

/* ================== Conversational commerce: orders + catalog + forms ==== */
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
	'WHATSAPP_GROUP',
	'WEBSITE',
	'INSTAGRAM',
	'FACEBOOK',
	'MANUAL',
	'API',
	'OTHER'
]);

export const catalogItemTypeEnum = pgEnum('catalog_item_type', [
	'PRODUCT',
	'SERVICE',
	'TOUR',
	'ACCOMMODATION',
	'EXPERIENCE',
	'OTHER'
]);

export const deliveryMethodEnum = pgEnum('delivery_method', ['DELIVERY', 'PICKUP']);

export const formTypeEnum = pgEnum('form_type', ['BOOKING', 'ORDER', 'QUOTE', 'LEAD']);

/** Lightweight catalog — enough to reference what is booked, quoted or ordered.
 *  Businesses with their own catalog keep it and pass externalReference instead. */
export const catalogItems = pgTable(
	'catalog_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		type: catalogItemTypeEnum('type').notNull().default('PRODUCT'),
		name: text('name').notNull(),
		description: text('description'),
		sku: text('sku'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		price: money('price'),
		currency: text('currency'),
		imageUrl: text('image_url'),
		/** [{ label: "Black / 43", price?: "230.00", sku?: "NIKE-AM-43-BLK" }] */
		variants: jsonb('variants').$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
		isActive: boolean('is_active').notNull().default(true),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('catalog_items_tenant_idx').on(t.tenantId, t.isActive),
		uniqueIndex('catalog_items_tenant_sku_key').on(t.tenantId, t.sku).where(sql`${t.sku} is not null`)
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
		deliveryMethod: deliveryMethodEnum('delivery_method'),
		deliveryLocation: text('delivery_location'),
		notes: text('notes'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
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
		index('orders_conversation_idx').on(t.conversationId)
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
		catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		variant: text('variant'), // "Black / Size 43", "256GB / Black"
		sku: text('sku'),
		quantity: integer('quantity').notNull().default(1),
		unitPrice: money('unit_price').notNull().default('0'),
		discount: money('discount').notNull().default('0'),
		total: money('total').notNull().default('0'),
		externalReference: text('external_reference'),
		externalSource: text('external_source'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
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
		fields: jsonb('fields').$type<Record<string, { enabled: boolean; required: boolean }>>().notNull().default(sql`'{}'::jsonb`),
		/** Catalog items offered on ORDER/BOOKING forms; empty = free-text item entry. */
		catalogItemIds: jsonb('catalog_item_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		/** Allowed embedding origins; empty = any origin. */
		allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
		isActive: boolean('is_active').notNull().default(true),
		submissionCount: integer('submission_count').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('forms_public_id_key').on(t.publicId), index('forms_tenant_idx').on(t.tenantId)]
);

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type Form = typeof forms.$inferSelect;
