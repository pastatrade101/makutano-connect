// Order Links management: one offer → one public link → structured orders.
import { fail, type Actions } from '@sveltejs/kit';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { listBatches } from '$lib/server/order-batches';
import {
	createOrderLink,
	duplicateOrderLink,
	listOrderLinks,
	orderLinkSourceBreakdown,
	setOrderLinkStatus,
	updateOrderLink,
	UNIT_PRESETS,
	type FieldMode,
	type OrderLinkInput
} from '$lib/server/order-links';
import { toAppError } from '$lib/server/errors';
import { env } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'order_links:read');
	const tenant = requireTenant(locals);
	const includeArchived = url.searchParams.get('archived') === '1';
	const [links, batches] = await Promise.all([
		listOrderLinks(tenant.id, { includeArchived }),
		listBatches(tenant.id, { page: 1, limit: 100, order: 'desc' }, { status: 'OPEN' }).catch(() => ({ items: [] }))
	]);
	const detailId = url.searchParams.get('detail');
	const breakdown = detailId ? await orderLinkSourceBreakdown(tenant.id, detailId).catch(() => []) : [];
	return {
		links: links.map(({ link, stats }) => ({ ...link, stats })),
		batches: ('items' in batches ? batches.items : []).map((b: { batch: { id: string; name: string } }) => ({
			id: b.batch.id,
			name: b.batch.name
		})),
		unitPresets: UNIT_PRESETS,
		includeArchived,
		detailId,
		breakdown,
		origin: env().PUBLIC_APP_URL || url.origin,
		canWrite: locals.permissions?.includes('order_links:write') ?? false,
		canArchive: locals.permissions?.includes('order_links:archive') ?? false
	};
};

function parseInput(data: FormData): OrderLinkInput {
	const opt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || undefined;
	const int = (v: FormDataEntryValue | null) => {
		const s = String(v ?? '').trim();
		if (!s) return undefined;
		const n = Number(s);
		return Number.isFinite(n) ? Math.floor(n) : NaN;
	};
	const date = (v: FormDataEntryValue | null) => {
		const s = String(v ?? '').trim();
		if (!s) return null;
		const d = new Date(s);
		return Number.isNaN(d.getTime()) ? null : d;
	};
	const mode = (v: FormDataEntryValue | null): FieldMode => {
		const s = String(v ?? 'OPTIONAL');
		return s === 'HIDDEN' || s === 'REQUIRED' ? s : 'OPTIONAL';
	};
	const unit = String(data.get('unit') ?? '');
	const shareTags = String(data.get('shareTags') ?? '')
		.split(',')
		.map((label) => label.trim())
		.filter(Boolean)
		.slice(0, 12)
		.map((label) => ({
			label: label.slice(0, 60),
			key: label
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40)
		}))
		.filter((t) => t.key);

	return {
		title: String(data.get('title') ?? ''),
		description: opt(data.get('description')) ?? null,
		imageUrl: opt(data.get('imageUrl')) ?? null,
		unit: unit === 'CUSTOM' ? String(data.get('customUnit') ?? '') : unit,
		unitPrice: String(data.get('unitPrice') ?? '').trim(),
		currency:
			String(data.get('currency') ?? '')
				.trim()
				.toUpperCase() || undefined,
		minQuantity: int(data.get('minQuantity')) ?? 1,
		maxQuantity: int(data.get('maxQuantity')) ?? null,
		capacityTotal: int(data.get('capacityTotal')) ?? null,
		deadline: date(data.get('deadline')),
		deliveryDate: date(data.get('deliveryDate')),
		pickupEnabled: data.get('pickupEnabled') === 'on',
		deliveryEnabled: data.get('deliveryEnabled') === 'on',
		deliveryFee: String(data.get('deliveryFee') ?? '').trim() || '0',
		fieldConfig: {
			email: mode(data.get('f_email')),
			deliveryLocation: mode(data.get('f_deliveryLocation')),
			note: mode(data.get('f_note'))
		},
		paymentTiming: String(data.get('paymentTiming')) === 'IMMEDIATE' ? 'IMMEDIATE' : 'AFTER_CONFIRMATION',
		shareTags,
		batchId: opt(data.get('batchId')) ?? null
	};
}

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'order_links:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		try {
			const link = await createOrderLink(tenant.id, parseInput(data), { userId: locals.user!.id });
			// A new link goes live immediately — creating then hunting for "activate" is friction.
			if (data.get('activate') === 'on')
				await setOrderLinkStatus(tenant.id, link.id, 'ACTIVE', { userId: locals.user!.id });
			return { success: true, createdId: link.id };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	update: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'order_links:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		try {
			await updateOrderLink(tenant.id, String(data.get('id') ?? ''), parseInput(data), { userId: locals.user!.id });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	setStatus: async ({ locals, request }) => {
		const data = await request.formData();
		const status = String(data.get('status') ?? '') as 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
		requirePermission(locals.permissions, status === 'ARCHIVED' ? 'order_links:archive' : 'order_links:write');
		const tenant = requireTenant(locals);
		try {
			await setOrderLinkStatus(tenant.id, String(data.get('id') ?? ''), status, { userId: locals.user!.id });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	duplicate: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'order_links:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		try {
			await duplicateOrderLink(tenant.id, String(data.get('id') ?? ''), { userId: locals.user!.id });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
