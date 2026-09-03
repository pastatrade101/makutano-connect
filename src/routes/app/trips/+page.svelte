<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import TripCard from '$components/TripCard.svelte';
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

	const count = $derived(data.groups.reduce((n, g) => n + g.rows.length, 0));
</script>

<svelte:head><title>Trips · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Trips" />
{:else}
<div class="space-y-4">
	<!-- One honest line instead of a row of zeroes. What an operations person needs
	     on arrival is not five counters, it is whether anything is going wrong. -->
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-lg">Trips</h1>
			<p class="mt-0.5 text-sm text-slate-500">
				{#if data.blocked}
					<span class="font-semibold text-danger">{data.blocked} cannot leave yet</span>
					{#if data.leavingSoon}<span class="text-slate-400"> · {data.leavingSoon} departing within a week</span>{/if}
				{:else if data.leavingSoon}
					{data.leavingSoon} departing within a week — all on track
				{:else if count}
					Everything on track
				{:else}
					Getting confirmed bookings out of the door
				{/if}
			</p>
		</div>

		<nav class="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
			{#each TABS as t}
				<a
					href={href({ tab: t.key })}
					class="rounded-lg px-3 py-1.5 text-sm font-medium transition {data.tab === t.key
						? 'bg-white text-slate-900 shadow-sm'
						: 'text-slate-500 hover:text-slate-700'}">{t.label}</a>
			{/each}
			<span class="mx-1 h-5 w-px bg-slate-300"></span>
			<a
				href={href({ mine: data.mine ? null : '1' })}
				class="rounded-lg px-3 py-1.5 text-sm font-medium transition {data.mine
					? 'bg-white text-brand-700 shadow-sm'
					: 'text-slate-500 hover:text-slate-700'}">Mine</a>
		</nav>
	</header>

	{#if count === 0}
		<div class="card">
			<EmptyState
				title={data.mine ? 'Nothing assigned to you' : 'No trips in this view'}
				description="A trip appears when somebody hands a confirmed booking over to operations. Open a confirmed booking and use “Hand over to operations” — the traveller, the dates and what they bought all come across."
				action={{ href: '/app/bookings?status=CONFIRMED', label: 'Confirmed bookings' }}
			/>
		</div>
	{:else}
		{#each data.groups as group (group.key)}
			<section class="space-y-2">
				<h2 class="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
					{group.label}
					<span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500">
						{group.rows.length}
					</span>
				</h2>
				<!-- Two abreast on a wide screen. Not three: a trip card carries a
				     title, a reference, dates, guests and a blocker line, and at three
				     columns every one of those wraps. -->
				<div class="grid gap-2 xl:grid-cols-2">
					{#each group.rows as row (row.trip.id)}
						<TripCard {row} timezone={data.tenant.timezone} />
					{/each}
				</div>
			</section>
		{/each}
		<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
	{/if}
</div>
{/if}
