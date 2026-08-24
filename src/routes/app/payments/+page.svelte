<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$app/forms';
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
	<h1 class="text-base font-semibold text-slate-900">Payments</h1>

	<!-- §11: verification queue — customers who say they've paid -->
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
							<span class="ml-auto text-[11px] text-slate-400">reported <TimeAgo value={row.request.reportedAt} timezone={data.tenant.timezone} /></span>
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
			<EmptyState title="No payments recorded" description="Record a payment from a booking, or take one through a provider." />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Booking</th><th class="table-head">Method</th><th class="table-head">Status</th><th class="table-head">Amount</th><th class="table-head">When</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.payment.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell font-mono text-xs">{row.payment.reference}</td>
								<td class="table-cell">
									{#if row.booking}<a href="/app/bookings/{row.booking.id}" class="text-brand-600 hover:underline">{row.booking.bookingReference}</a>{:else}—{/if}
								</td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{row.payment.provider}</td>
								<td class="table-cell"><StatusBadge value={row.payment.status} /></td>
								<td class="table-cell"><Money amount={row.payment.amount} currency={row.payment.currency} /></td>
								<td class="table-cell text-slate-500"><TimeAgo value={row.payment.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
