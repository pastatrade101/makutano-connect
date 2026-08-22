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
	<h1 class="text-base font-semibold text-slate-900">Leads</h1>
	<div class="card overflow-hidden">
		<FilterBar statuses={STAGES} placeholder="Search leads…" />
		{#if data.items.length === 0}
			<EmptyState title="No leads yet" description="A lead is opened automatically alongside each booking request." />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Lead</th><th class="table-head">Customer</th><th class="table-head">Stage</th><th class="table-head">Value</th><th class="table-head">Source</th><th class="table-head">Created</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.lead.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell font-medium text-slate-800">{row.lead.title ?? '—'}</td>
								<td class="table-cell text-slate-600">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell"><StatusBadge value={row.lead.stage} /></td>
								<td class="table-cell"><Money amount={row.lead.value} currency={row.lead.currency ?? data.tenant.currency} /></td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{row.lead.source}</td>
								<td class="table-cell text-slate-500"><TimeAgo value={row.lead.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
