<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	import { nextForBooking } from '$lib/next-action';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const tz = $derived(data.tenant.timezone);
	const canWrite = $derived(data.permissions?.includes('bookings:write'));
	const canPay = $derived(data.permissions?.includes('payments:write') && data.entitlements?.['payments.enabled'] === true);
	/** The booking journey as buttons (§20); destructive moves demoted to quiet links. */
	const FORWARD: Record<string, Array<{ to: string; label: string }>> = {
		DRAFT: [{ to: 'PENDING', label: 'Mark pending' }],
		PENDING: [{ to: 'CONFIRMED', label: 'Confirm booking' }],
		AWAITING_PAYMENT: [{ to: 'CONFIRMED', label: 'Confirm booking' }],
		PARTIALLY_PAID: [{ to: 'CONFIRMED', label: 'Confirm booking' }],
		CONFIRMED: [
			{ to: 'IN_PROGRESS', label: 'Start trip' },
			{ to: 'COMPLETED', label: 'Complete' }
		],
		IN_PROGRESS: [{ to: 'COMPLETED', label: 'Complete' }]
	};
	const DESTRUCTIVE: Record<string, Array<{ to: string; label: string }>> = {
		DRAFT: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		PENDING: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		AWAITING_PAYMENT: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		PARTIALLY_PAID: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		CONFIRMED: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		IN_PROGRESS: [{ to: 'CANCELLED', label: 'Cancel booking' }],
		COMPLETED: [{ to: 'REFUNDED', label: 'Refund' }],
		CANCELLED: [{ to: 'REFUNDED', label: 'Refund' }]
	};
	const forward = $derived(FORWARD[data.booking.status] ?? []);
	const destructive = $derived(DESTRUCTIVE[data.booking.status] ?? []);
	const balance = $derived(Math.max(0, Number(data.booking.balanceDue ?? 0)));
	let confirmDestructive = $state<string | null>(null);
	let showRequestPanel = $state(false);
	let requestAmount = $state('');
	let selectedMethodKey = $state('');
	$effect(() => {
		if (!data.payMethods.some((method) => method.key === selectedMethodKey)) selectedMethodKey = data.payMethods[0]?.key ?? '';
	});
	const customerName = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || 'the customer');
	const activeRequest = $derived(
		data.paymentRequests.find((r) => ['REQUESTED', 'REPORTED', 'PARTIALLY_PAID'].includes(r.status)) ?? null
	);
	// Same precedence as orders, payments and the thread — bookings no longer keep
	// their own opinion about what matters most.
	const reportedRequest = $derived(data.paymentRequests?.find((r) => r.status === 'REPORTED') ?? null);
	const canVerify = $derived(data.permissions?.includes('payments:verify') ?? false);
	const BOOKING_KEY: Record<string, string> = {
		CONFIRMED: 'confirm_booking',
		IN_PROGRESS: 'start_trip',
		COMPLETED: 'complete_booking'
	};
	const next = $derived(
		nextForBooking(
			{
				id: data.booking.id,
				status: data.booking.status,
				outstanding: balance,
				activeRequestStatus: activeRequest?.status ?? null
			},
			{ payments: canPay, verifyPayments: canVerify, bookingsWrite: canWrite }
		)
	);
	const cls = (key: string) => (next?.key === key ? 'btn-primary' : 'btn-secondary');

	const selectedMethod = $derived(data.payMethods.find((method) => method.key === selectedMethodKey) ?? data.payMethods[0] ?? null);
	const requestReady = $derived(
		!!selectedMethod &&
		!!data.customer?.whatsappPhone &&
		data.requestTemplateReady &&
		Number(requestAmount) > 0 &&
		Number(requestAmount) <= balance
	);
</script>

