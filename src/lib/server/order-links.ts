// Order Links — ONE offer behind ONE public link (/o/<publicId>).
//
// The product boundary, enforced here: this is an order ENTRY POINT, not ecommerce.
// No cart, no browsing, no inventory. A submission flows through the canonical
// createOrder(), so entitlements, events, WhatsApp templates, batches, payments and
// tenant isolation all apply unchanged. The public surface exposes only what a
// customer needs to place this one order — never tenant internals.
import { and, eq, sql } from 'drizzle-orm';
import { audit } from './audit';
import { findOrCreateCustomer } from './customers';
import { db, schema } from './db';
import { assertAllowed, can } from './entitlements';
import { randomToken } from './encryption';
import { AppError } from './errors';
import { log } from './logger';
import { createOrder } from './orders';
import { createPaymentRequest } from './payment-requests';
import { enforce } from './rate-limit';
import { getTenantById } from './tenants';

const dec = (v: string | number | null | undefined): number => Number(v ?? 0);
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

/** UI presets only — `unit` stays free text, never an enum (§16 generic design). */
export const UNIT_PRESETS = ['Piece', 'KG', 'Pack', 'Box', 'Bag', 'Bottle', 'Tray', 'Dozen'] as const;

export const FIELD_KEYS = ['email', 'deliveryLocation', 'note'] as const;
export type FieldMode = 'HIDDEN' | 'OPTIONAL' | 'REQUIRED';
const FIELD_MODES = new Set<FieldMode>(['HIDDEN', 'OPTIONAL', 'REQUIRED']);
const DEFAULT_FIELDS: Record<string, FieldMode> = { email: 'HIDDEN', deliveryLocation: 'OPTIONAL', note: 'OPTIONAL' };

export type OrderLinkInput = {
	title: string;
	description?: string | null;
	imageUrl?: string | null;
	unit: string;
	unitPrice: string;
	currency?: string;
	minQuantity?: number;
	maxQuantity?: number | null;
	capacityTotal?: number | null;
	deadline?: Date | null;
	deliveryDate?: Date | null;
	pickupEnabled?: boolean;
	deliveryEnabled?: boolean;
	deliveryFee?: string;
	fieldConfig?: Record<string, FieldMode>;
	paymentTiming?: 'AFTER_CONFIRMATION' | 'IMMEDIATE';
	shareTags?: Array<{ key: string; label: string }>;
	batchId?: string | null;
	catalogItemId?: string | null;
};

type Actor = { userId?: string | null };

/* ------------------------------------------------------------ validation -- */

function validateInput(input: OrderLinkInput): void {
	if (!input.title?.trim()) throw new AppError('VALIDATION_ERROR', 'Give the offer a title.');
	if (!input.unit?.trim()) throw new AppError('VALIDATION_ERROR', 'Choose a unit — KG, Piece, Pack…');
	if (!PRICE_RE.test(input.unitPrice ?? '')) {
		throw new AppError('VALIDATION_ERROR', 'Price must be a plain amount like 14000 or 14000.50.');
	}
	if (input.deliveryFee !== undefined && input.deliveryFee !== '' && !PRICE_RE.test(input.deliveryFee)) {
		throw new AppError('VALIDATION_ERROR', 'Delivery fee must be a plain amount.');
	}
	if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) {
		throw new AppError('VALIDATION_ERROR', 'Currency must be a 3-letter code like TZS.');
	}
	const min = input.minQuantity ?? 1;
	if (!Number.isInteger(min) || min < 1 || min > 999_999) {
		throw new AppError('VALIDATION_ERROR', 'Minimum quantity must be a whole number of at least 1.');
	}
	if (input.maxQuantity != null && (!Number.isInteger(input.maxQuantity) || input.maxQuantity < min)) {
		throw new AppError('VALIDATION_ERROR', 'Maximum quantity must be a whole number at or above the minimum.');
	}
	if (input.capacityTotal != null && (!Number.isInteger(input.capacityTotal) || input.capacityTotal < 1)) {
		throw new AppError('VALIDATION_ERROR', 'Capacity must be a whole number of at least 1.');
	}
	if (input.pickupEnabled === false && input.deliveryEnabled === false) {
		throw new AppError(
			'VALIDATION_ERROR',
			'Enable pickup, delivery, or both — customers need a way to receive the order.'
		);
	}
	if (input.paymentTiming && !['AFTER_CONFIRMATION', 'IMMEDIATE'].includes(input.paymentTiming)) {
		throw new AppError('VALIDATION_ERROR', 'Payment timing must be after-confirmation or immediate.');
	}
	if (input.fieldConfig) {
		for (const [key, mode] of Object.entries(input.fieldConfig)) {
			if (!FIELD_KEYS.includes(key as (typeof FIELD_KEYS)[number]) || !FIELD_MODES.has(mode)) {
				throw new AppError('VALIDATION_ERROR', 'Unknown field configuration.');
			}
		}
	}
	if (input.shareTags) {
		if (input.shareTags.length > 12) throw new AppError('VALIDATION_ERROR', 'At most 12 share tags.');
		for (const tag of input.shareTags) {
			if (!/^[a-z0-9-]{1,40}$/.test(tag.key) || !tag.label?.trim() || tag.label.length > 60) {
				throw new AppError('VALIDATION_ERROR', 'Share tags need a short key (letters, numbers, dashes) and a label.');
			}
		}
	}
}

