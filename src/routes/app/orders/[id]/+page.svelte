<script lang="ts">
	import { sourceLabel, statusLabel } from '$lib/labels';
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const tz = $derived(data.tenant.timezone);
	const canWrite = $derived(data.permissions?.includes('orders:write'));
	const canPay = $derived(data.permissions?.includes('payments:write'));

	const NEXT: Record<string, string[]> = {
		DRAFT: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
		PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
		CONFIRMED: ['PROCESSING', 'READY', 'DISPATCHED', 'CANCELLED'],
		PROCESSING: ['READY', 'DISPATCHED', 'CANCELLED'],
		READY: ['DISPATCHED', 'DELIVERED', 'CANCELLED'],
		DISPATCHED: ['DELIVERED', 'CANCELLED'],
		DELIVERED: ['REFUNDED'],
		CANCELLED: ['REFUNDED'],
		REFUNDED: []
	};
	const nextStatuses = $derived(NEXT[data.order.status] ?? []);
	const customerName = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || '—');
</script>

<svelte:head><title>{data.order.orderNumber} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Order updated" />

<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/orders" class="text-xs text-slate-500 hover:underline">← Orders</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-800">
				{data.order.orderNumber}
				<StatusBadge value={data.order.status} />
				<StatusBadge value={data.order.paymentStatus} size="xs" />
			</h1>
		</div>
		{#if canWrite && nextStatuses.length}
			<form method="POST" action="?/status" use:enhance class="flex items-center gap-2">
				<select name="status" class="input w-auto">
					{#each nextStatuses as s (s)}<option value={s}>{statusLabel(s)}</option>{/each}
				</select>
				<input name="reason" placeholder="Reason (optional)" class="input w-auto" />
				<button class="btn-primary">Move</button>
			</form>
		{/if}
	</div>

	{#if data.order.status === 'DRAFT' || data.order.status === 'PENDING_CONFIRMATION'}
		<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">
			This order awaits confirmation — verify the items, prices, customer and delivery details, then move it to CONFIRMED.
			{#if canWrite}<a href="/app/orders/new?edit={data.order.id}" class="font-semibold underline">Edit items</a>{/if}
		</p>
	{/if}

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Total</div><div class="text-lg font-bold"><Money amount={data.order.total} currency={data.order.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Paid</div><div class="text-lg font-bold text-success"><Money amount={data.order.amountPaid} currency={data.order.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Delivery</div><div class="text-sm font-semibold">{data.order.deliveryMethod ?? '—'}{#if data.order.deliveryDate} · {new Date(data.order.deliveryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{/if}</div><div class="truncate text-[11px] text-slate-400">{data.order.deliveryLocation ?? ''}</div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Source</div><div class="text-sm font-semibold">{sourceLabel(data.order.source)}</div>{#if data.batch}<a href="/app/orders/batches/{data.batch.id}" class="truncate text-[11px] text-brand-600 hover:underline">{data.batch.name}</a>{:else if data.order.paymentMethod}<div class="truncate text-[11px] text-slate-400">{data.order.paymentMethod}</div>{/if}</div>
	</div>

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="card-header"><h2 class="card-title">Items</h2></header>
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Variant</th><th class="table-head">Qty</th><th class="table-head">Unit</th><th class="table-head">Total</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as item (item.id)}
							<tr>
								<td class="table-cell">
									<div class="font-medium text-slate-700">{item.title}</div>
									{#if item.sku || item.externalReference}<div class="font-mono text-[11px] text-slate-400">{item.sku ?? item.externalReference}</div>{/if}
								</td>
								<td class="table-cell text-slate-500">{item.variant ?? '—'}</td>
								<td class="table-cell tabular-nums">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
								<td class="table-cell"><Money amount={item.unitPrice} currency={data.order.currency} /></td>
								<td class="table-cell"><Money amount={item.total} currency={data.order.currency} /></td>
							</tr>
						{/each}
					</tbody>
					<tfoot class="bg-slate-50 text-sm">
						<tr><td colspan="4" class="table-cell text-right text-slate-500">Subtotal</td><td class="table-cell"><Money amount={data.order.subtotal} currency={data.order.currency} /></td></tr>
						{#if Number(data.order.discount) > 0}<tr><td colspan="4" class="table-cell text-right text-slate-500">Discount</td><td class="table-cell text-success">−<Money amount={data.order.discount} currency={data.order.currency} /></td></tr>{/if}
						{#if Number(data.order.deliveryFee) > 0}<tr><td colspan="4" class="table-cell text-right text-slate-500">Delivery</td><td class="table-cell"><Money amount={data.order.deliveryFee} currency={data.order.currency} /></td></tr>{/if}
						<tr class="font-bold"><td colspan="4" class="table-cell text-right">Total</td><td class="table-cell"><Money amount={data.order.total} currency={data.order.currency} /></td></tr>
					</tfoot>
				</table>
			</section>

			<section class="card">
				<header class="card-header"><h2 class="card-title">Payments</h2></header>
				{#if canPay}
					<form method="POST" action="?/payment" use:enhance class="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
						<div><label class="label" for="amount">Amount</label><input id="amount" name="amount" placeholder="0.00" class="input w-32" /></div>
						<div><label class="label" for="provider">Method</label><select id="provider" name="provider" class="input w-auto"><option value="MANUAL">Cash / mobile money</option><option value="BANK_TRANSFER">Bank transfer</option></select></div>
						<div class="flex-1"><label class="label" for="description">Reference / note</label><input id="description" name="description" placeholder="M-Pesa TX123… (optional)" class="input" /></div>
						<button class="btn-primary">Record</button>
					</form>
				{/if}
				<table class="min-w-full divide-y divide-slate-100">
					<tbody class="divide-y divide-slate-100">
						{#each data.payments as p (p.id)}
							<tr>
								<td class="table-cell font-mono text-xs">{p.reference}</td>
								<td class="table-cell text-[11px] uppercase text-slate-400">{p.provider}</td>
								<td class="table-cell"><StatusBadge value={p.status} size="xs" /></td>
								<td class="table-cell"><Money amount={p.amount} currency={p.currency} /></td>
								<td class="table-cell text-slate-500"><TimeAgo value={p.createdAt} timezone={tz} /></td>
							</tr>
						{:else}
							<tr><td class="px-3 py-6 text-center text-xs text-slate-400">No payments recorded — the order can still be confirmed.</td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		</div>

		<div class="space-y-3">
			<section class="card">
				<header class="card-header"><h2 class="card-title">Customer</h2></header>
				<div class="space-y-1 p-3 text-sm">
					<div class="font-medium text-slate-700">{customerName}</div>
					{#if data.customer?.whatsappPhone}<div class="text-slate-500">+{data.customer.whatsappPhone}</div>{/if}
					{#if data.customer?.email}<div class="text-slate-500">{data.customer.email}</div>{/if}
					{#if data.conversation}
						<a href="/app/conversations/{data.conversation.id}" class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
							<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h14v9H7l-4 3V4Z" /></svg>
							Open WhatsApp conversation →
						</a>
					{/if}
				</div>
			</section>

			{#if data.order.notes}
				<section class="card">
					<header class="card-header"><h2 class="card-title">Notes</h2></header>
					<p class="whitespace-pre-wrap p-3 text-sm text-slate-600">{data.order.notes}</p>
				</section>
			{/if}

			<section class="card">
				<header class="card-header"><h2 class="card-title">Status history</h2></header>
				<ul class="divide-y divide-slate-100">
					{#each data.history as h (h.id)}
						<li class="px-3 py-2 text-xs">
							<div class="flex items-center gap-1">
								{#if h.fromStatus}<StatusBadge value={h.fromStatus} size="xs" /><span class="text-slate-400">→</span>{/if}
								<StatusBadge value={h.toStatus} size="xs" />
							</div>
							{#if h.reason}<p class="mt-1 text-slate-500">{h.reason}</p>{/if}
							<p class="mt-0.5 text-slate-400"><TimeAgo value={h.createdAt} timezone={tz} /></p>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>
