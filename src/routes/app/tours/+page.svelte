<script lang="ts">
	// The listing shelf. Photography and the fields an operator scans most often are
	// arranged into cards so a growing catalogue remains recognisable at a glance.
	import { page } from '$app/state';
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import { statusLabel } from '$lib/labels';
	let { data, form } = $props();

	/**
	 * Status colour for the marketplace lifecycle.
	 *
	 * Not StatusBadge: its vocabulary is the sales pipeline, and every listing state
	 * would fall through to the same grey — which is the one thing this page must not
	 * do. The WORDS still come from statusLabel, so there is one vocabulary.
	 */
	const TONES: Record<string, string> = {
		DRAFT: 'bg-slate-100 text-slate-500',
		SUBMITTED: 'bg-warning/10 text-warning',
		IN_REVIEW: 'bg-info/10 text-info',
		CHANGES_REQUESTED: 'bg-danger/10 text-danger',
		APPROVED: 'bg-purple/10 text-purple',
		PUBLISHED: 'bg-success/10 text-success',
		UNPUBLISHED: 'bg-orange/10 text-orange',
		ARCHIVED: 'bg-slate-100 text-slate-400'
	};
	const PRICE_TYPE: Record<string, string> = {
		PER_PERSON: 'per person',
		PER_GROUP: 'per group',
		FROM: 'starting price'
	};

	let showNew = $state(false);
	let titleInput = $state<HTMLInputElement | null>(null);

	/**
	 * Open the create form and put the cursor in it.
	 *
	 * The form is rendered at the top of the page while the button that opens it,
	 * in the empty state, is at the bottom of the table. Clicking it appeared to do
	 * nothing at all — the thing it opened was off-screen. Focusing the field
	 * scrolls it into view and leaves the operator able to just start typing.
	 */
	function openNew() {
		showNew = true;
		// After the form exists, not before.
		queueMicrotask(() => titleInput?.focus());
	}

	/** Filter links keep whatever search is already running. */
	function urlFor(status: string): string {
		const url = new URL(page.url);
		if (status) url.searchParams.set('status', status);
		else url.searchParams.delete('status');
		url.searchParams.delete('page');
		return url.pathname + url.search;
	}

	const search = $derived(page.url.searchParams.get('q') ?? '');
	const fmt = (v: string | Date | null) =>
		v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
</script>

