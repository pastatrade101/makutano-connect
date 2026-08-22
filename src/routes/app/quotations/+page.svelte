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
	<h1 class="text-base font-semibold text-slate-900">Quotations</h1>
	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} placeholder="Search quotation reference…" />
		{#if data.items.length === 0}
			<EmptyState title="No quotations yet" description="Create a quotation from a booking request, a lead or a WhatsApp conversation." />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Customer</th><th class="table-head">Status</th><th class="table-head">Total</th><th class="table-head">Valid until</th><th class="table-head">Created</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.quotation.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell"><a href="/app/quotations/{row.quotation.id}" class="font-medium text-brand-800 hover:underline">{row.quotation.reference}</a></td>
								<td class="table-cell text-slate-600">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell"><StatusBadge value={row.quotation.status} /></td>
								<td class="table-cell"><Money amount={row.quotation.total} currency={row.quotation.currency} /></td>
								<td class="table-cell text-slate-600">{row.quotation.validUntil ? new Date(row.quotation.validUntil).toLocaleDateString('en-GB') : '—'}</td>
								<td class="table-cell text-slate-500"><TimeAgo value={row.quotation.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
