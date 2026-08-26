<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();
	let verifying = $state<string | null>(null);
	let verificationTargetInitialized = $state(false);
	$effect(() => {
		if (!verificationTargetInitialized) {
			verifying = data.verifyId;
			verificationTargetInitialized = true;
		}
	});
	let receivedAmount = $state('');
	const canVerify = $derived(data.permissions?.includes('payments:verify') && data.entitlements?.['payments.enabled'] === true);
	const who = (c: { firstName?: string | null; lastName?: string | null } | null) =>
		[c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Customer';
	const remaining = (request: { amountRequested: string; amountReceived: string }) =>
		Math.max(0, Number(request.amountRequested) - Number(request.amountReceived));
	const STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
</script>

<svelte:head><title>Payments · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Done" />

<div class="space-y-3">
	<div><h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Payments</h1><p class="mt-0.5 text-xs text-slate-400 sm:hidden">Collections and verification</p></div>

	<!-- §11: verification queue — customers who say they've paid -->
	{#if data.verified}
		{@const v = data.verified}
		{@const dest = v.order
			? { href: `/app/orders/${v.order.id}`, label: `Open order ${v.order.orderNumber}` }
			: v.booking
				? { href: `/app/bookings/${v.booking.id}`, label: `Open booking ${v.booking.bookingReference}` }
				: v.quotation
					? { href: `/app/quotations/${v.quotation.id}`, label: `Open quotation ${v.quotation.reference}` }
					: null}
		<section class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-success/25 bg-success/5 px-4 py-3">
			<span class="text-sm font-semibold text-slate-900">
				Payment verified — {v.request.currency}
				{Number(v.request.amountReceived).toLocaleString()} received
			</span>
			<span class="text-[13px] text-slate-600">The customer has been notified.</span>
			<div class="ml-auto flex flex-wrap gap-1.5">
				{#if dest}<a href={dest.href} class="btn-primary !py-1.5 text-xs">{dest.label}</a>{/if}
				{#if v.request.conversationId}
					<a href="/app/conversations/{v.request.conversationId}" class="btn-secondary !py-1.5 text-xs">Open chat</a>
				{/if}
			</div>
		</section>
	{/if}

	{#if data.reported.length}
		<div class="card overflow-hidden border-orange/40">
			<header class="flex items-center gap-2 border-b border-slate-200 bg-orange/5 px-4 py-2.5">
				<h2 class="text-sm font-semibold text-slate-800">Payments reported by customers</h2>
				<span class="badge bg-orange/15 text-orange">{data.reported.length} to verify</span>
			</header>
			<ul class="divide-y divide-slate-100">
				{#each data.reported as row (row.request.id)}
					<li class="space-y-2 px-4 py-3">
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
							<span class="font-semibold text-slate-800">{who(row.customer)}</span>
							<span class="font-mono text-xs text-slate-500">
									{row.booking?.bookingReference ?? row.order?.orderNumber ?? row.quotation?.reference ?? '—'}
								</span>
								<span class="font-semibold tabular-nums text-slate-700">Expected {row.request.currency} {remaining(row.request).toFixed(2)}</span>
								{#if Number(row.request.amountReceived) > 0}<span class="text-xs text-slate-500">already received {row.request.currency} {row.request.amountReceived}</span>{/if}
							{#if row.request.methodLabel}<span class="text-xs text-slate-500">{row.request.methodLabel}</span>{/if}
							<span class="ml-auto text-[12.5px] text-slate-400">reported <TimeAgo value={row.request.reportedAt} timezone={data.tenant.timezone} /></span>
						</div>
							{#if verifying === row.request.id && canVerify}
							<form method="POST" action="?/confirmRequest" use:enhance={() => async ({ update }) => { await update(); verifying = null; }} class="flex flex-wrap items-end gap-2">
								<input type="hidden" name="requestId" value={row.request.id} />
								<div>
									<label class="label" for="amt-{row.request.id}">Amount received ({row.request.currency})</label>
									<input id="amt-{row.request.id}" name="amount" inputmode="decimal" bind:value={receivedAmount} class="input h-10 w-36" />
								</div>
									<input name="paymentReference" placeholder="Payment reference (optional)" class="input h-10 flex-1 min-w-40" />
									<input name="note" placeholder="Internal note (optional)" class="input h-10 flex-1 min-w-40" />
								<button class="btn-primary h-10">Confirm payment</button>
								<button type="button" class="btn-secondary h-10" onclick={() => (verifying = null)}>Back</button>
							</form>
						{:else}
								<div class="flex flex-wrap gap-2">
									{#if canVerify}<button class="btn-primary !py-1.5 text-xs" onclick={() => { verifying = row.request.id; receivedAmount = remaining(row.request).toFixed(2); }}>
										Confirm payment
									</button>{/if}
									{#if canVerify}
									<form method="POST" action="?/requestNotFound" use:enhance>
									<input type="hidden" name="requestId" value={row.request.id} />
										<button class="btn-secondary !py-1.5 text-xs">Payment not found</button>
									</form>
									{/if}
								{#if row.request.conversationId}
									<a href="/app/conversations/{row.request.conversationId}" class="btn-secondary !py-1.5 text-xs">Open chat</a>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Collected" value={data.stats.collected.toFixed(0)} hint={data.tenant.currency} tone="good" />
		<StatTile label="Succeeded" value={data.stats.succeeded} />
		<StatTile label="Pending" value={data.stats.pending} tone="warn" />
		<StatTile label="Failed" value={data.stats.failed} tone={data.stats.failed ? 'bad' : 'default'} />
	</div>

	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} placeholder="Search payment reference…" />
		{#if data.items.length === 0}
			<EmptyState
					title="No payments yet"
					description="Ask for money from the order or booking itself — open it and choose Request payment. The customer gets instructions on WhatsApp, and what they report lands here for you to verify."
					action={{ href: '/app/settings#payments', label: 'Set up how customers pay' }}
				/>
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Booking</th><th class="table-head">Method</th><th class="table-head">Status</th><th class="table-head">Amount</th><th class="table-head">When</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.payment.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title font-mono text-xs">{row.payment.reference}<div class="mt-1 sm:hidden"><StatusBadge value={row.payment.status} /></div></td>
								<td class="table-cell" data-label="Booking">
									{#if row.booking}<a href="/app/bookings/{row.booking.id}" class="text-brand-600 hover:underline">{row.booking.bookingReference}</a>{:else}—{/if}
								</td>
								<td class="table-cell text-[12.5px] uppercase text-slate-500" data-label="Method">{row.payment.provider}</td>
								<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={row.payment.status} /></td>
								<td class="table-cell font-semibold" data-label="Amount"><Money amount={row.payment.amount} currency={row.payment.currency} /></td>
								<td class="table-cell text-slate-500" data-label="When"><TimeAgo value={row.payment.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
