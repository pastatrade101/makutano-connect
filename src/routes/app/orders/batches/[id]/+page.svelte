<script lang="ts">
	import { sourceLabel, statusLabel } from '$lib/labels';
	// The seller's pinned WhatsApp list, replaced. Mobile-first: cards on phones,
	// a table on wide screens; every routine action is one tap.
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	let { data, form } = $props();

	let quantity = $state('');
	let customerId = $state('');
	let customerQuery = $state('');
	let newCustomerPhone = $state('');
	let showBulk = $state(false);
	let adding = $state(false);
	let quantityInput = $state<HTMLInputElement | null>(null);
	let customerInput = $state<HTMLInputElement | null>(null);
	let lastAdded = $state<{ orderNumber: string; total: string; currency: string } | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | null = null;

	const open = $derived(data.batch.status === 'OPEN');
	const price = $derived(Number(data.batch.defaultUnitPrice) || 0);
	const liveTotal = $derived((Number(quantity) || 0) * price);

	const matches = $derived.by(() => {
		const q = customerQuery.trim().toLowerCase();
		if (!q) return [];
		const digits = q.replace(/\D/g, '');
		return data.customers
			.filter(
				(c) =>
					`${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
					(digits.length >= 3 && (c.whatsappPhone ?? '').includes(digits))
			)
			.slice(0, 6);
	});
	const selected = $derived(data.customers.find((c) => c.id === customerId) ?? null);
	const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(' ');

	function pick(c: (typeof data.customers)[number]) {
		customerId = c.id;
		customerQuery = fullName(c);
		quantityInput?.focus();
	}
	const fmtDate = (d: string | Date | null) =>
		d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'No date set';

	/** Row actions valid from each status — mirrors the server's state machine. */
	const NEXT: Record<string, Array<{ to: string; label: string }>> = {
		PENDING_CONFIRMATION: [{ to: 'CONFIRMED', label: 'Confirm' }],
		CONFIRMED: [
			{ to: 'READY', label: 'Ready' },
			{ to: 'DISPATCHED', label: 'Dispatch' }
		],
		PROCESSING: [{ to: 'READY', label: 'Ready' }],
		READY: [
			{ to: 'DISPATCHED', label: 'Dispatch' },
			{ to: 'DELIVERED', label: 'Delivered' }
		],
		DISPATCHED: [{ to: 'DELIVERED', label: 'Delivered' }]
	};
</script>

<svelte:head><title>{data.batch.name} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Done" />

<div class="space-y-3">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="min-w-0">
			<a href="/app/orders/batches" class="text-xs text-slate-500 hover:underline">← Batches</a>
			<h1 class="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-800">
				{data.batch.name}
				<span class="badge {open ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-500'}">{open ? 'Open' : 'Closed'}</span>
			</h1>
			<p class="text-xs text-slate-500">
				{data.batch.defaultItemTitle} · <Money amount={data.batch.defaultUnitPrice} currency={data.batch.currency} />{data.batch.defaultUnit ? ` / ${data.batch.defaultUnit}` : ''}
				· {fmtDate(data.batch.fulfilmentDate)}
			</p>
		</div>
		<form method="POST" action="?/setStatus" use:enhance>
			<input type="hidden" name="status" value={open ? 'CLOSED' : 'OPEN'} />
			<button class="btn-secondary text-xs">{open ? 'Close batch' : 'Reopen batch'}</button>
		</form>
	</div>

	<!-- Batch summary: the numbers the seller used to keep in a pinned message -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customers</div><div class="text-lg font-bold tabular-nums text-slate-800">{data.summary.customers}</div></div>
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantity</div><div class="text-lg font-bold tabular-nums text-slate-800">{data.summary.totalQuantity}{data.batch.defaultUnit ? ` ${data.batch.defaultUnit}` : ''}</div></div>
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Expected</div><div class="text-lg font-bold tabular-nums text-slate-800"><Money amount={data.summary.expectedRevenue} currency={data.batch.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Paid</div><div class="text-lg font-bold tabular-nums text-success"><Money amount={data.summary.paid} currency={data.batch.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Outstanding</div><div class="text-lg font-bold tabular-nums {Number(data.summary.outstanding) > 0 ? 'text-warning' : 'text-slate-800'}"><Money amount={data.summary.outstanding} currency={data.batch.currency} /></div></div>
	</div>

	{#if Object.keys(data.summary.statusCounts).length}
		<div class="flex flex-wrap gap-1.5 text-[11px]">
			{#each Object.entries(data.summary.statusCounts) as [status, n] (status)}
				<span class="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-600">{statusLabel(status)}: <b>{n}</b></span>
			{/each}
		</div>
	{/if}

	<!-- Fast entry: who + how many. Resets and refocuses after every add. -->
	{#if open}
		<form
			method="POST"
			action="?/addOrder"
			class="card p-3"
			use:enhance={() => {
				adding = true;
				return async ({ result, update }) => {
					adding = false;
					if (result.type === 'success') {
						// Flash the confirmation, clear, and put the cursor back where the
						// next customer's name goes — 30 entries should feel like one.
						lastAdded = (result.data as { added?: typeof lastAdded })?.added ?? null;
						if (flashTimer) clearTimeout(flashTimer);
						flashTimer = setTimeout(() => (lastAdded = null), 4000);
						customerId = '';
						customerQuery = '';
						quantity = '';
						newCustomerPhone = '';
						await invalidateAll();
						customerInput?.focus();
					} else {
						await update();
					}
				};
			}}
		>
			<div class="mb-2 flex items-center justify-between gap-2">
				<h2 class="card-title">Add order</h2>
				{#if lastAdded}
					<span class="truncate text-[11px] font-medium text-success">
						✓ {lastAdded.orderNumber} · {lastAdded.currency} {Number(lastAdded.total).toLocaleString()}
					</span>
				{/if}
			</div>
			{#if form?.message}
				<p class="mb-2 rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
			{/if}
			<div class="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
				<div class="relative">
					<input
						placeholder="Customer — search or type a new name"
						bind:value={customerQuery}
						oninput={() => {
							if (selected && customerQuery !== fullName(selected)) customerId = '';
						}}
						class="input h-11"
						autocomplete="off"
						bind:this={customerInput}
					/>
					<input type="hidden" name="customerId" value={customerId} />
					<input type="hidden" name="newCustomerName" value={customerId ? '' : customerQuery} />
					{#if matches.length && !customerId}
						<div class="absolute z-10 mt-1 w-full overflow-hidden rounded-panel border border-slate-200 bg-white shadow-lg">
							{#each matches as c (c.id)}
								<button type="button" class="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50" onclick={() => pick(c)}>
									<span>{fullName(c)}</span>
									{#if c.whatsappPhone}<span class="text-[11px] text-slate-400">+{c.whatsappPhone}</span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<input
					type="number"
					min="1"
					inputmode="numeric"
					name="quantity"
					bind:value={quantity}
					bind:this={quantityInput}
					placeholder={data.batch.defaultUnit ? `Qty (${data.batch.defaultUnit})` : 'Qty'}
					class="input h-11 text-center text-base font-semibold"
					required
				/>
				<div class="flex h-11 items-center justify-center rounded-panel bg-slate-50 px-2 text-sm font-semibold tabular-nums text-slate-700">
					{liveTotal > 0 ? `${data.batch.currency} ${liveTotal.toLocaleString()}` : '—'}
				</div>
				<button class="btn-primary h-11 min-w-28" disabled={adding || !quantity || (!customerId && !customerQuery.trim())}>
					{adding ? 'Adding…' : 'Add order'}
				</button>
			</div>
			{#if !customerId && customerQuery.trim() && !matches.length}
				<div class="mt-2 grid gap-2 sm:grid-cols-2">
					<p class="self-center text-[11px] text-slate-500">New customer "{customerQuery.trim()}" will be created.</p>
					<input name="newCustomerPhone" bind:value={newCustomerPhone} placeholder="WhatsApp number (optional)" inputmode="tel" class="input h-9 text-xs" />
				</div>
			{/if}
			<div class="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
				<label class="flex items-center gap-1.5">Source
					<select name="source" class="input w-auto !py-1 text-[11px]">
						{#each ['WHATSAPP_GROUP', 'WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'PHONE', 'WALK_IN', 'MANUAL', 'OTHER'] as s (s)}
							<option value={s}>{sourceLabel(s)}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-1.5">Payment
					<select name="paymentMethod" class="input w-auto !py-1 text-[11px]">
						<option value="">—</option>
						{#each ['Cash on Delivery', 'Mobile Payment', 'Bank Transfer', 'Other'] as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</label>
				<button type="button" class="ml-auto text-brand-600 hover:underline" onclick={() => (showBulk = !showBulk)}>
					{showBulk ? 'Hide bulk entry' : 'Bulk entry…'}
				</button>
			</div>
		</form>

		{#if showBulk}
			<!-- Bulk: paste the list the seller already has. Deterministic, no AI. -->
			<form method="POST" action="?/bulkAdd" use:enhance class="card p-3">
				<h2 class="card-title mb-1">Bulk entry</h2>
				<p class="mb-2 text-[11px] text-slate-500">One order per line: <code class="rounded bg-slate-100 px-1">Mama Daniel | 4</code> — name, then quantity.</p>
				<textarea name="lines" rows="6" class="input font-mono text-xs" placeholder={'Mama Daniel | 4\nNasri | 3\nHabiba | 5'}></textarea>
				{#if form?.bulk}
					<div class="mt-2 rounded-panel bg-slate-50 p-2 text-xs">
						<p class="text-success">Created {form.bulk.created} order{form.bulk.created === 1 ? '' : 's'}.</p>
						{#if form.bulk.failed.length}
							<p class="mt-1 text-danger">Could not read:</p>
							<ul class="mt-0.5 list-disc pl-4 text-slate-600">
								{#each form.bulk.failed as line (line)}<li>{line}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<div class="mt-2 flex items-center justify-between gap-2">
					<label class="flex items-center gap-1.5 text-[11px] text-slate-500">Source
						<select name="source" class="input w-auto !py-1 text-[11px]">
							{#each ['WHATSAPP_GROUP', 'WHATSAPP_DIRECT', 'PHONE', 'MANUAL'] as s (s)}<option value={s}>{sourceLabel(s)}</option>{/each}
						</select>
					</label>
					<button class="btn-primary text-xs">Create orders</button>
				</div>
			</form>
		{/if}
	{/if}

	<!-- The customer list -->
	<div class="card overflow-hidden">
		{#if data.orders.length === 0}
			<p class="p-6 text-center text-sm text-slate-500">No orders yet — add the first customer above.</p>
		{:else}
			<!-- Phones: cards -->
			<ul class="divide-y divide-slate-100 sm:hidden">
				{#each data.orders as o (o.id)}
					<li class="space-y-2 p-3">
						<div class="flex items-center justify-between gap-2">
							<a href="/app/orders/{o.id}" class="min-w-0 truncate text-sm font-semibold text-slate-800">{o.customer_name}</a>
							<span class="shrink-0 text-sm font-bold tabular-nums text-slate-700">{o.quantity}{o.unit ? ` ${o.unit}` : ''} · <Money amount={o.total} currency={o.currency} /></span>
						</div>
						<div class="flex items-center gap-1.5">
							<StatusBadge value={o.status} size="xs" />
							<StatusBadge value={o.payment_status} size="xs" />
							<span class="ml-auto text-[10px] text-slate-400">{o.order_number}</span>
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each NEXT[o.status] ?? [] as nxt (nxt.to)}
								<form method="POST" action="?/status" use:enhance>
									<input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="status" value={nxt.to} />
									<button class="btn-secondary !px-2.5 !py-1.5 text-[11px]">{nxt.label}</button>
								</form>
							{/each}
							{#if o.payment_status !== 'PAID' && o.status !== 'CANCELLED' && o.status !== 'REFUNDED'}
								<form method="POST" action="?/markPaid" use:enhance>
									<input type="hidden" name="orderId" value={o.id} />
									<button class="btn-secondary !px-2.5 !py-1.5 text-[11px] text-success">Mark paid</button>
								</form>
							{/if}
							{#if o.conversation_id}
								<a href="/app/conversations/{o.conversation_id}" class="btn-secondary !px-2.5 !py-1.5 text-[11px]">WhatsApp</a>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			<!-- Wide screens: table -->
			<div class="hidden overflow-x-auto sm:block">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr>
						<th class="table-head">Customer</th><th class="table-head">Qty</th><th class="table-head">Total</th>
						<th class="table-head">Payment</th><th class="table-head">Status</th><th class="table-head">Source</th><th class="table-head text-right">Actions</th>
					</tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.orders as o (o.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell">
									<a href="/app/orders/{o.id}" class="font-medium text-brand-600 hover:underline">{o.customer_name}</a>
									<div class="text-[10px] text-slate-400">{o.order_number}{o.phone ? ` · +${o.phone}` : ''}</div>
								</td>
								<td class="table-cell font-semibold tabular-nums">{o.quantity}{o.unit ? ` ${o.unit}` : ''}</td>
								<td class="table-cell tabular-nums"><Money amount={o.total} currency={o.currency} /></td>
								<td class="table-cell"><StatusBadge value={o.payment_status} size="xs" /></td>
								<td class="table-cell"><StatusBadge value={o.status} size="xs" /></td>
								<td class="table-cell text-[11px] text-slate-500">{sourceLabel(o.source)}</td>
								<td class="table-cell">
									<div class="flex justify-end gap-1.5">
										{#each NEXT[o.status] ?? [] as nxt (nxt.to)}
											<form method="POST" action="?/status" use:enhance>
												<input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="status" value={nxt.to} />
												<button class="btn-secondary !px-2 !py-1 text-[11px]">{nxt.label}</button>
											</form>
										{/each}
										{#if o.payment_status !== 'PAID' && o.status !== 'CANCELLED' && o.status !== 'REFUNDED'}
											<form method="POST" action="?/markPaid" use:enhance>
												<input type="hidden" name="orderId" value={o.id} />
												<button class="btn-secondary !px-2 !py-1 text-[11px] text-success">Mark paid</button>
											</form>
										{/if}
										{#if o.conversation_id}
											<a href="/app/conversations/{o.conversation_id}" class="btn-secondary !px-2 !py-1 text-[11px]" title="Open WhatsApp conversation">Chat</a>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
