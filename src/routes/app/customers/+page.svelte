<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Pagination from '$components/Pagination.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Customers · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Customers</h1>
	<div class="card overflow-hidden">
		<FilterBar placeholder="Search name, email or phone…" />
		{#if data.items.length === 0}
			<EmptyState title="No customers yet" description="Customers are created automatically from booking requests and inbound WhatsApp messages." />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Email</th><th class="table-head">WhatsApp</th><th class="table-head">Country</th><th class="table-head">Source</th><th class="table-head">Added</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as c (c.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell font-medium text-slate-800">{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell text-slate-600">{c.email ?? '—'}</td>
								<td class="table-cell text-slate-600">{c.whatsappPhone ? `+${c.whatsappPhone}` : '—'}</td>
								<td class="table-cell text-slate-600">{c.country ?? '—'}</td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{c.source}</td>
								<td class="table-cell text-slate-500"><TimeAgo value={c.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
