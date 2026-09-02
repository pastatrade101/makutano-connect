<script lang="ts">
	// The review desk. One tile per listing, every operator in one list — the whole point
	// of the platform queue is that it is not per tenant.
	import { enhance } from '$app/forms';
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const LABELS: Record<string, string> = {
		start_review: 'Start review',
		approve: 'Approve',
		request_changes: 'Request changes',
		publish: 'Publish',
		unpublish: 'Unpublish'
	};

	let selected = $state<string[]>([]);
	let note = $state('');
	// Selection belongs to the list you were looking at. Changing tab or filter
	// makes a new list, and carrying ticks across it would approve things you can
	// no longer see.
	$effect(() => {
		data.tab;
		data.q;
		data.operator;
		data.waiting;
		selected = [];
	});

	const chosen = $derived(data.rows.filter((r) => selected.includes(r.id)));
	/*
	 * Only the moves legal for EVERY chosen listing.
	 *
	 * A strict intersection, so a reviewer is never offered a button that would
	 * silently skip half their selection. The server recomputes this anyway —
	 * these buttons are a hint, not the rule.
	 */
	const offered = $derived(
		chosen.length
			? Object.keys(LABELS).filter((a) => chosen.every((r) => r.actions.includes(a)))
			: []
	);
	const operatorsChosen = $derived(new Set(chosen.map((r) => r.tenantId)).size);
	const blockedByGaps = $derived(chosen.filter((r) => r.gaps.length));

	const allOnPage = $derived(data.rows.length > 0 && selected.length === data.rows.length);
	function toggleAll() {
		selected = allOnPage ? [] : data.rows.map((r) => r.id);
	}
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}

	const href = (tab: string) => `/admin/marketplace/tours?tab=${tab}`;
	const activeFilters = $derived([data.q && 'search', data.operator && 'operator', data.waiting && 'waiting'].filter(Boolean).length);

	/** Green under a day, amber past one, red past three. */
	function ageTone(at: string | Date | null): string {
		if (!at) return 'text-slate-400';
		const hours = (Date.now() - new Date(at).getTime()) / 3600_000;
		return hours > 72 ? 'text-danger font-medium' : hours > 24 ? 'text-warning' : 'text-slate-500';
	}
</script>

