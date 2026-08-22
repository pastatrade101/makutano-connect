<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
</script>

<svelte:head><title>Payments · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Payments</h1>
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
									{#if row.booking}<a href="/app/bookings/{row.booking.id}" class="text-brand-800 hover:underline">{row.booking.bookingReference}</a>{:else}—{/if}
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
