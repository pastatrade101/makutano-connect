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
	const canPay = $derived(data.permissions?.includes('payments:write') && data.entitlements?.['payments.enabled'] === true);

	/** The happy path as buttons; destructive moves live in quiet links below. */
	const FORWARD: Record<string, Array<{ to: string; label: string }>> = {
		DRAFT: [{ to: 'CONFIRMED', label: 'Confirm order' }],
		PENDING_CONFIRMATION: [{ to: 'CONFIRMED', label: 'Confirm order' }],
		CONFIRMED: [
			{ to: 'READY', label: 'Mark ready' },
			{ to: 'DISPATCHED', label: 'Dispatch' }
		],
		PROCESSING: [{ to: 'READY', label: 'Mark ready' }],
		READY: [
			{ to: 'DISPATCHED', label: 'Dispatch' },
			{ to: 'DELIVERED', label: 'Delivered' }
		],
		DISPATCHED: [{ to: 'DELIVERED', label: 'Delivered' }]
	};
	const DESTRUCTIVE: Record<string, Array<{ to: string; label: string }>> = {
		DRAFT: [{ to: 'CANCELLED', label: 'Cancel order' }],
		PENDING_CONFIRMATION: [{ to: 'CANCELLED', label: 'Cancel order' }],
		CONFIRMED: [{ to: 'CANCELLED', label: 'Cancel order' }],
		PROCESSING: [{ to: 'CANCELLED', label: 'Cancel order' }],
		READY: [{ to: 'CANCELLED', label: 'Cancel order' }],
		DISPATCHED: [{ to: 'CANCELLED', label: 'Cancel order' }],
		DELIVERED: [{ to: 'REFUNDED', label: 'Refund' }],
		CANCELLED: [{ to: 'REFUNDED', label: 'Refund' }]
	};
	const forward = $derived(FORWARD[data.order.status] ?? []);
	const destructive = $derived(DESTRUCTIVE[data.order.status] ?? []);
	const outstanding = $derived(Math.max(0, Number(data.order.total) - Number(data.order.amountPaid)));
	let confirmDestructive = $state<string | null>(null);
	let showRequestPanel = $state(false);
	let requestAmount = $state('');
	let selectedMethodKey = $state('');
	$effect(() => {
		if (!data.payMethods.some((method) => method.key === selectedMethodKey)) selectedMethodKey = data.payMethods[0]?.key ?? '';
	});
	const customerName = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || '—');
	const activeRequest = $derived(
		data.paymentRequests.find((request) => ['REQUESTED', 'REPORTED', 'PARTIALLY_PAID'].includes(request.status)) ?? null
	);
	const selectedMethod = $derived(data.payMethods.find((method) => method.key === selectedMethodKey) ?? data.payMethods[0] ?? null);
	const requestReady = $derived(
		!!selectedMethod &&
		!!data.customer?.whatsappPhone &&
		data.requestTemplateReady &&
		Number(requestAmount) > 0 &&
		Number(requestAmount) <= outstanding
	);
</script>

