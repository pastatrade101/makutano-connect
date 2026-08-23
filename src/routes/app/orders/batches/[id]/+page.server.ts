// One batch, operationally: summary numbers, the customer list, and entry fast enough
// to record 30-100 WhatsApp orders in one sitting (§8-§11).
import { error, fail, type Actions } from '@sveltejs/kit';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { batchOrders, batchSummary, createBatchOrder, getBatch, updateBatch } from '$lib/server/order-batches';
import { createCustomer } from '$lib/server/customers';
import { changeOrderStatus, getOrder } from '$lib/server/orders';
import { createPayment } from '$lib/server/payments';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'batch id');

export const load: PageServerLoad = async ({ locals, params }) => {
	requireTenantPermission(locals, 'orders:read');
	const tenantId = requireTenant(locals).id;
	const batchId = idOf(params);
	try {
		const [batch, summary, orders, customers] = await Promise.all([
			getBatch(tenantId, batchId),
			batchSummary(tenantId, batchId),
			batchOrders(tenantId, batchId),
			db()
				.select({
					id: schema.customers.id,
					firstName: schema.customers.firstName,
					lastName: schema.customers.lastName,
					whatsappPhone: schema.customers.whatsappPhone
				})
				.from(schema.customers)
				.where(and(eq(schema.customers.tenantId, tenantId), sql`${schema.customers.deletedAt} is null`))
				.orderBy(desc(schema.customers.updatedAt))
				.limit(400)
		]);
		return { batch, summary, orders, customers };
	} catch {
		error(404, 'Batch not found');
	}
};

/** Existing customer by id, or a quick-created one from "Name | phone?". */
async function resolveCustomer(
	tenantId: string,
	country: string | null,
	customerId: string,
	newName: string,
	newPhone: string
): Promise<string> {
	if (customerId) return customerId;
	const name = newName.trim();
	if (!name) throw new Error('Choose a customer or type a name to create one.');
	const [firstName, ...rest] = name.split(/\s+/);
	// Same-name reuse: "Mama Daniel" twice in one batch is almost always the same person.
	const existing = await db()
		.select({ id: schema.customers.id })
		.from(schema.customers)
		.where(
			and(
				eq(schema.customers.tenantId, tenantId),
				sql`${schema.customers.deletedAt} is null`,
				newPhone
					? or(ilike(schema.customers.whatsappPhone, `%${newPhone.replace(/\D/g, '').slice(-9)}%`), ilike(schema.customers.firstName, firstName))
					: sql`lower(trim(${schema.customers.firstName} || ' ' || ${schema.customers.lastName})) = ${name.toLowerCase()}`
			)
		)
		.limit(1);
	if (existing[0]) return existing[0].id;
	const created = await createCustomer(
		tenantId,
		{ firstName, lastName: rest.join(' '), phone: newPhone || undefined, whatsappPhone: newPhone || undefined, source: 'ADMIN' },
		country
	);
	return created.id;
}

export const actions: Actions = {
	/** Fast entry: customer + quantity. Everything else comes from the batch. */
	addOrder: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const quantity = Number(data.get('quantity'));
		if (!Number.isFinite(quantity) || quantity < 1) return fail(400, { message: 'Enter a quantity of at least 1.' });

		try {
			const customerId = await resolveCustomer(
				tenant.id,
				tenant.country,
				String(data.get('customerId') ?? ''),
				String(data.get('newCustomerName') ?? ''),
				String(data.get('newCustomerPhone') ?? '')
			);
			const order = await createBatchOrder(
				tenant.id,
				idOf(params),
				{
					customerId,
					quantity,
					source: (String(data.get('source') ?? '') || 'MANUAL') as never,
					paymentMethod: String(data.get('paymentMethod') ?? '') || null
				},
				{ userId: locals.user!.id }
			);
			return { added: { orderNumber: order.orderNumber, total: order.total, currency: order.currency } };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/**
	 * Bulk entry: one order per line, "Name | quantity" (or "Name  4"). Deterministic
	 * parsing only — no AI, no screenshots (§11). Lines that fail are reported back
	 * verbatim so the operator can fix them; good lines are still created.
	 */
	bulkAdd: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const source = (String(data.get('source') ?? '') || 'WHATSAPP_GROUP') as never;
		const lines = String(data.get('lines') ?? '')
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.slice(0, 200);
		if (!lines.length) return fail(400, { message: 'Paste at least one line, e.g. "Mama Daniel | 4".' });

		let created = 0;
		const failed: string[] = [];
		for (const line of lines) {
			const match = line.match(/^(.+?)[|,\t]\s*(\d+)\s*$/) ?? line.match(/^(.+?)\s+(\d+)\s*$/);
			if (!match) {
				failed.push(line);
				continue;
			}
			try {
				const customerId = await resolveCustomer(tenant.id, tenant.country, '', match[1].trim(), '');
				await createBatchOrder(
					tenant.id,
					idOf(params),
					{ customerId, quantity: Number(match[2]), source },
					{ userId: locals.user!.id }
				);
				created++;
			} catch (err) {
				failed.push(`${line} — ${toAppError(err).message}`);
			}
		}
		return { bulk: { created, failed } };
	},

	/** One-tap status moves from the table row. Validated by the same state machine. */
	status: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const data = await request.formData();
		try {
			await changeOrderStatus(
				requireTenant(locals).id,
				parseUuid(String(data.get('orderId') ?? ''), 'order id'),
				String(data.get('status')) as never,
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Mark paid: records a MANUAL payment for the outstanding amount (§16). */
	markPaid: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'payments:write');
		const tenantId = requireTenant(locals).id;
		const data = await request.formData();
		const orderId = parseUuid(String(data.get('orderId') ?? ''), 'order id');
		try {
			const order = await getOrder(tenantId, orderId);
			const outstanding = Math.max(0, Number(order.total) - Number(order.amountPaid));
			const amountRaw = String(data.get('amount') ?? '').replace(/[, ]/g, '');
			const amount = amountRaw ? Number(amountRaw) : outstanding;
			if (!Number.isFinite(amount) || amount <= 0) return fail(400, { message: 'Nothing left to pay on this order.' });
			await createPayment(
				tenantId,
				{
					orderId,
					amount: amount.toFixed(2),
					provider: 'MANUAL',
					description: String(data.get('method') ?? '') || order.paymentMethod || 'Recorded in batch view'
				},
				{ userId: locals.user!.id }
			);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Close/reopen the batch to new orders. Existing orders are untouched. */
	setStatus: async ({ locals, params, request }) => {
		requirePermission(locals.permissions, 'orders:write');
		const data = await request.formData();
		const status = String(data.get('status'));
		if (status !== 'OPEN' && status !== 'CLOSED') return fail(400, { message: 'Invalid batch status.' });
		try {
			await updateBatch(requireTenant(locals).id, idOf(params), { status }, { userId: locals.user!.id });
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