async function assertTenantOwned(tenantId: string, input: OrderLinkInput): Promise<void> {
	if (input.batchId) {
		const rows = await db()
			.select({ id: schema.orderBatches.id })
			.from(schema.orderBatches)
			.where(and(eq(schema.orderBatches.id, input.batchId), eq(schema.orderBatches.tenantId, tenantId)))
			.limit(1);
		if (!rows[0]) throw new AppError('NOT_FOUND', 'Batch could not be found.');
	}
	if (input.catalogItemId) {
		const rows = await db()
			.select({ id: schema.catalogItems.id })
			.from(schema.catalogItems)
			.where(and(eq(schema.catalogItems.id, input.catalogItemId), eq(schema.catalogItems.tenantId, tenantId)))
			.limit(1);
		if (!rows[0]) throw new AppError('NOT_FOUND', 'Catalog item could not be found.');
	}
}

/* ------------------------------------------------------------ management -- */

export async function createOrderLink(
	tenantId: string,
	input: OrderLinkInput,
	actor: Actor = {}
): Promise<schema.OrderLink> {
	await assertAllowed(tenantId, { feature: 'orderLinks.enabled' });
	validateInput(input);
	await assertTenantOwned(tenantId, input);
	const tenant = await getTenantById(tenantId);
	if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Tenant could not be found.');

	const [link] = await db()
		.insert(schema.orderLinks)
		.values({
			tenantId,
			publicId: `ol_${randomToken(18)}`,
			title: input.title.trim(),
			description: input.description?.trim() || null,
			imageUrl: input.imageUrl?.trim() || null,
			unit: input.unit.trim(),
			unitPrice: input.unitPrice,
			currency: input.currency ?? tenant.currency ?? 'TZS',
			minQuantity: input.minQuantity ?? 1,
			maxQuantity: input.maxQuantity ?? null,
			capacityTotal: input.capacityTotal ?? null,
			deadline: input.deadline ?? null,
			deliveryDate: input.deliveryDate ?? null,
			pickupEnabled: input.pickupEnabled ?? true,
			deliveryEnabled: input.deliveryEnabled ?? true,
			deliveryFee: input.deliveryFee || '0',
			fieldConfig: { ...DEFAULT_FIELDS, ...(input.fieldConfig ?? {}) },
			paymentTiming: input.paymentTiming ?? 'AFTER_CONFIRMATION',
			shareTags: input.shareTags ?? [],
			batchId: input.batchId ?? null,
			catalogItemId: input.catalogItemId ?? null,
			createdByUserId: actor.userId ?? null
		})
		.returning();
	await audit(
		tenantId,
		'order_link.created',
		{ type: 'user', userId: actor.userId ?? undefined },
		{ type: 'order_link', id: link.id },
		{ title: link.title }
	);
	return link;
}

async function getOwnedLink(tenantId: string, id: string): Promise<schema.OrderLink> {
	const rows = await db()
		.select()
		.from(schema.orderLinks)
		.where(and(eq(schema.orderLinks.id, id), eq(schema.orderLinks.tenantId, tenantId)))
		.limit(1);
	if (!rows[0]) throw new AppError('NOT_FOUND', 'Order link could not be found.');
	return rows[0];
}