<svelte:head><title>{data.order.orderNumber} · {data.tenant.name}</title></svelte:head>

	<FormToast {form} successTitle="Order updated" />
	{#if form?.warning}<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#8a6815]">{form.warning}</p>{/if}

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
			<div class="flex flex-wrap items-center gap-1.5">
				{#if canPay && outstanding > 0 && !activeRequest && !['CANCELLED', 'REFUNDED'].includes(data.order.status)}
					<button class="btn-primary" onclick={() => { requestAmount = outstanding.toFixed(2); showRequestPanel = !showRequestPanel; }}>Request payment</button>
				{/if}
				{#if canPay && activeRequest && activeRequest.status !== 'REPORTED'}
					<form method="POST" action="?/remindPayment" use:enhance>
						<input type="hidden" name="requestId" value={activeRequest.id} />
						<button class="btn-secondary">Send payment reminder</button>
					</form>
				{/if}
			{#if canWrite}
				{#each forward as move, i (move.to)}
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="status" value={move.to} />
						<button class={i === 0 ? 'btn-primary' : 'btn-secondary'}>{move.label}</button>
					</form>
				{/each}
			{/if}
			{#if canPay && outstanding > 0 && !['CANCELLED', 'REFUNDED'].includes(data.order.status)}
				<form method="POST" action="?/payment" use:enhance>
					<input type="hidden" name="amount" value={outstanding.toFixed(2)} />
					<input type="hidden" name="provider" value="MANUAL" />
					<input type="hidden" name="description" value="Marked paid" />
					<button class="btn-secondary text-success">Mark paid</button>
				</form>
			{/if}
		</div>
		</div>

		{#if showRequestPanel}
			<form
				method="POST"
				action="?/requestPayment"
				use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') showRequestPanel = false; }}
				class="card space-y-3 p-4"
			>
				<h2 class="card-title">Request payment</h2>
				<dl class="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
					<div class="flex justify-between sm:block"><dt class="text-slate-400">Customer</dt><dd class="font-medium text-slate-700">{customerName}</dd></div>
					<div class="flex justify-between sm:block"><dt class="text-slate-400">Order</dt><dd class="font-medium text-slate-700">{data.order.orderNumber}</dd></div>
				</dl>
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="label" for="pr-amount">Amount to request ({data.order.currency})</label>
						<input id="pr-amount" name="amount" inputmode="decimal" bind:value={requestAmount} class="input" />
						<p class="mt-1 text-[11px] text-slate-400">Outstanding: {data.order.currency} {outstanding.toFixed(2)}</p>
					</div>
					<div>
						<label class="label" for="pr-method">Payment method</label>
						{#if data.payMethods.length}
							<select id="pr-method" name="methodKey" class="input" bind:value={selectedMethodKey}>
								{#each data.payMethods as method (method.key)}<option value={method.key}>{method.displayName}</option>{/each}
							</select>
						{:else}
							<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">Add a usable method in <a href="/app/settings" class="font-semibold underline">Settings</a>.</p>
						{/if}
					</div>
					{#if selectedMethod}
						<dl class="rounded-panel bg-slate-50 p-3 text-xs sm:col-span-2">
							<div class="flex gap-3"><dt class="w-28 shrink-0 text-slate-400">Payment details</dt><dd class="font-medium text-slate-700">{selectedMethod.summary}</dd></div>
							<div class="mt-1 flex gap-3"><dt class="w-28 shrink-0 text-slate-400">Reference</dt><dd class="font-mono font-medium text-slate-700">{data.order.orderNumber}</dd></div>
						</dl>
					{/if}
				</div>
				<div class="flex items-center justify-between gap-2">
					<p class="text-[11px] text-slate-500">
						{#if !data.customer?.whatsappPhone}Add the customer's WhatsApp number.
						{:else if !data.requestTemplateReady}The payment request template is not approved and enabled yet.
						{:else if requestReady}WhatsApp: ready to send ✓
						{:else}Choose valid payment details and amount.{/if}
					</p>
					<div class="flex gap-2"><button type="button" class="btn-secondary" onclick={() => (showRequestPanel = false)}>Cancel</button><button class="btn-primary" disabled={!requestReady}>Request payment</button></div>
				</div>
			</form>
		{/if}

		{#if data.paymentRequests.length}
			<div class="card divide-y divide-slate-100">
				{#each data.paymentRequests as request (request.id)}
					<div class="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
						<span class="font-medium text-slate-700">{request.currency} {request.amountRequested} requested</span>
						<StatusBadge value={request.status} size="xs" />
						{#if request.status === 'REPORTED'}<a href="/app/payments?verify={request.id}" class="font-semibold text-brand-600 hover:underline">Verify payment</a>{/if}
						<span class="ml-auto text-slate-400"><TimeAgo value={request.createdAt} timezone={tz} /></span>
					</div>
				{/each}
			</div>
		{/if}

		{#if canWrite && destructive.length}
		<div class="flex justify-end gap-3 text-[11px]">
			{#each destructive as move (move.to)}
				{#if confirmDestructive === move.to}
					<form method="POST" action="?/status" use:enhance={() => async ({ update }) => { await update(); confirmDestructive = null; }} class="flex items-center gap-2">
						<input type="hidden" name="status" value={move.to} />
						<input name="reason" placeholder="Reason (optional)" class="input !py-1 w-40 text-[11px]" />
						<button class="font-semibold text-danger hover:underline">Yes, {move.label.toLowerCase()}</button>
						<button type="button" class="text-slate-400 hover:underline" onclick={() => (confirmDestructive = null)}>Keep it</button>
					</form>
				{:else}
					<button class="text-slate-400 hover:text-danger hover:underline" onclick={() => (confirmDestructive = move.to)}>{move.label}</button>
				{/if}
			{/each}
		</div>
	{/if}

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
