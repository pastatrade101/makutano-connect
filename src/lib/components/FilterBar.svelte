<script lang="ts">
	// §22 desktop filter row: Search | Status | Payment | Tour | More Filters.
	// The secondary filters (assignee, source, date range) live in the drawer so the
	// primary row stays one line on a laptop.
	import { page } from '$app/state';

	type Option = { value: string; label: string };
	let {
		statuses = [],
		payments = [],
		sources = [],
		placeholder = 'Search…',
		showTour = false
	}: {
		statuses?: Option[];
		payments?: Option[];
		sources?: Option[];
		placeholder?: string;
		showTour?: boolean;
	} = $props();

	let open = $state(false);
	const params = $derived(page.url.searchParams);
	const activeExtras = $derived(['assignee', 'source', 'from', 'to'].filter((k) => params.get(k)).length);
</script>

<form method="GET" class="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
	<div class="relative min-w-[180px] flex-1">
		<input name="q" value={params.get('q') ?? ''} {placeholder} class="input pl-9" />
		<svg class="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
		</svg>
	</div>

	{#if statuses.length}
		<select name="status" class="input w-auto min-w-[130px]">
			<option value="">All statuses</option>
			{#each statuses as option (option.value)}
				<option value={option.value} selected={params.get('status') === option.value}>{option.label}</option>
			{/each}
		</select>
	{/if}

	{#if payments.length}
		<select name="payment" class="input w-auto min-w-[120px]">
			<option value="">Any payment</option>
			{#each payments as option (option.value)}
				<option value={option.value} selected={params.get('payment') === option.value}>{option.label}</option>
			{/each}
		</select>
	{/if}

	{#if showTour}
		<input name="tour" value={params.get('tour') ?? ''} placeholder="Tour / reference" class="input w-auto min-w-[150px]" />
	{/if}

	<button type="button" class="btn-secondary relative" onclick={() => (open = !open)}>
		More filters
		{#if activeExtras}
			<span class="ml-1 rounded-full bg-brand-500 px-1.5 text-[11.5px] font-semibold text-white">{activeExtras}</span>
		{/if}
	</button>
	<button type="submit" class="btn-primary">Apply</button>

	{#if open}
		<div class="mt-2 grid w-full grid-cols-1 gap-3 rounded-panel border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
			<div>
				<label class="label" for="filter-assignee">Assignee</label>
				<input id="filter-assignee" name="assignee" value={params.get('assignee') ?? ''} placeholder="User id" class="input" />
			</div>
			<div>
				<label class="label" for="filter-source">Source</label>
				<select id="filter-source" name="source" class="input">
					<option value="">Any source</option>
					{#each sources as option (option.value)}
						<option value={option.value} selected={params.get('source') === option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="filter-from">From</label>
				<input id="filter-from" type="date" name="from" value={params.get('from') ?? ''} class="input" />
			</div>
			<div>
				<label class="label" for="filter-to">To</label>
				<input id="filter-to" type="date" name="to" value={params.get('to') ?? ''} class="input" />
			</div>
		</div>
	{/if}
</form>
