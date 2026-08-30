<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import ReadinessBar from '$components/ReadinessBar.svelte';
	let { data } = $props();

	const TABS = [
		{ key: 'upcoming', label: 'Upcoming' },
		{ key: 'in_progress', label: 'In progress' },
		{ key: 'completed', label: 'Completed' }
	];

	const href = (patch: Record<string, string | null>) => {
		const q = new URLSearchParams({ tab: data.tab, ...(data.mine ? { mine: '1' } : {}) });
		for (const [k, v] of Object.entries(patch)) v === null ? q.delete(k) : q.set(k, v);
		return `/app/trips?${q}`;
	};

	const dates = (from: string | Date | null, to: string | Date | null) => {
		if (!from) return 'No dates yet';
		const f = new Date(from);
		const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
		if (!to) return f.toLocaleDateString('en-GB', opts);
		return `${f.toLocaleDateString('en-GB', { day: 'numeric' })}–${new Date(to).toLocaleDateString('en-GB', opts)}`;
	};
</script>

<svelte:head><title>Trips · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Trips" />
{:else}
<div class="space-y-3">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Trips</h1>
		<p class="mt-0.5 text-xs text-slate-400 sm:hidden">Getting confirmed bookings out of the door</p>
	</div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Preparing" value={data.stats.preparing} tone={data.stats.preparing ? 'warn' : 'default'} />
		<StatTile label="Ready" value={data.stats.ready} tone="good" />
		<StatTile label="In progress" value={data.stats.inProgress} />
		<StatTile label="Completed" value={data.stats.completed} />
	</div>

	<div class="card overflow-hidden">
		<div class="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2">
			{#each TABS as t}
				<a
					href={href({ tab: t.key })}
					class="rounded-lg px-3 py-1.5 text-sm font-medium {data.tab === t.key
						? 'bg-brand-50 text-brand-700'
						: 'text-slate-500 hover:bg-slate-50'}">{t.label}</a>
			{/each}
			<span class="flex-1"></span>
			<a
				href={href({ mine: data.mine ? null : '1' })}
				class="rounded-lg px-3 py-1.5 text-sm font-medium {data.mine
					? 'bg-brand-50 text-brand-700'
					: 'text-slate-500 hover:bg-slate-50'}">Mine</a>
		</div>

		{#if data.rows.length === 0}
			<EmptyState
				title={data.mine ? 'Nothing assigned to you' : 'No trips in this view'}
				description="A trip appears when somebody hands a confirmed booking over to operations. Open a confirmed booking and use “Hand over to operations” — the traveller, dates and what they bought all come across."
				action={{ href: '/app/bookings?status=CONFIRMED', label: 'Confirmed bookings' }}
			/>
		{:else}
			<table class="mobile-record-table min-w-full divide-y divide-slate-100">
				<thead class="bg-slate-50">
					<tr>
						<th class="table-head">Trip</th>
						<th class="table-head">Dates</th>
						<th class="table-head">Guests</th>
						<th class="table-head">Status</th>
						<th class="table-head">Ready</th>
						<th class="table-head">Still missing</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.rows as row (row.trip.id)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell mobile-record-title">
								<a href="/app/trips/{row.trip.id}" class="font-semibold text-brand-600 hover:underline">{row.trip.title}</a>
								<div class="text-xs text-slate-400">{row.trip.tripReference}</div>
								<div class="mt-1 sm:hidden"><StatusBadge value={row.trip.status} /></div>
							</td>
							<td class="table-cell" data-label="Dates">{dates(row.trip.startDate, row.trip.endDate)}</td>
							<td class="table-cell" data-label="Guests">{row.trip.adults + row.trip.children}</td>
							<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={row.trip.status} /></td>
							<td class="table-cell" data-label="Ready">
								{#if row.readiness}<ReadinessBar readiness={row.readiness} />{:else}—{/if}
							</td>
							<td class="table-cell text-slate-500" data-label="Still missing">
								{#if row.readiness}
									{@const blocking = row.readiness.missing.filter((c) => c.critical)}
									{#if blocking.length}
										<span class="font-medium text-danger">{blocking.map((c) => c.label).join(', ')}</span>
									{:else if row.readiness.missing.length}
										{row.readiness.missing.map((c) => c.label).join(', ')}
									{:else}
										<span class="text-success">Nothing</span>
									{/if}
								{:else}—{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
{/if}