<svelte:head><title>{data.booking.bookingReference} · {data.tenant.name}</title></svelte:head>

	<FormToast {form} successTitle="Booking updated" />
	{#if form?.warning}<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#8a6815]">{form.warning}</p>{/if}

<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/bookings" class="text-xs text-slate-500 hover:underline">← Bookings</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">{data.booking.bookingReference} <StatusBadge value={data.booking.status} /></h1>
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			{#if reportedRequest && canVerify}
				<a href="/app/payments?verify={reportedRequest.id}" class={cls('verify_payment')}>Verify payment</a>
			{/if}
			{#if canPay && balance > 0 && !activeRequest && ['DRAFT', 'PENDING', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'].includes(data.booking.status)}
				<button class={cls('request_payment')} onclick={() => { requestAmount = balance.toFixed(2); showRequestPanel = !showRequestPanel; }}>
					Request payment
				</button>
			{/if}
			{#if canPay && activeRequest && activeRequest.status !== 'REPORTED'}
				<form method="POST" action="?/remindPayment" use:enhance>
					<input type="hidden" name="requestId" value={activeRequest.id} />
					<button class="btn-secondary">Send payment reminder</button>
				</form>
			{/if}
			{#if canWrite}
				{#each forward as move (move.to)}
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="status" value={move.to} />
						<button class={cls(BOOKING_KEY[move.to])}>{move.label}</button>
					</form>
				{/each}
			{/if}
			{#if canPay && balance > 0 && !['CANCELLED', 'REFUNDED', 'COMPLETED'].includes(data.booking.status)}
				<form method="POST" action="?/payment" use:enhance>
					<input type="hidden" name="amount" value={balance.toFixed(2)} />
					<input type="hidden" name="provider" value="MANUAL" />
					<input type="hidden" name="description" value="Marked paid" />
					<button class="btn-secondary text-success">Mark paid</button>
				</form>
			{/if}
		</div>
	</div>

	{#if canWrite && destructive.length}
		<div class="flex justify-end gap-3 text-[12.5px]">
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


	{#if showRequestPanel}
		<!-- §4: compact confirm step BEFORE anything is sent -->
		<form
			method="POST"
			action="?/requestPayment"
				use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') showRequestPanel = false; }}
			class="card space-y-3 p-4"
		>
			<h2 class="card-title">Request payment</h2>
			<dl class="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
				<div class="flex justify-between sm:block"><dt class="text-slate-400">Customer</dt><dd class="font-medium text-slate-700">{customerName}</dd></div>
				<div class="flex justify-between sm:block"><dt class="text-slate-400">Booking</dt><dd class="font-medium text-slate-700">{data.booking.bookingReference}</dd></div>
			</dl>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="label" for="pr-amount">Amount to request ({data.booking.currency})</label>
					<input id="pr-amount" name="amount" inputmode="decimal" bind:value={requestAmount} class="input" />
					<p class="mt-1 text-[12.5px] text-slate-400">Outstanding balance: {data.booking.currency} {balance.toFixed(2)} — lower it for a deposit.</p>
				</div>
				<div>
					<label class="label" for="pr-method">Payment method</label>
					{#if data.payMethods.length}
						<select id="pr-method" name="methodKey" class="input" bind:value={selectedMethodKey}>
							{#each data.payMethods as m (m.key)}
								<option value={m.key}>{m.displayName}{m.number || m.accountNumber ? ` · ${m.accountNumber ?? m.number}` : ''}</option>
							{/each}
						</select>
					{:else}
						<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">
							No usable payment method is configured. Add the details the customer needs before sending.
							<a href="/app/settings" class="font-semibold underline">Add one in Settings</a>
						</p>
					{/if}
				</div>
				</div>
				{#if selectedMethod}
					<dl class="rounded-panel bg-slate-50 p-3 text-xs sm:col-span-2">
						<div class="flex gap-3"><dt class="w-28 shrink-0 text-slate-400">Payment details</dt><dd class="font-medium text-slate-700">{selectedMethod.summary}</dd></div>
						<div class="mt-1 flex gap-3"><dt class="w-28 shrink-0 text-slate-400">Reference</dt><dd class="font-mono font-medium text-slate-700">{data.booking.bookingReference}</dd></div>
					</dl>
				{/if}
				<div class="flex items-center justify-between gap-2">
					<p class="text-[12.5px] text-slate-500">
						{#if !data.customer?.whatsappPhone}Add a WhatsApp number to this customer before sending.
						{:else if !data.requestTemplateReady}The payment request template is not approved and enabled yet.
						{:else if !selectedMethod}Choose a usable payment method.
						{:else if Number(requestAmount) > balance}Amount cannot exceed the outstanding balance.
						{:else if requestReady}WhatsApp: ready to send ✓
						{:else}Enter an amount greater than zero.{/if}
					</p>
				<div class="flex gap-2">
					<button type="button" class="btn-secondary" onclick={() => (showRequestPanel = false)}>Cancel</button>
						<button class="btn-primary" disabled={!requestReady}>Request payment</button>
				</div>
			</div>
		</form>
	{/if}

	{#if data.paymentRequests.length}
		<div class="card divide-y divide-slate-100">
			{#each data.paymentRequests as pr (pr.id)}
				<div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
					<span class="font-medium text-slate-700">{pr.currency} {pr.amountRequested} requested</span>
					<StatusBadge value={pr.status} size="xs" />
					{#if pr.status === 'REPORTED'}
							<a href="/app/payments?verify={pr.id}" class="font-semibold text-brand-600 hover:underline">Verify payment</a>
					{:else if Number(pr.amountReceived) > 0}
						<span class="text-slate-500">received {pr.currency} {pr.amountReceived}</span>
					{/if}
					<span class="ml-auto text-slate-400"><TimeAgo value={pr.createdAt} timezone={tz} /></span>
				</div>
			{/each}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="card px-3 py-2"><div class="text-[12.5px] uppercase text-slate-500">Total</div><div class="text-lg font-semibold"><Money amount={data.booking.total} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[12.5px] uppercase text-slate-500">Paid</div><div class="text-lg font-semibold text-success"><Money amount={data.booking.amountPaid} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[12.5px] uppercase text-slate-500">Balance</div><div class="text-lg font-semibold {Number(data.booking.balanceDue) > 0 ? 'text-danger' : 'text-slate-900'}"><Money amount={data.booking.balanceDue} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[12.5px] uppercase text-slate-500">Travellers</div><div class="text-lg font-semibold tabular-nums">{data.booking.adults + data.booking.children}</div></div>
	</div>

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Items</header>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Qty</th><th class="table-head">Unit</th><th class="table-head">Total</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as item (item.id)}
							<tr>
								<td class="table-cell mobile-record-title font-semibold text-slate-800">{item.title}</td>
								<td class="table-cell text-[12.5px] uppercase text-slate-500" data-label="Type">{item.type}</td>
								<td class="table-cell tabular-nums" data-label="Quantity">{item.quantity}</td>
								<td class="table-cell" data-label="Unit"><Money amount={item.unitPrice} currency={data.booking.currency} /></td>
								<td class="table-cell font-semibold" data-label="Total"><Money amount={item.total} currency={data.booking.currency} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Payments</header>
				{#if canPay}
					<form method="POST" action="?/payment" use:enhance class="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-[8rem_auto_minmax(10rem,1fr)_auto] sm:items-end">
						<div><label class="label" for="amount">Amount</label><input id="amount" name="amount" inputmode="decimal" placeholder="0.00" class="input" /></div>
						<div>
							<label class="label" for="provider">Method</label>
							<select id="provider" name="provider" class="input"><option value="MANUAL">Manual / cash</option><option value="BANK_TRANSFER">Bank transfer</option></select>
						</div>
						<div><label class="label" for="description">Note</label><input id="description" name="description" class="input" /></div>
						<button class="btn-primary w-full">Record payment</button>
					</form>
				{/if}
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Method</th><th class="table-head">Status</th><th class="table-head">Amount</th><th class="table-head">When</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.payments as p (p.id)}
							<tr>
								<td class="table-cell mobile-record-title font-mono text-xs">{p.reference}<div class="mt-1 sm:hidden"><StatusBadge value={p.status} /></div></td>
								<td class="table-cell text-[12.5px] uppercase text-slate-500" data-label="Method">{p.provider}</td>
								<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={p.status} /></td>
								<td class="table-cell font-semibold" data-label="Amount"><Money amount={p.amount} currency={p.currency} /></td>
								<td class="table-cell text-slate-500" data-label="When"><TimeAgo value={p.createdAt} timezone={tz} /></td>
							</tr>
						{:else}
							<tr><td colspan="5" class="px-3 py-6 text-center text-xs text-slate-500">No payments recorded.</td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		</div>

		<div class="space-y-3">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Traveller</header>
				<div class="space-y-1 p-3 text-sm">
					<div class="font-medium">{[data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || '—'}</div>
					{#if data.customer?.email}<div class="text-slate-600">{data.customer.email}</div>{/if}
					{#if data.customer?.whatsappPhone}<div class="text-slate-600">+{data.customer.whatsappPhone}</div>{/if}
					{#if data.booking.bookingRequestId}<a href="/app/booking-requests/{data.booking.bookingRequestId}" class="mt-2 inline-block text-xs text-brand-600 hover:underline">Originating request →</a>{/if}
				</div>
			</section>

			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Status history</header>
				<ul class="divide-y divide-slate-100">
					{#each data.history as h (h.id)}
						<li class="px-3 py-2 text-xs">
							<div class="flex items-center gap-1">
								{#if h.fromStatus}<StatusBadge value={h.fromStatus} size="xs" /><span class="text-slate-400">→</span>{/if}
								<StatusBadge value={h.toStatus} size="xs" />
							</div>
							{#if h.reason}<p class="mt-1 text-slate-600">{h.reason}</p>{/if}
							<p class="mt-0.5 text-slate-400"><TimeAgo value={h.createdAt} timezone={tz} /></p>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>
