<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'CONVERTED'].map((v) => ({
		value: v,
		label: v.replace(/_/g, ' ')
	}));
	const SOURCES = ['WEBSITE', 'WHATSAPP', 'ADMIN', 'API', 'PHONE', 'EMAIL'].map((v) => ({ value: v, label: v }));
</script>

<svelte:head><title>Booking requests · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Enquiries" />
{:else}
<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Booking requests</h1>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Total" value={data.stats.total} />
		<StatTile label="Pending" value={data.stats.pending} tone="warn" />
		<StatTile label="Quoted" value={data.stats.quoted} />
		<StatTile label="Accepted" value={data.stats.accepted} tone="good" />
		<StatTile label="Converted" value={data.stats.converted} tone="good" />
		<StatTile label="Closed" value={data.stats.closed} />
	</div>

	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} sources={SOURCES} showTour placeholder="Search reference, traveller, email…" />

		{#if data.items.length === 0}
			<EmptyState title="No booking requests match this view" description="Requests arrive from your website form, the API or WhatsApp." />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50">
						<tr>
							<th class="table-head">Reference</th>
							<th class="table-head">Traveller</th>
							<th class="table-head">Trip</th>
							<th class="table-head">Pax</th>
							<th class="table-head">Status</th>
							<th class="table-head">Source</th>
							<th class="table-head">Estimated</th>
							<th class="table-head">Received</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.request.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell">
									<a href="/app/booking-requests/{row.request.id}" class="font-medium text-brand-600 hover:underline">{row.request.reference}</a>
								</td>
								<td class="table-cell">
									<div class="font-medium text-slate-800">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</div>
									<div class="text-[11px] text-slate-500">{row.customer?.email ?? row.customer?.whatsappPhone ?? ''}</div>
								</td>
								<td class="table-cell text-slate-600">
									{#if row.request.startDate}
										{new Date(row.request.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
										{#if row.request.endDate}– {new Date(row.request.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{/if}
									{:else}—{/if}
								</td>
								<td class="table-cell tabular-nums text-slate-600">{row.request.adults}A{row.request.children ? ` · ${row.request.children}C` : ''}</td>
								<td class="table-cell"><StatusBadge value={row.request.status} /></td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{row.request.source}</td>
								<td class="table-cell"><Money amount={row.request.estimatedTotal} currency={row.request.currency} /></td>
								<td class="table-cell text-slate-500"><TimeAgo value={row.request.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
{/if}
