<script lang="ts">
	import { sourceLabel } from '$lib/labels';
	import { enhance } from '$lib/forms';
	import { nextForOrder } from '$lib/next-action';
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
	let showActions = $state(false);
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
	// One screen, one dominant action. The precedence lives in $lib/next-action so the
	// thread, the payments queue and this page never disagree about what comes next.
	const reportedRequest = $derived(data.paymentRequests.find((r) => r.status === 'REPORTED') ?? null);
	const canVerify = $derived(data.permissions?.includes('payments:verify') ?? false);
	const STATUS_KEY: Record<string, string> = {
		CONFIRMED: 'confirm_order',
		READY: 'mark_ready',
		DISPATCHED: 'dispatch_order',
		DELIVERED: 'mark_delivered'
	};
	const next = $derived(
		nextForOrder(
			{
				id: data.order.id,
				status: data.order.status,
				outstanding,
				activeRequestStatus: activeRequest?.status ?? null
			},
			{ orders: canWrite, payments: canPay, verifyPayments: canVerify }
		)
	);
	const cls = (key: string) => (next?.key === key ? 'btn-primary' : 'btn-secondary');

	const paymentOpen = $derived(
		canPay && outstanding > 0 && !['CANCELLED', 'REFUNDED'].includes(data.order.status)
	);
	const hasOrderActions = $derived(
		(canWrite && (forward.length > 0 || destructive.length > 0)) ||
		paymentOpen ||
		(canPay && !!activeRequest && activeRequest.status !== 'REPORTED')
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

<div class="space-y-3 sm:space-y-4">
	<header class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<a href="/app/orders" class="mb-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
				<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12.5 4.5-5 5 5 5" /></svg>
				All orders
			</a>
			<h1 class="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-lg">{data.order.orderNumber}</h1>
			<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
				<StatusBadge value={data.order.status} />
				<StatusBadge value={data.order.paymentStatus} size="xs" />
				<span class="text-[12px] text-slate-400">{sourceLabel(data.order.source)}</span>
			</div>
		</div>

		<!-- Desktop keeps the full toolbar; mobile promotes one next step. -->
		<div class="hidden flex-wrap items-center justify-end gap-1.5 md:flex">
			{#if reportedRequest && canVerify}
				<a href="/app/payments?verify={reportedRequest.id}" class={cls('verify_payment')}>Verify payment</a>
			{/if}
			{#if canPay && outstanding > 0 && !activeRequest && !['CANCELLED', 'REFUNDED'].includes(data.order.status)}
				<button class={cls('request_payment')} onclick={() => { requestAmount = outstanding.toFixed(2); showRequestPanel = !showRequestPanel; }}>Request payment</button>
			{/if}
			{#if canPay && activeRequest && activeRequest.status !== 'REPORTED'}
				<form method="POST" action="?/remindPayment" use:enhance>
					<input type="hidden" name="requestId" value={activeRequest.id} />
					<button class="btn-secondary">Send reminder</button>
				</form>
			{/if}
			{#if canWrite}
				{#each forward as move (move.to)}
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="status" value={move.to} />
						<button class={cls(STATUS_KEY[move.to])}>{move.label}</button>
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
	</header>

	{#if form?.warning}<p class="rounded-xl bg-warning/10 px-3 py-2.5 text-xs text-[#8a6815]">{form.warning}</p>{/if}

	<!-- Phone action bar: one confident next step plus a complete secondary sheet. -->
	{#if hasOrderActions}
		<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:hidden">
			{#if next?.key === 'verify_payment' && reportedRequest}
				<a href="/app/payments?verify={reportedRequest.id}" class="btn-primary w-full">Verify payment</a>
			{:else if next?.key === 'request_payment'}
				<button class="btn-primary w-full" onclick={() => { requestAmount = outstanding.toFixed(2); showRequestPanel = true; }}>Request payment</button>
			{:else if next && forward.find((m) => STATUS_KEY[m.to] === next.key)}
				{@const move = forward.find((m) => STATUS_KEY[m.to] === next.key)!}
				<form method="POST" action="?/status" use:enhance>
					<input type="hidden" name="status" value={move.to} />
					<button class="btn-primary w-full">{move.label}</button>
				</form>
			{:else if canPay && activeRequest && activeRequest.status !== 'REPORTED'}
				<form method="POST" action="?/remindPayment" use:enhance>
					<input type="hidden" name="requestId" value={activeRequest.id} />
					<button class="btn-primary w-full">Send reminder</button>
				</form>
			{:else if paymentOpen}
				<form method="POST" action="?/payment" use:enhance>
					<input type="hidden" name="amount" value={outstanding.toFixed(2)} />
					<input type="hidden" name="provider" value="MANUAL" />
					<input type="hidden" name="description" value="Marked paid" />
					<button class="btn-primary w-full">Mark paid</button>
				</form>
			{:else}
				<div></div>
			{/if}
			<button class="btn-secondary !px-3" onclick={() => (showActions = true)} aria-label="More order actions">
				<svg class="size-5" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg>
			</button>
		</div>
	{/if}

	{#if showActions}
		<div class="fixed inset-0 z-50 flex items-end bg-slate-900/40 md:hidden">
			<button class="absolute inset-0" onclick={() => (showActions = false)} aria-label="Close actions" tabindex="-1"></button>
			<section class="mobile-sheet relative z-10 w-full rounded-t-3xl bg-white p-4 shadow-xl">
				<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200"></div>
				<div class="mb-3 flex items-center justify-between">
					<div><h2 class="font-semibold text-slate-800">Order actions</h2><p class="text-xs text-slate-400">{data.order.orderNumber}</p></div>
					<button class="rounded-full bg-slate-50 p-2 text-slate-500" onclick={() => (showActions = false)} aria-label="Close"><svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
				</div>
				<div class="grid gap-2">
					{#if canPay && outstanding > 0 && !activeRequest && !['CANCELLED', 'REFUNDED'].includes(data.order.status)}
						<button class="btn-secondary w-full justify-between" onclick={() => { requestAmount = outstanding.toFixed(2); showActions = false; showRequestPanel = true; }}><span>Request payment</span><span class="text-xs text-slate-400">{data.order.currency} {outstanding.toFixed(2)}</span></button>
					{/if}
					{#if canPay && activeRequest && activeRequest.status !== 'REPORTED'}
						<form method="POST" action="?/remindPayment" use:enhance>
							<input type="hidden" name="requestId" value={activeRequest.id} />
							<button class="btn-secondary w-full justify-start">Send payment reminder</button>
						</form>
					{/if}
					{#if canWrite}
						{#each forward as move (move.to)}
							<form method="POST" action="?/status" use:enhance>
								<input type="hidden" name="status" value={move.to} />
								<button class="btn-secondary w-full justify-start">{move.label}</button>
							</form>
						{/each}
					{/if}
					{#if canPay && outstanding > 0 && !['CANCELLED', 'REFUNDED'].includes(data.order.status)}
						<form method="POST" action="?/payment" use:enhance>
							<input type="hidden" name="amount" value={outstanding.toFixed(2)} />
							<input type="hidden" name="provider" value="MANUAL" />
							<input type="hidden" name="description" value="Marked paid" />
							<button class="btn-secondary w-full justify-start text-success">Mark fully paid</button>
						</form>
					{/if}
					{#if canWrite && destructive.length}
						<div class="mt-1 border-t border-slate-100 pt-2">
							{#each destructive as move (move.to)}
								{#if confirmDestructive === move.to}
									<form method="POST" action="?/status" use:enhance={() => async ({ update }) => { await update(); confirmDestructive = null; showActions = false; }} class="space-y-2 rounded-xl bg-danger/5 p-3">
										<input type="hidden" name="status" value={move.to} />
										<label class="label" for="mobile-reason">Reason for {move.label.toLowerCase()} <span class="font-normal text-slate-400">(optional)</span></label>
										<input id="mobile-reason" name="reason" placeholder="Add a note for your team" class="input" />
										<div class="grid grid-cols-2 gap-2"><button type="button" class="btn-secondary" onclick={() => (confirmDestructive = null)}>Keep order</button><button class="btn-danger">{move.label}</button></div>
									</form>
								{:else}
									<button class="btn-secondary w-full justify-start text-danger" onclick={() => (confirmDestructive = move.to)}>{move.label}</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			</section>
		</div>
	{/if}

		{#if showRequestPanel}
			<div class="fixed inset-0 z-40 flex items-end bg-slate-900/40 md:static md:block md:bg-transparent">
				<button class="absolute inset-0 md:hidden" onclick={() => (showRequestPanel = false)} aria-label="Close payment request" tabindex="-1"></button>
				<form
					method="POST"
					action="?/requestPayment"
					use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') showRequestPanel = false; }}
					class="mobile-sheet card relative z-10 w-full space-y-3 rounded-t-3xl p-4 md:rounded-panel"
				>
					<div class="mx-auto h-1 w-10 rounded-full bg-slate-200 md:hidden"></div>
					<div class="flex items-start justify-between gap-3">
						<div><h2 class="font-semibold text-slate-800">Request payment</h2><p class="text-xs text-slate-400">Send payment details to {customerName} on WhatsApp.</p></div>
						<button type="button" class="rounded-full bg-slate-50 p-2 text-slate-500" onclick={() => (showRequestPanel = false)} aria-label="Close"><svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="label" for="pr-amount">Amount ({data.order.currency})</label>
							<input id="pr-amount" name="amount" inputmode="decimal" bind:value={requestAmount} class="input" />
							<p class="mt-1 text-[12px] text-slate-400">Outstanding: {data.order.currency} {outstanding.toFixed(2)}</p>
						</div>
						<div>
							<label class="label" for="pr-method">Payment method</label>
							{#if data.payMethods.length}
								<select id="pr-method" name="methodKey" class="input" bind:value={selectedMethodKey}>
									{#each data.payMethods as method (method.key)}<option value={method.key}>{method.displayName}</option>{/each}
								</select>
							{:else}
								<p class="rounded-xl bg-warning/10 px-3 py-2 text-xs text-[#b58514]">Add a usable method in <a href="/app/settings" class="font-semibold underline">Settings</a>.</p>
							{/if}
						</div>
						{#if selectedMethod}
							<dl class="rounded-xl bg-slate-50 p-3 text-xs sm:col-span-2">
								<div class="flex gap-3"><dt class="w-24 shrink-0 text-slate-400">Pay to</dt><dd class="font-medium text-slate-700">{selectedMethod.summary}</dd></div>
								<div class="mt-1.5 flex gap-3"><dt class="w-24 shrink-0 text-slate-400">Reference</dt><dd class="font-mono font-medium text-slate-700">{data.order.orderNumber}</dd></div>
							</dl>
						{/if}
					</div>
					<p class="text-[12px] {requestReady ? 'text-success' : 'text-slate-500'}">
						{#if !data.customer?.whatsappPhone}Add the customer's WhatsApp number before sending.
						{:else if !data.requestTemplateReady}The payment request template is not approved and enabled yet.
						{:else if requestReady}Ready to send on WhatsApp ✓
						{:else}Enter a valid amount and payment method.{/if}
					</p>
					<div class="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><button type="button" class="btn-secondary" onclick={() => (showRequestPanel = false)}>Cancel</button><button class="btn-primary" disabled={!requestReady}>Send request</button></div>
				</form>
			</div>
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
		<div class="hidden justify-end gap-3 text-[12.5px] md:flex">
			{#each destructive as move (move.to)}
				{#if confirmDestructive === move.to}
					<form method="POST" action="?/status" use:enhance={() => async ({ update }) => { await update(); confirmDestructive = null; }} class="flex items-center gap-2">
						<input type="hidden" name="status" value={move.to} />
						<input name="reason" placeholder="Reason (optional)" class="input !py-1 w-40 text-[12.5px]" />
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

	<section class="card grid grid-cols-2 overflow-hidden sm:grid-cols-4">
		<div class="border-r border-b border-slate-100 p-3 sm:border-b-0"><div class="text-[10.5px] font-bold tracking-wide text-slate-400 uppercase">Total</div><div class="mt-1 text-lg font-bold text-slate-800"><Money amount={data.order.total} currency={data.order.currency} /></div></div>
		<div class="border-b border-slate-100 p-3 sm:border-r sm:border-b-0"><div class="text-[10.5px] font-bold tracking-wide text-slate-400 uppercase">Paid</div><div class="mt-1 text-lg font-bold text-success"><Money amount={data.order.amountPaid} currency={data.order.currency} /></div>{#if outstanding > 0}<div class="text-[11.5px] text-danger">{data.order.currency} {outstanding.toFixed(2)} due</div>{/if}</div>
		<div class="border-r border-slate-100 p-3"><div class="text-[10.5px] font-bold tracking-wide text-slate-400 uppercase">Delivery</div><div class="mt-1 text-sm font-semibold text-slate-700">{data.order.deliveryMethod ?? '—'}{#if data.order.deliveryDate} · {new Date(data.order.deliveryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{/if}</div><div class="truncate text-[11.5px] text-slate-400">{data.order.deliveryLocation ?? ''}</div></div>
		<div class="p-3"><div class="text-[10.5px] font-bold tracking-wide text-slate-400 uppercase">Source</div><div class="mt-1 text-sm font-semibold text-slate-700">{sourceLabel(data.order.source)}</div>{#if data.batch}<a href="/app/orders/batches/{data.batch.id}" class="block truncate text-[11.5px] text-brand-600 hover:underline">{data.batch.name}</a>{:else if data.order.paymentMethod}<div class="truncate text-[11.5px] text-slate-400">{data.order.paymentMethod}</div>{/if}</div>
	</section>

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="card-header"><h2 class="card-title">Items</h2></header>
				<ul class="divide-y divide-slate-100 md:hidden">
					{#each data.items as item (item.id)}
						<li class="p-3">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0"><p class="font-medium text-slate-800">{item.title}</p>{#if item.variant}<p class="text-xs text-slate-400">{item.variant}</p>{/if}</div>
								<p class="shrink-0 font-semibold text-slate-800"><Money amount={item.total} currency={data.order.currency} /></p>
							</div>
							<div class="mt-2 flex items-center justify-between text-xs text-slate-500"><span>{item.quantity}{item.unit ? ` ${item.unit}` : ''} × <Money amount={item.unitPrice} currency={data.order.currency} /></span>{#if item.sku || item.externalReference}<span class="font-mono text-slate-400">{item.sku ?? item.externalReference}</span>{/if}</div>
						</li>
					{/each}
				</ul>
				<table class="hidden min-w-full divide-y divide-slate-100 md:table">
					<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Variant</th><th class="table-head">Qty</th><th class="table-head">Unit</th><th class="table-head">Total</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as item (item.id)}
							<tr>
								<td class="table-cell">
									<div class="font-medium text-slate-700">{item.title}</div>
									{#if item.sku || item.externalReference}<div class="font-mono text-[12.5px] text-slate-400">{item.sku ?? item.externalReference}</div>{/if}
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
				<div class="space-y-1 border-t border-slate-100 bg-slate-50 px-3 py-2.5 text-sm md:hidden">
					<div class="flex justify-between text-slate-500"><span>Subtotal</span><Money amount={data.order.subtotal} currency={data.order.currency} /></div>
					{#if Number(data.order.discount) > 0}<div class="flex justify-between text-success"><span>Discount</span><span>−<Money amount={data.order.discount} currency={data.order.currency} /></span></div>{/if}
					{#if Number(data.order.deliveryFee) > 0}<div class="flex justify-between text-slate-500"><span>Delivery</span><Money amount={data.order.deliveryFee} currency={data.order.currency} /></div>{/if}
					<div class="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-800"><span>Total</span><Money amount={data.order.total} currency={data.order.currency} /></div>
				</div>
			</section>

			<section class="card">
				<header class="card-header"><h2 class="card-title">Payments</h2></header>
				{#if canPay}
					<form method="POST" action="?/payment" use:enhance class="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-[8rem_auto_minmax(10rem,1fr)_auto] sm:items-end">
						<div><label class="label" for="amount">Amount</label><input id="amount" name="amount" inputmode="decimal" placeholder="0.00" class="input" /></div>
						<div><label class="label" for="provider">Method</label><select id="provider" name="provider" class="input"><option value="MANUAL">Cash / mobile money</option><option value="BANK_TRANSFER">Bank transfer</option></select></div>
						<div><label class="label" for="description">Reference / note</label><input id="description" name="description" placeholder="M-Pesa TX123… (optional)" class="input" /></div>
						<button class="btn-primary w-full">Record payment</button>
					</form>
				{/if}
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<tbody class="divide-y divide-slate-100">
						{#each data.payments as p (p.id)}
							<tr>
								<td class="table-cell mobile-record-title font-mono text-xs">{p.reference}</td>
								<td class="table-cell text-[12.5px] uppercase text-slate-400" data-label="Method">{p.provider}</td>
								<td class="table-cell" data-label="Status"><StatusBadge value={p.status} size="xs" /></td>
								<td class="table-cell" data-label="Amount"><Money amount={p.amount} currency={p.currency} /></td>
								<td class="table-cell text-slate-500" data-label="Recorded"><TimeAgo value={p.createdAt} timezone={tz} /></td>
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
					{#if data.customer?.whatsappPhone}<a href="https://wa.me/{data.customer.whatsappPhone}" target="_blank" rel="noopener" class="block text-brand-600 hover:underline">+{data.customer.whatsappPhone}</a>{/if}
					{#if data.customer?.email}<a href="mailto:{data.customer.email}" class="block break-all text-slate-500 hover:underline">{data.customer.email}</a>{/if}
					{#if data.conversation}
						<a href="/app/conversations/{data.conversation.id}" class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
							<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h14v9H7l-4 3V4Z" /></svg>
							Open WhatsApp conversation →
						</a>
					{/if}
				</div>
			</section>

			{#if data.order.notes}
				<details class="card group">
					<summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3"><span class="card-title">Notes</span><svg class="size-4 text-slate-400 transition group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 7.5 5 5 5-5" /></svg></summary>
					<p class="whitespace-pre-wrap border-t border-slate-100 p-3 text-sm text-slate-600">{data.order.notes}</p>
				</details>
			{/if}

			<details class="card group">
				<summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3"><span class="card-title">Status history <span class="ml-1 font-normal text-slate-400">({data.history.length})</span></span><svg class="size-4 text-slate-400 transition group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 7.5 5 5 5-5" /></svg></summary>
				<ul class="divide-y divide-slate-100 border-t border-slate-100">
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
			</details>
		</div>
	</div>
</div>