<svelte:head><title>Tours · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Listing created" />

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Tours</h1>
			<p class="text-xs text-slate-400">
				Your listings on the marketplace. You write them; the Makutano team reviews and publishes them.
			</p>
		</div>
		{#if data.canWrite}
			<button class="btn-primary" onclick={() => (showNew ? (showNew = false) : openNew())}>New listing</button>
		{/if}
	</div>

	{#if showNew && data.canWrite}
		<form method="POST" action="?/create" use:enhance class="card flex flex-wrap items-end gap-2 p-3">
			<label class="block min-w-0 flex-1">
				<span class="label">What is this tour called?</span>
				<input
					bind:this={titleInput}
					name="title"
					placeholder="6-Day Northern Circuit Safari"
					class="input w-full"
				/>
			</label>
			<button class="btn-primary">Create draft</button>
			<button type="button" class="btn-secondary" onclick={() => (showNew = false)}>Cancel</button>
			<p class="w-full text-xs text-slate-400">
				A working title is enough to start — everything else is filled in on the next screen.
			</p>
		</form>
	{/if}

	<div class="card space-y-3 p-3">
		<!-- One row that scrolls sideways on a phone rather than three rows of wrapped
		     chips, and each carries its count: "how much of my work is sitting with the
		     marketplace team" is answered before anything is clicked. -->
		<div class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
			<a
				href={urlFor('')}
				class="badge shrink-0 gap-1.5 {data.status === ''
					? 'bg-brand-500 text-white'
					: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
			>
				All <span class="tabular-nums opacity-60">{data.counts[''] ?? 0}</span>
			</a>
			{#each data.filters as status (status)}
				<a
					href={urlFor(status)}
					class="badge shrink-0 gap-1.5 whitespace-nowrap {data.status === status
						? 'bg-brand-500 text-white'
						: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
				>
					{statusLabel(status)} <span class="tabular-nums opacity-60">{data.counts[status] ?? 0}</span>
				</a>
			{/each}
		</div>
		<!-- GET, not an action: a search belongs in the URL so it survives a reload and
		     can be shared with whoever is being asked about the listing. -->
		<form method="GET" class="flex flex-wrap items-end gap-2">
			{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
			<label class="block min-w-0 flex-1">
				<span class="sr-only">Search listings</span>
				<input name="q" value={search} placeholder="Search by title" class="input w-full" />
			</label>
			<button class="btn-secondary">Search</button>
			{#if search}<a href={urlFor(data.status)} class="btn-secondary">Clear</a>{/if}
		</form>
	</div>

	{#if data.items.length}
		<section aria-label="Tour listings" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each data.items as tour (tour.id)}
				<article class="card group flex min-w-0 flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
					<a href="/app/tours/{tour.id}" class="relative block aspect-[16/9] overflow-hidden bg-slate-100">
						{#if tour.hero}
							<img
								src={tour.hero.url}
								alt={tour.hero.altText || tour.title}
								loading="lazy"
								class="size-full object-cover transition duration-300 group-hover:scale-[1.025]"
							/>
						{:else}
							<span class="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-brand-50 text-slate-400">
								<svg class="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
									<path d="M4 5.5h16v13H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-4 6 4.5-4 3.5 3 2.5-2 5.5 5" />
								</svg>
								<span class="text-xs font-medium">Add a main photo</span>
							</span>
						{/if}
						<span class="badge absolute top-3 left-3 shadow-sm ring-1 ring-white/50 {TONES[tour.status] ?? 'bg-slate-100 text-slate-600'}">
							{statusLabel(tour.status)}
						</span>
						{#if tour.featured}
							<span class="badge absolute top-3 right-3 bg-purple text-white shadow-sm">Featured</span>
						{/if}
					</a>

					<div class="flex flex-1 flex-col p-4">
						<div class="flex items-start gap-3">
							<div class="min-w-0 flex-1">
								<a href="/app/tours/{tour.id}" class="block truncate text-base font-semibold text-slate-900 transition hover:text-brand-600">
									{tour.title}
								</a>
								<p class="mt-1 h-10 overflow-hidden text-xs leading-5 {tour.shortDescription ? 'text-slate-500' : 'italic text-slate-400'}">
									{tour.shortDescription || 'Add a short description to help travellers understand this tour.'}
								</p>
							</div>
							<a href="/app/tours/{tour.id}" aria-label="Open {tour.title}" class="mt-0.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500">
								<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>
							</a>
						</div>

						<div class="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3">
							<div class="flex min-w-0 items-center gap-2.5">
								<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
									<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></svg>
								</span>
								<div class="min-w-0">
									<p class="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Duration</p>
									<p class="truncate text-xs font-semibold text-slate-700">
										{tour.durationDays} {tour.durationDays === 1 ? 'day' : 'days'}{#if tour.durationNights != null} · {tour.durationNights} nights{/if}
									</p>
								</div>
							</div>
							<div class="flex min-w-0 items-center gap-2.5">
								<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
									<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 5.5h14v9H3zM6 8h.01M14 12h.01M8 10h4" /></svg>
								</span>
								<div class="min-w-0">
									<p class="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Price</p>
									{#if tour.priceFrom && tour.currency}
										<p class="truncate text-xs font-semibold text-slate-700"><Money amount={tour.priceFrom} currency={tour.currency} /></p>
										<p class="truncate text-[11px] text-slate-400">{PRICE_TYPE[tour.pricingType] ?? 'starting price'}</p>
									{:else}
										<p class="text-xs font-medium text-slate-400">Not priced</p>
									{/if}
								</div>
							</div>
						</div>

						{#if tour.status === 'CHANGES_REQUESTED'}
							<div class="mt-3 flex gap-2 rounded-panel bg-danger/5 px-2.5 py-2 text-xs leading-4 text-danger">
								<svg class="mt-0.5 size-3.5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6.5v4M10 13.5h.01" /></svg>
								<span>The Makutano team left a note. Open the listing to see what needs to change.</span>
							</div>
						{/if}

						<div class="mt-auto flex items-center justify-between gap-3 pt-3 text-xs text-slate-400">
							<span>Updated {fmt(tour.updatedAt)}</span>
							<a href="/app/tours/{tour.id}" class="shrink-0 font-semibold text-brand-600 hover:underline">Manage tour</a>
						</div>
					</div>
				</article>
			{/each}
		</section>
		<div class="card overflow-hidden">
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		</div>
	{:else}
		<div class="card px-4 py-12 text-center">
			{#if search || data.status}
				<p class="text-sm font-medium text-slate-700">Nothing here matches that.</p>
				<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
					Try a different word, or <a href={urlFor('')} class="text-brand-600 hover:underline">show every listing</a>.
				</p>
			{:else}
				<!-- The first listing is the hardest one to start, so say how it starts
				     rather than reporting that an empty card grid has no rows. -->
				<div class="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 15 7.5 9l3 4 2.5-3 4 5M3 4h14v12H3z" /></svg>
				</div>
				<p class="mt-3 text-sm font-medium text-slate-700">No listings yet.</p>
				<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
					Begin with the tour you sell most. A working title is all it takes — the composer
					then asks for the itinerary, the price and the photos one step at a time, and
					nothing reaches a traveller until the Makutano team has approved it.
				</p>
				{#if data.canWrite}
					<button class="btn-primary mt-4" onclick={openNew}>Start your first listing</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>
