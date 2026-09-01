<script lang="ts">
	import { groupTypeLabel } from '$lib/tour-options';
	// Everything a reviewer needs in one page, in the order they judge it: who is asking,
	// what is missing, what the traveller would see, and only then the buttons.
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();

	const t = $derived(data.listing);
	// The page only ever renders what the server said is legal from this status, so a
	// button that could only produce a CONFLICT is never on screen.
	const can = (action: string) => data.offered.some((offered) => offered === action);

	let panel = $state<'approve' | 'request_changes' | null>(null);
	let note = $state('');

	const PRICING: Record<string, string> = { PER_PERSON: 'per person', PER_GROUP: 'per group', FROM: 'from' };
	const AVAILABILITY: Record<string, string> = {
		YEAR_ROUND: 'All year',
		SEASONAL: 'Seasonal',
		DATE_RANGE: 'Fixed dates'
	};

	const duration = $derived(
		`${t.durationDays} day${t.durationDays === 1 ? '' : 's'}${t.durationNights ? ` · ${t.durationNights} night${t.durationNights === 1 ? '' : 's'}` : ''}`
	);
	const groupSize = $derived(
		t.groupSizeMin || t.groupSizeMax ? `${t.groupSizeMin ?? '?'}–${t.groupSizeMax ?? '?'} travellers` : null
	);
</script>

<svelte:head><title>{t.title} · Makutano Admin</title></svelte:head>

<FormToast {form} successTitle="Listing updated" />