export async function updateOrderLink(
	tenantId: string,
	id: string,
	input: OrderLinkInput,
	actor: Actor = {}
): Promise<schema.OrderLink> {
	const before = await getOwnedLink(tenantId, id);
	if (before.status === 'ARCHIVED')
		throw new AppError('CONFLICT', 'An archived link cannot be edited — duplicate it instead.');
	validateInput(input);
	await assertTenantOwned(tenantId, input);
	const [after] = await db()
		.update(schema.orderLinks)
		.set({
			title: input.title.trim(),
			description: input.description?.trim() || null,
			imageUrl: input.imageUrl?.trim() || null,
			unit: input.unit.trim(),
			unitPrice: input.unitPrice,
			...(input.currency ? { currency: input.currency } : {}),
			minQuantity: input.minQuantity ?? 1,
			maxQuantity: input.maxQuantity ?? null,
			capacityTotal: input.capacityTotal ?? null,
			deadline: input.deadline ?? null,
			deliveryDate: input.deliveryDate ?? null,
			pickupEnabled: input.pickupEnabled ?? true,
			deliveryEnabled: input.deliveryEnabled ?? true,
			deliveryFee: input.deliveryFee || '0',
			fieldConfig: { ...DEFAULT_FIELDS, ...(input.fieldConfig ?? {}) },
			paymentTiming: input.paymentTiming ?? before.paymentTiming,
			shareTags: input.shareTags ?? (before.shareTags as Array<{ key: string; label: string }>),
			batchId: input.batchId ?? null,
			catalogItemId: input.catalogItemId ?? null,
			updatedAt: new Date()
		})
		.where(eq(schema.orderLinks.id, id))
		.returning();
	await audit(
		tenantId,
		'order_link.updated',
		{ type: 'user', userId: actor.userId ?? undefined },
		{ type: 'order_link', id },
		{ title: after.title }
	);
	return after;
}

const TRANSITIONS: Record<string, string[]> = {
	DRAFT: ['ACTIVE', 'ARCHIVED'],
	ACTIVE: ['PAUSED', 'ARCHIVED'],
	PAUSED: ['ACTIVE', 'ARCHIVED'],
	ARCHIVED: []
};

export async function setOrderLinkStatus(
	tenantId: string,
	id: string,
	status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED',
	actor: Actor = {}
): Promise<schema.OrderLink> {
	const link = await getOwnedLink(tenantId, id);
	if (link.status === status) return link;
	if (!TRANSITIONS[link.status]?.includes(status)) {
		throw new AppError('CONFLICT', `A ${link.status.toLowerCase()} link cannot become ${status.toLowerCase()}.`);
	}
	if (status === 'ACTIVE') {
		await assertAllowed(tenantId, { feature: 'orderLinks.enabled' });
		const { effectiveEntitlements } = await import('./entitlements');
		const resolved = await effectiveEntitlements(tenantId);
		const maxActive = Number(resolved.resolved['orderLinks.maxActive']?.effective ?? 0);
		if (maxActive > 0) {
			const [{ n }] = (await db().execute(
				sql`select count(*)::int as n from order_links where tenant_id = ${tenantId}::uuid and status = 'ACTIVE'`
			)) as unknown as Array<{ n: number }>;
			if (Number(n) >= maxActive) {
				throw new AppError(
					'ENTITLEMENT_LIMIT_REACHED',
					`Your plan allows ${maxActive} active order link${maxActive === 1 ? '' : 's'}. Pause one first.`
				);
			}
		}
	}
	const [after] = await db()
		.update(schema.orderLinks)
		.set({ status, updatedAt: new Date() })
		.where(eq(schema.orderLinks.id, id))
		.returning();
	await audit(
		tenantId,
		'order_link.status_changed',
		{ type: 'user', userId: actor.userId ?? undefined },
		{ type: 'order_link', id },
		{ from: link.status, to: status }
	);
	return after;
}

