<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED'].map((v) => ({ value: v, label: v }));
</script>

<svelte:head><title>Quotations · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div><h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Quotations</h1><p class="mt-0.5 text-xs text-slate-400 sm:hidden">Quotes awaiting customer decisions</p></div>
	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} placeholder="Search quotation reference…" />
		{#if data.items.length === 0}
			<EmptyState
					title="No quotations yet"
					description="A quotation starts from an enquiry — open the enquiry you want to price and choose Create quotation. It keeps the customer, dates and party size attached."
					action={{ href: '/app/booking-requests', label: 'Go to enquiries' }}
				/>
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Customer</th><th class="table-head">Status</th><th class="table-head">Total</th><th class="table-head">Valid until</th><th class="table-head">Created</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.quotation.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title"><a href="/app/quotations/{row.quotation.id}" class="font-semibold text-brand-600 hover:underline">{row.quotation.reference}</a><div class="mt-1 sm:hidden"><StatusBadge value={row.quotation.status} /></div></td>
								<td class="table-cell text-slate-600" data-label="Customer">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={row.quotation.status} /></td>
								<td class="table-cell font-semibold" data-label="Total"><Money amount={row.quotation.total} currency={row.quotation.currency} /></td>
								<td class="table-cell text-slate-600" data-label="Valid until">{row.quotation.validUntil ? new Date(row.quotation.validUntil).toLocaleDateString('en-GB') : '—'}</td>
								<td class="table-cell text-slate-500" data-label="Created"><TimeAgo value={row.quotation.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
