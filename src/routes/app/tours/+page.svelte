<script lang="ts">
	// The listing shelf. One row per listing, and the status is the first thing on it —
	// "where is this in the review" is the only question this page exists to answer.
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

	let showNew = $state(false);

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
			<button class="btn-primary" onclick={() => (showNew = !showNew)}>New listing</button>
		{/if}
	</div>

	{#if showNew && data.canWrite}
		<form method="POST" action="?/create" use:enhance class="card flex flex-wrap items-end gap-2 p-3">
			<label class="block min-w-0 flex-1">
				<span class="label">What is this tour called?</span>
				<input name="title" placeholder="6-Day Northern Circuit Safari" class="input w-full" />
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

	<div class="card overflow-hidden">
		<table class="mobile-record-table min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50">
				<tr>
					<th class="table-head">Listing</th>
					<th class="table-head">Status</th>
					<th class="table-head">Duration</th>
					<th class="table-head">From</th>
					<th class="table-head">Updated</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.items as tour (tour.id)}
					<tr>
						<td class="table-cell mobile-record-title">
							<a href="/app/tours/{tour.id}" class="font-medium text-brand-600 hover:underline">{tour.title}</a>
							{#if tour.shortDescription}
								<div class="mt-0.5 max-w-[28rem] truncate text-xs text-slate-400">{tour.shortDescription}</div>
							{/if}
							<div class="mt-1 sm:hidden">
								<span class="badge {TONES[tour.status] ?? 'bg-slate-100 text-slate-600'}">{statusLabel(tour.status)}</span>
							</div>
							{#if tour.status === 'CHANGES_REQUESTED'}
								<!-- The one status on this shelf that is the vendor's move. A badge alone
								     says where the listing is; this says what to do about it. -->
								<div class="mt-1 text-xs font-medium text-danger">
									The Makutano team left a note — open it to read what they need.
								</div>
							{/if}
						</td>
						<td class="table-cell mobile-hide" data-label="Status">
							<span class="badge {TONES[tour.status] ?? 'bg-slate-100 text-slate-600'}">{statusLabel(tour.status)}</span>
						</td>
						<td class="table-cell text-xs text-slate-500" data-label="Duration">
							{tour.durationDays}
							{tour.durationDays === 1 ? 'day' : 'days'}{#if tour.durationNights != null}, {tour.durationNights} nights{/if}
						</td>
						<td class="table-cell font-semibold" data-label="From">
							{#if tour.priceFrom && tour.currency}
								<Money amount={tour.priceFrom} currency={tour.currency} />
							{:else}
								<span class="text-xs font-normal text-slate-400">Not priced</span>
							{/if}
						</td>
						<td class="table-cell text-xs text-slate-400" data-label="Updated">{fmt(tour.updatedAt)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="px-3 py-10 text-center">
							{#if search || data.status}
								<p class="text-sm font-medium text-slate-700">Nothing here matches that.</p>
								<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
									Try a different word, or <a href={urlFor('')} class="text-brand-600 hover:underline">show every listing</a>.
								</p>
							{:else}
								<!-- The first listing is the hardest one to start, so say how it starts
								     rather than reporting that the table is empty. -->
								<p class="text-sm font-medium text-slate-700">No listings yet.</p>
								<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
									Begin with the tour you sell most. A working title is all it takes — the composer
									then asks for the itinerary, the price and the photos one step at a time, and
									nothing reaches a traveller until the Makutano team has approved it.
								</p>
								{#if data.canWrite}
									<button class="btn-primary mt-4" onclick={() => (showNew = true)}>Start your first listing</button>
								{/if}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
	</div>
</div>