export async function duplicateOrderLink(tenantId: string, id: string, actor: Actor = {}): Promise<schema.OrderLink> {
	const source = await getOwnedLink(tenantId, id);
	return createOrderLink(
		tenantId,
		{
			title: `${source.title} (copy)`,
			description: source.description,
			imageUrl: source.imageUrl,
			unit: source.unit,
			unitPrice: String(source.unitPrice),
			currency: source.currency,
			minQuantity: source.minQuantity,
			maxQuantity: source.maxQuantity,
			capacityTotal: source.capacityTotal,
			deadline: source.deadline,
			deliveryDate: source.deliveryDate,
			pickupEnabled: source.pickupEnabled,
			deliveryEnabled: source.deliveryEnabled,
			deliveryFee: String(source.deliveryFee),
			fieldConfig: source.fieldConfig as Record<string, FieldMode>,
			paymentTiming: source.paymentTiming as 'AFTER_CONFIRMATION' | 'IMMEDIATE',
			shareTags: source.shareTags as Array<{ key: string; label: string }>,
			batchId: source.batchId,
			catalogItemId: source.catalogItemId
		},
		actor
	);
}

/* ----------------------------------------------------------- list + stats -- */

export type OrderLinkStats = { orders: number; quantity: number; expected: number };

/** Links with per-link stats. CANCELLED orders never count (§12 measurable links).
 *  NOTE the raw qualified columns in the subqueries — interpolating drizzle columns
 *  inside a correlated sql`` renders them unqualified (known gotcha). */
export async function listOrderLinks(
	tenantId: string,
	options: { includeArchived?: boolean } = {}
): Promise<Array<{ link: schema.OrderLink; stats: OrderLinkStats }>> {
	const rows = (await db().execute(sql`
		select ol.*,
			(select count(*)::int from orders o where o.order_link_id = ol.id and o.status not in ('CANCELLED','REFUNDED')) as stat_orders,
			(select coalesce(sum(i.quantity), 0)::int from orders o join order_items i on i.order_id = o.id
				where o.order_link_id = ol.id and o.status not in ('CANCELLED','REFUNDED')) as stat_quantity,
			(select coalesce(sum(o.total), 0) from orders o where o.order_link_id = ol.id and o.status not in ('CANCELLED','REFUNDED')) as stat_expected
		from order_links ol
		where ol.tenant_id = ${tenantId}::uuid
			${options.includeArchived ? sql`` : sql`and ol.status <> 'ARCHIVED'`}
		order by ol.created_at desc
	`)) as unknown as Array<Record<string, unknown>>;

	return rows.map((r) => ({
		link: {
			id: r.id,
			tenantId: r.tenant_id,
			publicId: r.public_id,
			status: r.status,
			title: r.title,
			description: r.description,
			imageUrl: r.image_url,
			unit: r.unit,
			unitPrice: r.unit_price,
			currency: r.currency,
			minQuantity: r.min_quantity,
			maxQuantity: r.max_quantity,
			capacityTotal: r.capacity_total,
			deadline: r.deadline,
			deliveryDate: r.delivery_date,
			pickupEnabled: r.pickup_enabled,
			deliveryEnabled: r.delivery_enabled,
			deliveryFee: r.delivery_fee,
			fieldConfig: r.field_config,
			paymentTiming: r.payment_timing,
			shareTags: r.share_tags,
			batchId: r.batch_id,
			catalogItemId: r.catalog_item_id,
			viewCount: r.view_count,
			metadata: r.metadata,
			createdByUserId: r.created_by_user_id,
			createdAt: r.created_at,
			updatedAt: r.updated_at
		} as schema.OrderLink,
		stats: {
			orders: Number(r.stat_orders ?? 0),
			quantity: Number(r.stat_quantity ?? 0),
			expected: dec(r.stat_expected as string)
		}
	}));
}

/** Orders per share tag for one link — §13 lightweight source ranking. */
export async function orderLinkSourceBreakdown(
	tenantId: string,
	id: string
): Promise<Array<{ tag: string; orders: number; quantity: number }>> {
	await getOwnedLink(tenantId, id);
	const rows = (await db().execute(sql`
		select coalesce(o.metadata->'orderLink'->>'tag', '') as tag,
			count(distinct o.id)::int as orders,
			coalesce(sum(i.quantity), 0)::int as quantity
		from orders o join order_items i on i.order_id = o.id
		where o.order_link_id = ${id}::uuid and o.tenant_id = ${tenantId}::uuid and o.status not in ('CANCELLED','REFUNDED')
		group by 1 order by 2 desc
	`)) as unknown as Array<{ tag: string; orders: number; quantity: number }>;
	return rows.map((r) => ({ tag: r.tag || 'direct', orders: Number(r.orders), quantity: Number(r.quantity) }));
}