<div class="space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<a href="/admin/marketplace/tours" class="text-xs text-slate-500 hover:underline">← Tour listings</a>
			<h1 class="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-800">
				{t.title}
				<StatusBadge value={t.status} />
				{#if t.featured}<span class="badge bg-purple/10 text-purple">Featured</span>{/if}
			</h1>
			<p class="text-[12.5px] text-slate-500">
				<span class="font-medium text-slate-600">{data.operator.name}</span>
				{#if data.operator.verified}<span class="badge ml-1 bg-success/10 text-success">verified</span>{/if}
				{#if data.country}· {data.country}{/if}
				· <span class="font-mono text-slate-400">{t.slug}</span>
			</p>
		</div>
	</div>

	{#if data.operator.accountStatus !== 'ACTIVE' && data.operator.accountStatus !== 'TRIAL'}
		<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">
			This operator's account is {data.operator.accountStatus.toLowerCase()}, and every review action below will be
			refused until it is active again — including taking a live listing down. Reactivate the tenant first.
		</p>
	{/if}

	{#if data.missing.length}
		<!-- The operator was told the same thing when they submitted. Worth repeating here:
		     a listing can pass that gate and then lose a photo to a media delete. -->
		<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">
			<b>Incomplete.</b> This listing is still missing {data.missing.join(', ')}.
		</p>
	{/if}

	<!-- Review decisions -->
	<section class="card p-4">
		<h2 class="card-title mb-3">Review</h2>
		<div class="flex flex-wrap items-center gap-2">
			{#if can('start_review')}
				<form method="POST" action="?/startReview" use:enhance>
					<button class="btn-secondary">Start review</button>
				</form>
			{/if}
			{#if can('approve')}
				<button class="btn-primary" onclick={() => { panel = panel === 'approve' ? null : 'approve'; note = ''; }}>
					Approve
				</button>
			{/if}
			{#if can('request_changes')}
				<button class="btn-danger" onclick={() => { panel = panel === 'request_changes' ? null : 'request_changes'; note = ''; }}>
					Request changes
				</button>
			{/if}
			{#if can('publish')}
				<form method="POST" action="?/publish" use:enhance>
					<!-- Says which of the two it is: a first publication, or putting back
					     something that was taken down. -->
					<button class="btn-primary">
						{t.status === 'UNPUBLISHED' ? 'Put it back on the marketplace' : 'Publish to the marketplace'}
					</button>
				</form>
			{/if}
			{#if can('unpublish')}
				<form method="POST" action="?/unpublish" use:enhance>
					<button class="btn-danger">Unpublish</button>
				</form>
			{/if}
			{#if !data.offered.length}
				<p class="text-xs text-slate-500">
					Nothing for the platform to do while this listing is {t.status === 'ARCHIVED' ? 'archived' : 'with the operator'}.
				</p>
			{/if}

			<!-- Featured is the marketplace's own editorial slot, not a lifecycle step, so it
			     sits apart from the review buttons and stays available at any status. -->
			<form method="POST" action="?/feature" use:enhance class="ml-auto flex items-center gap-2">
				<input type="hidden" name="featured" value={t.featured ? 'false' : 'true'} />
				<button class="btn-secondary !py-1.5 text-[12.5px]">
					{t.featured ? 'Remove from featured' : 'Feature on the marketplace'}
				</button>
			</form>
		</div>

		{#if panel === 'approve'}
			<form method="POST" action="?/approve" use:enhance={() => async ({ update }) => { await update(); panel = null; }} class="mt-3 space-y-2 rounded-panel border border-slate-200 bg-slate-50 p-3">
				<label class="label" for="approve-note">Note for the operator (optional)</label>
				<input id="approve-note" name="note" bind:value={note} placeholder="Anything they should know" class="input" />
				<div class="flex items-center gap-2">
					<button class="btn-primary !py-1.5 text-[12.5px]">Confirm approval</button>
					<button type="button" class="text-xs text-slate-500" onclick={() => (panel = null)}>Cancel</button>
				</div>
			</form>
		{/if}

		{#if panel === 'request_changes'}
			<form method="POST" action="?/requestChanges" use:enhance={() => async ({ update }) => { await update(); panel = null; }} class="mt-3 space-y-2 rounded-panel border border-danger/30 bg-danger/5 p-3">
				<label class="label" for="change-note">What needs to change</label>
				<textarea id="change-note" name="note" bind:value={note} required rows="3" placeholder="The operator sees only this note — say what to fix." class="input"></textarea>
				<div class="flex items-center gap-2">
					<!-- Refused in the UI as well as the service: sending a listing back with no
					     reason leaves the operator guessing at what we objected to. -->
					<button class="btn-danger !py-1.5 text-[12.5px]" disabled={!note.trim()}>Send back to the operator</button>
					<button type="button" class="text-xs text-slate-500" onclick={() => (panel = null)}>Cancel</button>
				</div>
			</form>
		{/if}

		<dl class="mt-4 grid gap-x-6 gap-y-2.5 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
			<div>
				<dt class="text-slate-400">Submitted</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if t.submittedAt}<TimeAgo value={t.submittedAt} />{:else}Never submitted{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Last reviewed</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if t.reviewedAt}
						<TimeAgo value={t.reviewedAt} />{#if data.reviewer}<span class="ml-1 text-slate-400">by {data.reviewer}</span>{/if}
					{:else}
						<span class="text-slate-400">Not yet</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Published</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if t.publishedAt}<TimeAgo value={t.publishedAt} />{:else}<span class="text-slate-400">Never</span>{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Last edited</dt>
				<dd class="mt-0.5 font-medium text-slate-700"><TimeAgo value={t.updatedAt} /></dd>
			</div>
			{#if t.reviewNote}
				<div class="sm:col-span-2 lg:col-span-4">
					<dt class="text-slate-400">Note on the record</dt>
					<dd class="mt-0.5 whitespace-pre-line rounded-panel bg-slate-50 p-2 text-slate-700">{t.reviewNote}</dd>
				</div>
			{/if}
		</dl>
	</section>

	<div class="grid gap-4 lg:grid-cols-3">
		<div class="space-y-4 lg:col-span-2">
			<!-- What the traveller reads -->
			<section class="card p-4">
				<h2 class="card-title mb-3">The listing</h2>
				{#if t.shortDescription}
					<p class="text-sm font-medium text-slate-700">{t.shortDescription}</p>
				{/if}
				{#if t.description}
					<p class="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">{t.description}</p>
				{:else}
					<p class="mt-2 text-xs text-slate-400">No full description.</p>
				{/if}

				{#each [{ label: 'Highlights', items: t.highlights }, { label: "What's included", items: t.included }, { label: 'Not included', items: t.excluded }] as block (block.label)}
					{#if block.items.length}
						<div class="mt-3">
							<h3 class="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{block.label}</h3>
							<ul class="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-600">
								{#each block.items as item (item)}<li>{item}</li>{/each}
							</ul>
						</div>
					{/if}
				{/each}
			</section>

			<!-- Destinations, as canonical platform places -->
			<section class="card p-4">
				<h2 class="card-title mb-3">Destinations</h2>
				{#if data.destinations.length}
					<div class="flex flex-wrap gap-1.5">
						{#each data.destinations as place (place.id)}
							<span class="badge bg-brand-50 text-brand-600">{place.name}</span>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-slate-400">No destinations linked.</p>
				{/if}
			</section>

			<!-- The itinerary, in the order it is travelled -->
			<section class="card p-4">
				<h2 class="card-title mb-3">Itinerary</h2>
				{#if data.itinerary.length}
					<ol class="space-y-3">
						{#each data.itinerary as day (day.id)}
							<li class="border-l-2 border-slate-200 pl-3">
								<div class="flex flex-wrap items-baseline gap-2">
									<span class="text-[11.5px] font-semibold uppercase tracking-wide text-brand-600">Day {day.dayNumber}</span>
									<span class="text-sm font-medium text-slate-700">{day.title}</span>
									{#if day.destination}<span class="badge bg-slate-100 text-slate-600">{day.destination}</span>{/if}
								</div>
								{#if day.description}
									<p class="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{day.description}</p>
								{/if}
								<dl class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-500">
									{#if day.accommodation}<div><dt class="mr-1 inline text-slate-400">Stay:</dt><dd class="inline">{day.accommodation}</dd></div>{/if}
									{#if day.meals}<div><dt class="mr-1 inline text-slate-400">Meals:</dt><dd class="inline">{day.meals}</dd></div>{/if}
									{#if day.distance}<div><dt class="mr-1 inline text-slate-400">Distance:</dt><dd class="inline">{day.distance}</dd></div>{/if}
									{#if day.estimatedTravelTime}<div><dt class="mr-1 inline text-slate-400">Travel:</dt><dd class="inline">{day.estimatedTravelTime}</dd></div>{/if}
								</dl>
								{#if day.activities.length}
									<p class="mt-1 text-[11.5px] text-slate-500">{day.activities.join(' · ')}</p>
								{/if}
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-xs text-slate-400">No itinerary days yet.</p>
				{/if}
			</section>

			<!-- Photographs, as the marketplace would serve them -->
			<section class="card p-4">
				<h2 class="card-title mb-3">Images</h2>
				{#if data.hero}
					<figure>
						<img src={data.hero.url} alt={data.hero.altText ?? ''} class="w-full rounded-panel object-cover" />
						<figcaption class="mt-1 text-[11.5px] text-slate-400">
							Main photo{#if !data.hero.altText} · <span class="text-[#b58514]">no alt text</span>{/if}
						</figcaption>
					</figure>
				{:else}
					<p class="text-xs text-slate-400">No main photo.</p>
				{/if}
				{#if data.gallery.length}
					<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each data.gallery as image (image?.id)}
							{#if image}
								<img src={image.url} alt={image.altText ?? ''} class="aspect-[4/3] w-full rounded-panel object-cover" />
							{/if}
						{/each}
					</div>
				{/if}
			</section>
		</div>

		<div class="space-y-4">
			<!-- The facts a reviewer checks against the copy -->
			<section class="card p-4">
				<h2 class="card-title mb-3">Details</h2>
				<dl class="space-y-2.5 text-xs">
					<div><dt class="text-slate-400">Operator</dt><dd class="mt-0.5 font-medium text-slate-700">{data.operator.name}</dd></div>
					<div><dt class="text-slate-400">Country</dt><dd class="mt-0.5 font-medium text-slate-700">{data.country ?? '—'}</dd></div>
					<div><dt class="text-slate-400">Duration</dt><dd class="mt-0.5 font-medium text-slate-700">{duration}</dd></div>
					<div>
						<dt class="text-slate-400">Price from</dt>
						<dd class="mt-0.5 font-medium text-slate-700">
							{#if t.priceFrom && t.currency}
								<Money amount={t.priceFrom} currency={t.currency} />
								<span class="text-slate-400">{PRICING[t.pricingType] ?? t.pricingType}</span>
							{:else}
								<span class="text-slate-400">Not priced</span>
							{/if}
						</dd>
					</div>
					<div>
						<dt class="text-slate-400">Availability</dt>
						<dd class="mt-0.5 font-medium text-slate-700">
							{AVAILABILITY[t.availabilityType] ?? t.availabilityType}
							{#if t.availableFrom || t.availableTo}
								<span class="text-slate-400">· {t.availableFrom ?? '…'} → {t.availableTo ?? '…'}</span>
							{/if}
						</dd>
					</div>
					{#if t.travelStyle}<div><dt class="text-slate-400">Travel style</dt><dd class="mt-0.5 font-medium text-slate-700">{t.travelStyle}</dd></div>{/if}
					{#if t.groupType || groupSize}
						<div>
							<dt class="text-slate-400">Group</dt>
							<dd class="mt-0.5 font-medium text-slate-700">{[groupTypeLabel(t.groupType), groupSize].filter(Boolean).join(' · ')}</dd>
						</div>
					{/if}
					{#if t.ageRequirement}<div><dt class="text-slate-400">Ages</dt><dd class="mt-0.5 font-medium text-slate-700">{t.ageRequirement}</dd></div>{/if}
					{#each [{ label: 'Accommodation', value: t.accommodationSummary }, { label: 'Transport', value: t.transportSummary }, { label: 'Meals', value: t.mealsSummary }, { label: 'Best time to go', value: t.bestTimeSummary }] as fact (fact.label)}
						{#if fact.value}
							<div><dt class="text-slate-400">{fact.label}</dt><dd class="mt-0.5 text-slate-600">{fact.value}</dd></div>
						{/if}
					{/each}
				</dl>
			</section>

			<!-- What a search engine would show -->
			<section class="card p-4">
				<h2 class="card-title mb-3">Search listing</h2>
				<dl class="space-y-2.5 text-xs">
					<div>
						<dt class="text-slate-400">URL slug</dt>
						<dd class="mt-0.5 font-mono text-slate-600">{t.slug}</dd>
					</div>
					<div>
						<dt class="text-slate-400">Title tag</dt>
						<dd class="mt-0.5 text-slate-700">{t.seoTitle ?? t.title} {#if !t.seoTitle}<span class="text-slate-400">(from the listing title)</span>{/if}</dd>
					</div>
					<div>
						<dt class="text-slate-400">Meta description</dt>
						<dd class="mt-0.5 text-slate-600">
							{#if t.seoDescription}{t.seoDescription}{:else}<span class="text-slate-400">Not set</span>{/if}
						</dd>
					</div>
				</dl>
			</section>
		</div>
	</div>
</div>
