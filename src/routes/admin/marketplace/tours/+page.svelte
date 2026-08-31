<script lang="ts">
	// The review desk. One row per listing, every operator in one list — the whole point
	// of the platform queue is that it is not per tenant.
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	// Changing tab starts a new list, so the page number goes with the old one.
	const href = (tab: string) => `/admin/marketplace/tours?tab=${tab}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
</script>

<svelte:head><title>Tour listings · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-base font-semibold text-slate-900">Tour listings</h1>
			<p class="mt-0.5 text-xs text-slate-500">
				What operators have sent to the marketplace. Approving one puts our name on it.
			</p>
		</div>
	</div>

	<nav class="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
		{#each data.tabs as t (t.key)}
			<a
				href={href(t.key)}
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition {data.tab === t.key
					? 'bg-white text-slate-900 shadow-sm'
					: 'text-slate-500 hover:text-slate-700'}"
			>
				{t.label}
				<span class="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">{t.count}</span>
			</a>
		{/each}
	</nav>

	<form method="GET" class="card flex flex-wrap items-end gap-3 p-3">
		<input type="hidden" name="tab" value={data.tab} />
		<div class="min-w-[220px] flex-1">
			<label class="label" for="q">Search</label>
			<input id="q" name="q" value={data.q} placeholder="Listing title or operator" class="input" />
		</div>
		<button class="btn-secondary">Filter</button>
		{#if data.q}
			<a href={`/admin/marketplace/tours?tab=${data.tab}`} class="text-xs text-slate-500 hover:underline">Clear</a>
		{/if}
	</form>

	<div class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="min-w-[760px] divide-y divide-slate-100 sm:min-w-full">
				<thead class="bg-slate-50">
					<tr>
						<th class="table-head">Operator</th>
						<th class="table-head">Listing</th>
						<th class="table-head">Country</th>
						<th class="table-head">Submitted</th>
						<th class="table-head">Status</th>
						<th class="table-head"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.rows as row (row.id)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell font-medium text-slate-700">{row.operator}</td>
							<td class="table-cell">
								<a href="/admin/marketplace/tours/{row.id}" class="font-medium text-brand-600 hover:underline">{row.title}</a>
								{#if row.featured}
									<span class="badge ml-1.5 bg-purple/10 text-purple">Featured</span>
								{/if}
							</td>
							<td class="table-cell text-slate-600">{row.country ?? '—'}</td>
							<td class="table-cell text-slate-500">
								{#if row.submittedAt}<TimeAgo value={row.submittedAt} />{:else}<span class="text-slate-400">—</span>{/if}
							</td>
							<td class="table-cell"><StatusBadge value={row.status} /></td>
							<td class="table-cell text-right">
								<a href="/admin/marketplace/tours/{row.id}" class="text-xs font-medium text-brand-600 hover:underline">Review</a>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6">
								<EmptyState
									title="Nothing in this view"
									description="Listings arrive here when an operator submits one for review. Until then the queue is empty — which is the state it should spend most of its time in."
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if data.total > data.pagination.limit}
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