/* --------------------------------------------------------------- public --- */

export type PublicOrderLink = {
	publicId: string;
	business: { name: string; logoUrl: string | null };
	title: string;
	description: string | null;
	imageUrl: string | null;
	unit: string;
	unitPrice: string;
	currency: string;
	minQuantity: number;
	/** Per-order ceiling after capacity is considered; null = no ceiling. */
	maxOrderable: number | null;
	deliveryDate: string | null;
	deadline: string | null;
	pickupEnabled: boolean;
	deliveryEnabled: boolean;
	deliveryFee: string;
	fields: Record<string, FieldMode>;
	/** OPEN | CLOSED (deadline/paused/archived) | SOLD_OUT */
	state: 'OPEN' | 'CLOSED' | 'SOLD_OUT';
};

async function acceptedQuantity(linkId: string): Promise<number> {
	const rows = (await db().execute(sql`
		select coalesce(sum(i.quantity), 0)::int as n
		from orders o join order_items i on i.order_id = o.id
		where o.order_link_id = ${linkId}::uuid and o.status not in ('CANCELLED','REFUNDED')
	`)) as unknown as Array<{ n: number }>;
	return Number(rows[0]?.n ?? 0);
}

/** The ONLY projection the public ever sees — no ids, no tenant internals (§25). */
export async function getPublicOrderLink(publicId: string): Promise<PublicOrderLink | null> {
	const rows = await db().select().from(schema.orderLinks).where(eq(schema.orderLinks.publicId, publicId)).limit(1);
	const link = rows[0];
	// DRAFT and unknown ids fail identically — nothing leaks about what exists.
	if (!link || link.status === 'DRAFT') return null;
	const tenant = await getTenantById(link.tenantId);
	if (!tenant || ['SUSPENDED', 'CANCELLED', 'PENDING'].includes(tenant.status)) return null;
	if (!(await can(link.tenantId, 'orderLinks.enabled'))) return null;

	let state: PublicOrderLink['state'] = 'OPEN';
	if (link.status !== 'ACTIVE') state = 'CLOSED';
	else if (link.deadline && new Date(link.deadline) < new Date()) state = 'CLOSED';

	let maxOrderable: number | null = link.maxQuantity ?? null;
	if (state === 'OPEN' && link.capacityTotal != null) {
		const taken = await acceptedQuantity(link.id);
		const remaining = link.capacityTotal - taken;
		if (remaining < link.minQuantity) state = 'SOLD_OUT';
		else maxOrderable = maxOrderable == null ? remaining : Math.min(maxOrderable, remaining);
	}

	return {
		publicId: link.publicId,
		business: { name: tenant.name, logoUrl: (tenant.settings as Record<string, unknown>)?.logoUrl as string | null },
		title: link.title,
		description: link.description,
		imageUrl: link.imageUrl,
		unit: link.unit,
		unitPrice: String(link.unitPrice),
		currency: link.currency,
		minQuantity: link.minQuantity,
		maxOrderable,
		deliveryDate: link.deliveryDate?.toISOString() ?? null,
		deadline: link.deadline?.toISOString() ?? null,
		pickupEnabled: link.pickupEnabled,
		deliveryEnabled: link.deliveryEnabled,
		deliveryFee: String(link.deliveryFee),
		fields: { ...DEFAULT_FIELDS, ...(link.fieldConfig as Record<string, FieldMode>) },
		state
	};
}

/** Best-effort view counter for conversion stats — never blocks the page. */
export async function registerOrderLinkView(publicId: string): Promise<void> {
	try {
		await db().execute(sql`update order_links set view_count = view_count + 1 where public_id = ${publicId}`);
	} catch {
		/* a lost view is fine */
	}
}

export type PublicSubmission = {
	name: string;
	whatsappPhone: string;
	email?: string;
	quantity: number;
	deliveryMethod: 'DELIVERY' | 'PICKUP';
	deliveryLocation?: string;
	note?: string;
	/** Client-generated idempotency token — resubmits return the same order (§21). */
	submissionToken: string;
	/** Provenance tag from ?s= — recorded, never trusted for anything else (§13). */
	sourceTag?: string;
};

