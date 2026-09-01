<script lang="ts">
	import { sourceLabel } from '$lib/labels';
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Pagination from '$components/Pagination.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Travellers · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Travellers</h1>
		<p class="mt-0.5 text-xs text-slate-400 sm:hidden">Everyone who has asked you for a trip</p>
	</div>
	<div class="card overflow-hidden">
		<FilterBar placeholder="Search name, email or phone…" />
		{#if data.items.length === 0}
			<!-- No "add one" call to action: a traveller with no enquiry, quotation
			     or booking behind them is a name in a table, and nobody was typing
			     them in. They arrive with the work. -->
			<EmptyState
				title="No travellers yet"
				description="People appear here the moment they send an enquiry from the marketplace or message you on WhatsApp."
			/>
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Email</th><th class="table-head">WhatsApp</th><th class="table-head">Country</th><th class="table-head">Source</th><th class="table-head">Added</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as c (c.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title font-semibold">
									<a href="/app/customers/{c.id}" class="text-brand-600 hover:underline">{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed customer'}</a>
								</td>
								<td class="table-cell break-all text-slate-600" data-label="Email">{c.email ?? '—'}</td>
								<td class="table-cell text-slate-600" data-label="WhatsApp">{c.whatsappPhone ? `+${c.whatsappPhone}` : '—'}</td>
								<td class="table-cell text-slate-600" data-label="Country">{c.country ?? '—'}</td>
								<td class="table-cell text-[12.5px] text-slate-500" data-label="Source">{sourceLabel(c.source)}</td>
								<td class="table-cell text-slate-500" data-label="Added"><TimeAgo value={c.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
