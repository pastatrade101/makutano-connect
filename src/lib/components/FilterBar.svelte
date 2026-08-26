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
	const activeFilters = $derived(
		['status', 'payment', 'tour', 'assignee', 'source', 'from', 'to'].filter((key) => params.get(key)).length
	);
</script>

<form method="GET" class="border-b border-slate-200 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:px-4">
	<div class="flex gap-2 sm:contents">
		<div class="relative min-w-0 flex-1 sm:min-w-[180px]">
			<input name="q" value={params.get('q') ?? ''} {placeholder} class="input h-11 rounded-xl pl-9 sm:h-auto sm:rounded-panel" />
			<svg class="pointer-events-none absolute top-3.5 left-3 size-4 text-slate-400 sm:top-2.5" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
			</svg>
		</div>
		<button type="button" class="btn-secondary relative shrink-0 rounded-xl sm:hidden" onclick={() => (open = !open)} aria-expanded={open}>
			<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h14M6 10h8M8 15h4" /></svg>
			Filters
			{#if activeFilters}<span class="flex size-4 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-white">{activeFilters}</span>{/if}
		</button>
	</div>

	<div class="{open ? 'mt-3 grid' : 'hidden'} grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 sm:mt-0 sm:contents sm:bg-transparent sm:p-0">
		{#if statuses.length}
			<select name="status" class="input min-w-0 sm:w-auto sm:min-w-[130px]">
				<option value="">All statuses</option>
				{#each statuses as option (option.value)}
					<option value={option.value} selected={params.get('status') === option.value}>{option.label}</option>
				{/each}
			</select>
		{/if}

		{#if payments.length}
			<select name="payment" class="input min-w-0 sm:w-auto sm:min-w-[120px]">
				<option value="">Any payment</option>
				{#each payments as option (option.value)}
					<option value={option.value} selected={params.get('payment') === option.value}>{option.label}</option>
				{/each}
			</select>
		{/if}

		{#if showTour}
			<input name="tour" value={params.get('tour') ?? ''} placeholder="Tour / reference" class="input min-w-0 sm:w-auto sm:min-w-[150px]" />
		{/if}
		<button type="button" class="btn-secondary relative hidden sm:inline-flex" onclick={() => (open = !open)}>
			More filters
			{#if activeExtras}
				<span class="ml-1 rounded-full bg-brand-500 px-1.5 text-[11.5px] font-semibold text-white">{activeExtras}</span>
			{/if}
		</button>
		<button type="submit" class="btn-primary col-span-2 sm:col-auto">Apply</button>
		{#if activeFilters || params.get('q')}
			<a href={page.url.pathname} class="col-span-2 text-center text-xs font-medium text-slate-500 hover:text-slate-700 sm:hidden">Clear filters</a>
		{/if}

		<div class="{open ? 'grid' : 'hidden'} col-span-2 grid-cols-2 gap-2 border-t border-slate-200 pt-3 sm:order-last sm:mt-2 sm:w-full sm:grid-cols-4 sm:gap-3 sm:rounded-panel sm:border sm:bg-slate-50 sm:p-3">
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
	</div>
</form>