type OrderLinkReceipt = {
	orderNumber: string;
	total: string;
	currency: string;
	quantity: number;
	unit: string;
	title: string;
};

async function replaySubmission(
	link: schema.OrderLink,
	submissionToken: string,
	quantity: number
): Promise<OrderLinkReceipt | null> {
	const existing = (await db().execute(sql`
		select o.order_number, o.total, o.currency,
			coalesce((select sum(i.quantity)::int from order_items i where i.order_id = o.id), ${quantity}) as quantity
		from orders o
		where o.order_link_id = ${link.id}::uuid and o.order_link_submission_token = ${submissionToken}
		limit 1
	`)) as unknown as Array<{ order_number: string; total: string; currency: string; quantity: number }>;
	if (!existing[0]) return null;
	// Echo the STORED order, never the caller's numbers — a replay must describe the
	// order that actually exists.
	return {
		orderNumber: existing[0].order_number,
		total: String(existing[0].total),
		currency: existing[0].currency,
		quantity: Number(existing[0].quantity),
		unit: link.unit,
		title: link.title
	};
}

function isUniqueViolation(err: unknown): boolean {
	return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505');
}

export async function submitOrderLink(
	publicId: string,
	input: PublicSubmission,
	ctx: { ipHash?: string | null }
): Promise<OrderLinkReceipt> {
	// Per-IP gate BEFORE resolution — floods against unknown ids are throttled too.
	await enforce(`order-link:ip:${ctx.ipHash ?? 'unknown'}`, 20, 300);

	const rows = await db().select().from(schema.orderLinks).where(eq(schema.orderLinks.publicId, publicId)).limit(1);
	const link = rows[0];
	if (!link || link.status === 'DRAFT') throw new AppError('NOT_FOUND', 'This order link does not exist.');
	await enforce(`order-link:link:${link.id}`, 60, 300);
	await assertAllowed(link.tenantId, { feature: 'orderLinks.enabled' });

	if (link.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Ordering for this offer has closed.');
	if (link.deadline && new Date(link.deadline) < new Date())
		throw new AppError('CONFLICT', 'Ordering for this offer has closed.');

	const name = input.name?.trim().slice(0, 120);
	if (!name) throw new AppError('VALIDATION_ERROR', 'Please tell us your name.');
	const phone = input.whatsappPhone?.trim().slice(0, 40);
	if (!phone || phone.replace(/\D/g, '').length < 7)
		throw new AppError('VALIDATION_ERROR', 'Enter a valid WhatsApp number.');
	if (!input.submissionToken || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.submissionToken)) {
		throw new AppError('VALIDATION_ERROR', 'Please reload the page and try again.');
	}

	const quantity = Number(input.quantity);
	if (!Number.isInteger(quantity) || quantity < link.minQuantity) {
		throw new AppError('VALIDATION_ERROR', `The minimum order is ${link.minQuantity} ${link.unit}.`);
	}
	if (link.maxQuantity != null && quantity > link.maxQuantity) {
		throw new AppError('VALIDATION_ERROR', `The maximum order is ${link.maxQuantity} ${link.unit}.`);
	}

	const method = input.deliveryMethod === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
	if (method === 'DELIVERY' && !link.deliveryEnabled)
		throw new AppError('VALIDATION_ERROR', 'Delivery is not available for this offer.');
	if (method === 'PICKUP' && !link.pickupEnabled)
		throw new AppError('VALIDATION_ERROR', 'Pickup is not available for this offer.');

	const fields = { ...DEFAULT_FIELDS, ...(link.fieldConfig as Record<string, FieldMode>) };
	const email = fields.email === 'HIDDEN' ? null : input.email?.trim().slice(0, 200) || null;
	if (fields.email === 'REQUIRED' && !email) throw new AppError('VALIDATION_ERROR', 'Please enter your email.');
	const note = fields.note === 'HIDDEN' ? null : input.note?.trim().slice(0, 1000) || null;
	if (fields.note === 'REQUIRED' && !note) throw new AppError('VALIDATION_ERROR', 'Please add a note.');
	const deliveryLocation =
		fields.deliveryLocation === 'HIDDEN' ? null : input.deliveryLocation?.trim().slice(0, 300) || null;
	if (method === 'DELIVERY' && fields.deliveryLocation !== 'HIDDEN' && !deliveryLocation) {
		throw new AppError('VALIDATION_ERROR', 'Please tell us where to deliver.');
	}

	// Fast replay for ordinary retries. The database uniqueness constraint below is
	// the actual concurrency primitive when two requests arrive at the same moment.
	const replayed = await replaySubmission(link, input.submissionToken, quantity);
	if (replayed) return replayed;

	// Capacity check as close to creation as possible. A rare concurrent race can
	// nudge past the cap — this is a soft selling cap, deliberately not inventory.
	if (link.capacityTotal != null) {
		const taken = await acceptedQuantity(link.id);
		if (taken + quantity > link.capacityTotal) {
			const remaining = Math.max(0, link.capacityTotal - taken);
			throw new AppError(
				'CONFLICT',
				remaining >= link.minQuantity
					? `Only ${remaining} ${link.unit} left — reduce the quantity.`
					: 'This offer is sold out.'
			);
		}
	}

	const tenant = await getTenantById(link.tenantId);
	if (!tenant) throw new AppError('NOT_FOUND', 'This order link does not exist.');

	const [firstName, ...rest] = name.split(/\s+/);
	const customer = await findOrCreateCustomer(
		link.tenantId,
		{ firstName, lastName: rest.join(' ') || undefined, whatsappPhone: phone, phone, email },
		tenant.country
	);

	const sourceTag =
		input.sourceTag && (link.shareTags as Array<{ key: string }>).some((t) => t.key === input.sourceTag)
			? input.sourceTag
			: null;

	// Batches only accept orders while OPEN — a closed batch must not kill the sale.
	let batchId: string | null = link.batchId;
	if (batchId) {
		const batch = await db()
			.select({ status: schema.orderBatches.status })
			.from(schema.orderBatches)
			.where(and(eq(schema.orderBatches.id, batchId), eq(schema.orderBatches.tenantId, link.tenantId)))
			.limit(1);
		if (batch[0]?.status !== 'OPEN') batchId = null;
	}

	let order: schema.Order;
	try {
		order = await createOrder(
			link.tenantId,
			{
				customerId: customer.id,
				status: 'PENDING_CONFIRMATION',
				source: 'ORDER_LINK',
				currency: link.currency,
				deliveryFee: method === 'DELIVERY' ? String(link.deliveryFee) : '0',
				deliveryMethod: method,
				deliveryLocation,
				deliveryDate: link.deliveryDate,
				batchId,
				orderLinkId: link.id,
				orderLinkSubmissionToken: input.submissionToken,
				notes: note,
				metadata: {
					orderLink: {
						id: link.id,
						publicId: link.publicId,
						title: link.title,
						...(sourceTag ? { tag: sourceTag } : {})
					},
					submissionToken: input.submissionToken
				},
				items: [
					{
						title: link.title,
						quantity,
						unit: link.unit,
						// Price ALWAYS from the link's configuration — never from the browser (§26).
						unitPrice: String(link.unitPrice),
						catalogItemId: link.catalogItemId
					}
				]
			},
			{}
		);
	} catch (err) {
		if (isUniqueViolation(err)) {
			const raced = await replaySubmission(link, input.submissionToken, quantity);
			if (raced) return raced;
		}
		throw err;
	}

	// IMMEDIATE payment timing rides the existing payment-request workflow. A failure
	// here must never lose the order — staff can request payment manually.
	if (link.paymentTiming === 'IMMEDIATE') {
		try {
			await createPaymentRequest(link.tenantId, { orderId: order.id });
		} catch (err) {
			log.warn('order_link_payment_request_failed', {
				tenantId: link.tenantId,
				orderId: order.id,
				message: (err as Error).message
			});
		}
	}

	log.info('order_link_order_created', { tenantId: link.tenantId, orderLinkId: link.id, orderId: order.id, quantity });
	return {
		orderNumber: order.orderNumber,
		total: String(order.total),
		currency: order.currency,
		quantity,
		unit: link.unit,
		title: link.title
	};
}
