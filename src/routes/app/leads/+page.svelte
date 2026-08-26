<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'].map((v) => ({ value: v, label: v }));
</script>

<svelte:head><title>Leads · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div><h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Leads</h1><p class="mt-0.5 text-xs text-slate-400 sm:hidden">Sales opportunities at a glance</p></div>
	<div class="card overflow-hidden">
		<FilterBar statuses={STAGES} placeholder="Search leads…" />
		{#if data.items.length === 0}
			<EmptyState title="No leads yet" description="A lead is opened automatically alongside each booking request." />
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Lead</th><th class="table-head">Customer</th><th class="table-head">Stage</th><th class="table-head">Value</th><th class="table-head">Source</th><th class="table-head">Created</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.lead.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title font-semibold text-slate-800">{row.lead.title ?? '—'}<div class="mt-1 sm:hidden"><StatusBadge value={row.lead.stage} /></div></td>
								<td class="table-cell text-slate-600" data-label="Customer">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell mobile-hide" data-label="Stage"><StatusBadge value={row.lead.stage} /></td>
								<td class="table-cell font-semibold" data-label="Value"><Money amount={row.lead.value} currency={row.lead.currency ?? data.tenant.currency} /></td>
								<td class="table-cell text-[12.5px] uppercase text-slate-500" data-label="Source">{row.lead.source}</td>
								<td class="table-cell text-slate-500" data-label="Created"><TimeAgo value={row.lead.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