<svelte:head><title>Tour listings · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<div>
		<h1 class="text-base font-semibold text-slate-900">Tour listings</h1>
		<p class="mt-0.5 text-xs text-slate-500">
			What operators have sent to the marketplace. Approving one puts our name on it.
		</p>
	</div>

	{#if form?.message}
		<p class="rounded-panel border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{form.message}</p>
	{:else if form?.bulk}
		<!-- Both halves, always. A reviewer who selected fifteen and moved twelve has
		     to be told which three did not, or the queue has quietly lied to them. -->
		<div class="rounded-panel border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
			<p class="text-slate-700">
				<span class="font-semibold text-success">{form.bulk.moved}</span>
				{form.bulk.moved === 1 ? 'listing' : 'listings'} moved.
			</p>
			{#if form.bulk.failures?.length}
				<p class="mt-1 font-medium text-danger">{form.bulk.failures.length} could not be:</p>
				<ul class="mt-0.5 space-y-0.5 text-slate-600">
					{#each form.bulk.failures as f (f.title)}<li>· {f.title} — {f.reason}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<nav class="flex flex-wrap items-center gap-1 rounded-panel bg-slate-100 p-1">
		{#each data.tabs as t (t.key)}
			<a
				href={href(t.key)}
				class="flex items-center gap-1.5 rounded-panel px-3 py-1.5 text-sm font-medium transition {data.tab === t.key
					? 'bg-white text-slate-900 shadow-panel'
					: 'text-slate-500 hover:text-slate-700'}"
			>
				{t.label}
				<span class="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">{t.count}</span>
			</a>
		{/each}
	</nav>

	<!-- A real filter row. The old one was a single search box behind a button
	     labelled "Filter" that did nothing visible when the box was empty. -->
	<form method="GET" class="card flex flex-wrap items-end gap-2 p-3">
		<input type="hidden" name="tab" value={data.tab} />
		<div class="min-w-[200px] flex-1">
			<label class="label" for="q">Search</label>
			<input id="q" name="q" value={data.q} placeholder="Listing title or operator" class="input" />
		</div>
		{#if data.operators.length > 1}
			<div>
				<label class="label" for="operator">Operator</label>
				<select id="operator" name="operator" class="input min-w-[170px]">
					<option value="">All operators</option>
					{#each data.operators as o (o.id)}
						<option value={o.id} selected={data.operator === o.id}>{o.name}</option>
					{/each}
				</select>
			</div>
		{/if}
		{#if data.tab === 'pending' || data.tab === 'changes'}
			<div>
				<label class="label" for="waiting">Waiting longer than</label>
				<select id="waiting" name="waiting" class="input min-w-[140px]">
					<option value="">Any time</option>
					{#each data.waitingOptions as w (w)}
						<option value={w} selected={data.waiting === w}>{w}</option>
					{/each}
				</select>
			</div>
		{/if}
		<button class="btn-primary">Apply</button>
		{#if activeFilters}
			<a href={href(data.tab)} class="pb-2 text-xs text-slate-500 hover:underline">Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}</a>
		{/if}
	</form>

	{#if selected.length}
		<form
			method="POST"
			action="?/bulk"
			use:enhance={() => async ({ update }) => { await update(); selected = []; note = ''; }}
			class="card sticky top-2 z-10 space-y-2 border-brand-200 p-3"
		>
			{#each selected as id (id)}<input type="hidden" name="ids" value={id} />{/each}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm font-semibold text-slate-800">{selected.length} selected</span>
				{#if operatorsChosen > 1}
					<span class="badge bg-slate-100 text-slate-500">{operatorsChosen} operators</span>
				{/if}
				<span class="flex-1"></span>
				{#each offered as action (action)}
					{@const unsafe = action === 'publish' && blockedByGaps.length > 0}
					<button
						name="action"
						value={action}
						disabled={unsafe || (action === 'request_changes' && (!note.trim() || operatorsChosen > 1))}
						class="{action === 'approve' || action === 'publish' ? 'btn-primary' : 'btn-secondary'} !py-1.5 text-xs disabled:opacity-40"
						title={unsafe ? 'Some of these are missing something a published listing needs' : undefined}
					>
						{LABELS[action]}
					</button>
				{/each}
				<button type="button" class="text-xs text-slate-500 hover:underline" onclick={() => (selected = [])}>Clear</button>
			</div>

			{#if !offered.length}
				<p class="text-xs text-slate-500">
					Nothing can be done to all {selected.length} at once — they are at different points in the
					lifecycle. Narrow the selection.
				</p>
			{/if}

			{#if blockedByGaps.length}
				<p class="text-xs text-warning">
					{blockedByGaps.length} of these cannot be published yet: {blockedByGaps[0].title} needs {blockedByGaps[0].gaps.join(', ')}{blockedByGaps.length > 1 ? ', and others' : ''}.
				</p>
			{/if}

			{#if offered.includes('request_changes')}
				<div>
					<input
						name="note"
						bind:value={note}
						placeholder="What needs to change? The operator sees only this."
						class="input text-xs"
						disabled={operatorsChosen > 1}
					/>
					<p class="mt-1 text-[11.5px] text-slate-400">
						{#if operatorsChosen > 1}
							One note cannot speak to {operatorsChosen} different companies — pick a single operator.
						{:else}
							This note is written to every listing selected.
						{/if}
					</p>
				</div>
			{/if}
		</form>
	{/if}

	<div class="card divide-y divide-slate-100">
		{#if data.rows.length}
			<div class="flex items-center gap-3 bg-slate-50 px-3 py-2">
				<input type="checkbox" checked={allOnPage} onchange={toggleAll} aria-label="Select all on this page" class="size-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
				<span class="text-[11.5px] text-slate-500">
					{selected.length ? `${selected.length} of ${data.rows.length} on this page` : `${data.total} listing${data.total === 1 ? '' : 's'}`}
				</span>
			</div>
		{/if}

		{#each data.rows as row (row.id)}
			<div class="flex gap-3 p-3 transition hover:bg-slate-50">
				<input
					type="checkbox"
					checked={selected.includes(row.id)}
					onchange={() => toggle(row.id)}
					aria-label={row.title}
					class="mt-1 size-4 shrink-0 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
				/>

				<!-- Photography is most of what "is it safe to put our name on this"
				     means, and a table of titles costs a navigation to see any of it.
				     Every pending listing currently HAS a hero and none of them share
				     one, so this is not a completeness check and not duplicate
				     detection — it is the reviewer seeing the picture before deciding. -->
				<a href="/admin/marketplace/tours/{row.id}" class="shrink-0">
					{#if row.heroUrl}
						<img src={row.heroUrl} alt="" class="h-14 w-20 rounded-panel border border-slate-200 object-cover" />
					{:else}
						<span class="flex h-14 w-20 items-center justify-center rounded-panel border border-dashed border-slate-300 text-[10px] text-slate-400">no photo</span>
					{/if}
				</a>

				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<a href="/admin/marketplace/tours/{row.id}" class="truncate text-sm font-medium text-brand-600 hover:underline">{row.title}</a>
						{#if row.featured}<span class="badge bg-purple/10 text-purple">Featured</span>{/if}
						{#if row.accountStatus !== 'ACTIVE' && row.accountStatus !== 'TRIAL'}
							<span class="badge bg-danger/10 text-danger">Account {row.accountStatus.toLowerCase()}</span>
						{/if}
					</div>

					<p class="mt-0.5 truncate text-xs text-slate-500">
						{row.operator}{#if row.destinations.length} · {row.destinations.slice(0, 3).join(', ')}{#if row.destinations.length > 3} +{row.destinations.length - 3}{/if}{/if}
					</p>

					<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
						{#if row.priceFrom}<span class="tabular-nums text-slate-600">{row.currency} {Number(row.priceFrom).toLocaleString()}</span>{/if}
						{#if row.durationDays}<span class="text-slate-400">· {row.durationDays} days</span>{/if}
						{#if row.submittedAt}
							<span class={ageTone(row.submittedAt)}>· waiting <TimeAgo value={row.submittedAt} /></span>
						{/if}
						{#if row.editedSinceSubmitted}<span class="text-slate-400">· edited since</span>{/if}
						{#if row.reviewer}<span class="text-slate-400">· with {row.reviewer}</span>{/if}
					</p>

					{#if row.gaps.length}
						<p class="mt-1 text-[11.5px] text-warning">Missing {row.gaps.join(', ')}</p>
					{/if}
				</div>

				<div class="flex shrink-0 flex-col items-end gap-1.5">
					<StatusBadge value={row.status} />
					<a href="/admin/marketplace/tours/{row.id}" class="text-xs font-medium text-brand-600 hover:underline">Review</a>
				</div>
			</div>
		{:else}
			<EmptyState
				title={activeFilters ? 'Nothing matches those filters' : 'Nothing in this view'}
				description={activeFilters
					? 'Clear the filters to see the rest of this queue.'
					: 'Listings arrive here when an operator submits one for review. Until then the queue is empty — which is the state it should spend most of its time in.'}
			/>
		{/each}

		{#if data.total > data.pagination.limit}
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
