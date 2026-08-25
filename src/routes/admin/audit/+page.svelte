<script lang="ts">
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Audit logs · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Audit logs</h1>
	<div class="card overflow-x-auto">
		<table class="min-w-[720px] divide-y divide-slate-100 sm:min-w-full">
			<thead class="bg-slate-50"><tr><th class="table-head">Action</th><th class="table-head">Tenant</th><th class="table-head">Actor</th><th class="table-head">Entity</th><th class="table-head">When</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.rows as row (row.log.id)}
					<tr>
						<td class="table-cell font-mono text-xs">{row.log.action}</td>
						<td class="table-cell">{row.tenant?.name ?? '—'}</td>
						<td class="table-cell text-slate-600">{row.user?.email ?? row.log.actorType}</td>
						<td class="table-cell font-mono text-[12.5px] text-slate-500">{row.log.entityType ?? '—'}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={row.log.createdAt} /></td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-3 py-8 text-center text-xs text-slate-500">No audit entries yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if data.rows.length === data.pagination.limit}
		<a href="?page={data.pagination.page + 1}" class="btn-secondary">Older entries →</a>
	{/if}
</div>
