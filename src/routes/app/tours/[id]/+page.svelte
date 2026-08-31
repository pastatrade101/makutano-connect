<script lang="ts">
	// The tour composer.
	//
	// Six steps, one page, one URL. Deliberately NOT a router-driven wizard: writing a
	// listing is one long sitting, people jump back and forth between the itinerary and
	// the basics, and a step per route means a navigation — and a lost paragraph — every
	// time they do. So the whole model lives in `draft` here rather than in the DOM: the
	// five inactive steps are unmounted, and nothing typed in them goes with them.
	//
	// Nothing on this page approves, publishes, features or requests changes. Those are
	// the marketplace team's acts, and tours:publish is held by no tenant role.
	import { untrack } from 'svelte';
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import { statusLabel } from '$lib/labels';
	import type { SubmitFunction } from '@sveltejs/kit';
	let { data, form } = $props();

	const STEPS = [
		{ key: 'basics', label: 'Basics' },
		{ key: 'location', label: 'Location' },
		{ key: 'itinerary', label: 'Itinerary' },
		{ key: 'pricing', label: 'Pricing' },
		{ key: 'media', label: 'Media' },
		{ key: 'review', label: 'Review & submit' }
	] as const;
	type StepKey = (typeof STEPS)[number]['key'];
	let step = $state<StepKey>('basics');

	/** Same lifecycle palette as the listing shelf; the words come from statusLabel. */
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

	type Day = {
		title: string;
		destinationId: string;
		description: string;
		activities: string;
		accommodation: string;
		meals: string;
		distance: string;
		estimatedTravelTime: string;
	};

	/** Everything is held as a string: the server owns the parsing, and a half-typed
	 *  number must not vanish out of an input while it is still being typed. */
	function seed() {
		const t = data.tour;
		return {
			title: t.title,
			shortDescription: t.shortDescription ?? '',
			description: t.description ?? '',
			durationDays: String(t.durationDays ?? 1),
			durationNights: t.durationNights == null ? '' : String(t.durationNights),
			travelStyle: t.travelStyle ?? '',
			groupType: t.groupType ?? '',
			groupSizeMin: t.groupSizeMin == null ? '' : String(t.groupSizeMin),
			groupSizeMax: t.groupSizeMax == null ? '' : String(t.groupSizeMax),
			ageRequirement: t.ageRequirement ?? '',
			accommodationSummary: t.accommodationSummary ?? '',
			transportSummary: t.transportSummary ?? '',
			mealsSummary: t.mealsSummary ?? '',
			bestTimeSummary: t.bestTimeSummary ?? '',
			primaryCountryId: t.primaryCountryId ?? '',
			destinationIds: [...data.destinationIds],
			days: data.itinerary.map(
				(d): Day => ({
					title: d.title,
					destinationId: d.destinationId ?? '',
					description: d.description ?? '',
					activities: (d.activities ?? []).join(', '),
					accommodation: d.accommodation ?? '',
					meals: d.meals ?? '',
					distance: d.distance ?? '',
					estimatedTravelTime: d.estimatedTravelTime ?? ''
				})
			),
			priceFrom: t.priceFrom ?? '',
			currency: t.currency ?? data.tenant.currency,
			pricingType: t.pricingType
		};
	}

	// untrack: these are STARTING values for a model the vendor then owns. Read
	// reactively they would look like derivations, and every save would overwrite
	// whatever was typed since.
	let draft = $state(untrack(seed));
	let mediaOrder = $state(untrack(() => data.gallery.map((m) => m.id)));
	let heroMediaId = $state(untrack(() => data.tour.heroMediaId ?? ''));

	// A plain let, not $state: comparing it must not make the effect below depend on it.
	let seededFor = untrack(() => data.tour.id);
	$effect(() => {
		// Opening another listing reuses this component, so the model is re-seeded by
		// hand. Without it, one listing's unsaved paragraphs would appear under
		// another listing's title.
		if (data.tour.id === seededFor) return;
		seededFor = data.tour.id;
		draft = seed();
		mediaOrder = data.gallery.map((m) => m.id);
		heroMediaId = data.tour.heroMediaId ?? '';
		step = 'basics';
	});

	$effect(() => {
		const ids = data.gallery.map((m) => m.id);
		// Re-seed only when the SET changed — an upload or a delete. A reorder the vendor
		// has not saved yet has to survive the re-render that follows every other save.
		if (ids.length !== mediaOrder.length || ids.some((id) => !mediaOrder.includes(id))) mediaOrder = ids;
	});

	$effect(() => {
		// The first upload adopts itself as the main photo server-side; mirroring that
		// here stops the Media step from immediately looking unsaved.
		if (!heroMediaId && data.tour.heroMediaId) heroMediaId = data.tour.heroMediaId;
	});

	/* ------------------------------------------------------------- saving ---- */

	type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
	let saved = $state<Record<string, SaveState>>({});

	/** Report what actually happened. A step that failed must never flash "Saved". */
	const track =
		(key: string): SubmitFunction =>
		() => {
			saved[key] = 'saving';
			return async ({ result, update }) => {
				saved[key] = result.type === 'success' ? 'saved' : 'failed';
				// reset: false — the inputs are bound to `draft`, and resetting the form
				// would blank the DOM underneath a model that still holds the text.
				await update({ reset: false });
			};
		};

	/* ----------------------------------------------------------- location ---- */

	const byCountry = $derived(data.destinations.filter((d) => d.countryId === draft.primaryCountryId));
	const destinationName = $derived(new Map(data.destinations.map((d) => [d.id, d.name])));

	function chooseCountry(id: string) {
		if (id === draft.primaryCountryId) return;
		// A listing may only visit places inside its own country — the service refuses
		// the rest — so changing country clears a selection that could not be saved.
		draft.primaryCountryId = id;
		draft.destinationIds = [];
	}

	const toggleDestination = (id: string) =>
		(draft.destinationIds = draft.destinationIds.includes(id)
			? draft.destinationIds.filter((x) => x !== id)
			: [...draft.destinationIds, id]);

	/* ---------------------------------------------------------- itinerary ---- */

	const blankDay = (): Day => ({
		title: '',
		destinationId: '',
		description: '',
		activities: '',
		accommodation: '',
		meals: '',
		distance: '',
		estimatedTravelTime: ''
	});
	const addDay = () => (draft.days = [...draft.days, blankDay()]);
	const removeDay = (index: number) => (draft.days = draft.days.filter((_, n) => n !== index));
	function moveDay(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= draft.days.length) return;
		const next = [...draft.days];
		[next[index], next[to]] = [next[to], next[index]];
		draft.days = next;
	}

	/**
	 * What a day may point at.
	 *
	 * The places chosen in Location, never free text. A day still holding a place that
	 * has since been unticked there is listed too, flagged — dropping it silently is
	 * how a vendor loses a day's work without being told.
	 */
	const dayOptions = $derived([
		...draft.destinationIds.map((id) => ({ id, label: destinationName.get(id) ?? 'Unknown place' })),
		...data.destinations
			.filter((d) => !draft.destinationIds.includes(d.id) && draft.days.some((day) => day.destinationId === d.id))
			.map((d) => ({ id: d.id, label: `${d.name} — no longer selected in Location` }))
	]);

	/** Arusha → Tarangire → Serengeti, read off the days. Nobody types the route twice. */
	const route = $derived.by(() => {
		const names: string[] = [];
		for (const day of draft.days) {
			const name = destinationName.get(day.destinationId);
			if (name && name !== names[names.length - 1]) names.push(name);
		}
		return names;
	});

	/* ------------------------------------------------------------- review ---- */

	/**
	 * The requirements in the service's own words, so a tick and the gap it replaces
	 * are never two different sentences. `data.missing` stays the authority: anything
	 * it names that this list does not know about is still rendered, unticked.
	 */
	const REQUIREMENTS = [
		'a title',
		'a short description',
		'a country',
		'a duration of at least one day',
		'a starting price',
		'a currency',
		'a main photo',
		'at least one itinerary day',
		'at least one destination'
	];
	const checklist = $derived([
		...REQUIREMENTS.map((label) => ({ label, done: !data.missing.includes(label) })),
		...data.missing.filter((m) => !REQUIREMENTS.includes(m)).map((label) => ({ label, done: false }))
	]);
	const ready = $derived(data.missing.length === 0);

	// The vendor half of the lifecycle, mirrored so the page offers only what is legal.
	// The service still decides — this only keeps a dead button off the screen.
	const canSubmit = $derived(['DRAFT', 'CHANGES_REQUESTED', 'UNPUBLISHED'].includes(data.tour.status));
	const canUnpublish = $derived(data.tour.status === 'PUBLISHED');
	const canArchive = $derived(!['PUBLISHED', 'ARCHIVED'].includes(data.tour.status));
	const canRestore = $derived(data.tour.status === 'ARCHIVED');

	const photos = $derived(
		mediaOrder.map((id) => data.gallery.find((m) => m.id === id)).filter((m) => m !== undefined)
	);
	function movePhoto(index: number, delta: number) {
		const to = index + delta;
		if (to < 0 || to >= mediaOrder.length) return;
		const next = [...mediaOrder];
		[next[index], next[to]] = [next[to], next[index]];
		mediaOrder = next;
	}

	const maxMb = $derived(Math.round(data.maxUploadBytes / 1024 / 1024));
</script>

{#snippet saveBar(key: string, label = 'Save')}
	<div class="flex items-center gap-3 border-t border-slate-200 px-4 py-3">
		<button class="btn-primary" disabled={!data.canWrite}>{label}</button>
		<span
			class="text-xs {saved[key] === 'failed'
				? 'font-semibold text-danger'
				: saved[key] === 'saved'
					? 'text-success'
					: 'text-slate-400'}"
		>
			{saved[key] === 'saving' ? 'Saving…' : saved[key] === 'saved' ? 'Saved' : saved[key] === 'failed' ? 'Save failed' : ''}
		</span>
	</div>
{/snippet}

<svelte:head><title>{data.tour.title} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Listing saved" />

<div class="space-y-3">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<a href="/app/tours" class="text-xs text-slate-400 hover:underline">← Tours</a>
			<h1 class="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-lg">{draft.title || data.tour.title}</h1>
			<p class="text-xs text-slate-400">
				{#if data.tour.publishedAt}
					Live on the marketplace since {new Date(data.tour.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
				{:else if data.tour.submittedAt}
					Sent for review on {new Date(data.tour.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
				{:else}
					Nothing is public until the Makutano team approves it.
				{/if}
			</p>
		</div>
		<span class="badge {TONES[data.tour.status] ?? 'bg-slate-100 text-slate-600'}">{statusLabel(data.tour.status)}</span>
	</div>

	<!-- The reviewer's note is the whole reason this listing came back. It belongs at
	     the top of the page, in their words, next to the way to act on it — not in an
	     activity log the vendor has to go looking for. -->
	{#if data.tour.status === 'CHANGES_REQUESTED'}
		<div class="rounded-panel border border-danger/30 bg-danger/5 p-4">
			<h2 class="text-sm font-semibold text-danger">The marketplace team asked for changes</h2>
			<p class="mt-1.5 text-sm whitespace-pre-line text-slate-700">
				{data.tour.reviewNote || 'No note was left. Contact the marketplace team before resubmitting.'}
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<button type="button" class="btn-primary" onclick={() => (step = 'basics')}>Edit the listing</button>
				<button type="button" class="btn-secondary" onclick={() => (step = 'review')}>Resubmit</button>
			</div>
		</div>
	{/if}

	{#if !data.canWrite}
		<p class="rounded-panel border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
			You can read this listing but not change it.
		</p>
	{/if}

	<!-- Steps, not pages: switching one unmounts the others, and every field is bound
	     to `draft`, so nothing typed is lost by moving away and coming back. -->
	<nav class="card flex flex-wrap gap-1 p-2">
		{#each STEPS as s, i (s.key)}
			<button
				type="button"
				class="rounded-panel px-3 py-1.5 text-xs font-medium transition {step === s.key
					? 'bg-brand-500 text-white'
					: 'text-slate-600 hover:bg-slate-100'}"
				onclick={() => (step = s.key)}
			>
				<span class="tabular-nums opacity-60">{i + 1}.</span>
				{s.label}
			</button>
		{/each}
	</nav>

	{#if step === 'basics'}
		<form method="POST" action="?/saveBasics" use:enhance={track('basics')} class="card">
			<div class="card-header"><h2 class="card-title">Basics</h2></div>
			<div class="grid gap-3 p-4 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="label" for="t-title">Title</label>
					<input id="t-title" name="title" bind:value={draft.title} class="input" placeholder="6-Day Northern Circuit Safari" />
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="t-short">Short description</label>
					<input
						id="t-short"
						name="shortDescription"
						bind:value={draft.shortDescription}
						class="input"
						placeholder="One sentence a traveller reads before anything else."
					/>
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="t-desc">Full description</label>
					<textarea id="t-desc" name="description" bind:value={draft.description} rows="6" class="input"></textarea>
				</div>
				<div>
					<label class="label" for="t-days">Days</label>
					<input id="t-days" name="durationDays" bind:value={draft.durationDays} inputmode="numeric" class="input" />
				</div>
				<div>
					<label class="label" for="t-nights">Nights</label>
					<input id="t-nights" name="durationNights" bind:value={draft.durationNights} inputmode="numeric" class="input" />
				</div>
				<div>
					<label class="label" for="t-style">Travel style</label>
					<input id="t-style" name="travelStyle" bind:value={draft.travelStyle} class="input" placeholder="Safari, Honeymoon, Photography" />
				</div>
				<div>
					<label class="label" for="t-group">Group type</label>
					<input id="t-group" name="groupType" bind:value={draft.groupType} class="input" placeholder="Private, Small group, Family" />
				</div>
				<div>
					<label class="label" for="t-min">Smallest group</label>
					<input id="t-min" name="groupSizeMin" bind:value={draft.groupSizeMin} inputmode="numeric" class="input" />
				</div>
				<div>
					<label class="label" for="t-max">Largest group</label>
					<input id="t-max" name="groupSizeMax" bind:value={draft.groupSizeMax} inputmode="numeric" class="input" />
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="t-age">Age requirement</label>
					<input id="t-age" name="ageRequirement" bind:value={draft.ageRequirement} class="input" placeholder="Minimum 8 years old" />
				</div>
				<div>
					<label class="label" for="t-acc">Accommodation</label>
					<textarea id="t-acc" name="accommodationSummary" bind:value={draft.accommodationSummary} rows="3" class="input"></textarea>
				</div>
				<div>
					<label class="label" for="t-trans">Transport</label>
					<textarea id="t-trans" name="transportSummary" bind:value={draft.transportSummary} rows="3" class="input"></textarea>
				</div>
				<div>
					<label class="label" for="t-meals">Meals</label>
					<textarea id="t-meals" name="mealsSummary" bind:value={draft.mealsSummary} rows="3" class="input"></textarea>
				</div>
				<div>
					<label class="label" for="t-best">Best time to travel</label>
					<textarea id="t-best" name="bestTimeSummary" bind:value={draft.bestTimeSummary} rows="3" class="input"></textarea>
				</div>
			</div>
			{@render saveBar('basics')}
		</form>
	{/if}

	{#if step === 'location'}
		<form method="POST" action="?/saveLocation" use:enhance={track('location')} class="card">
			<div class="card-header"><h2 class="card-title">Location</h2></div>
			<div class="space-y-4 p-4">
				<div>
					<label class="label" for="t-country">Country</label>
					<select
						id="t-country"
						name="primaryCountryId"
						class="input sm:max-w-xs"
						value={draft.primaryCountryId}
						onchange={(e) => chooseCountry(e.currentTarget.value)}
					>
						<option value="">Choose a country…</option>
						{#each data.countries as country (country.id)}
							<option value={country.id}>{country.name}</option>
						{/each}
					</select>
					<p class="mt-1.5 text-xs text-slate-400">
						The country comes first — the places below are the ones the marketplace already
						publishes for it, and a listing can only visit its own country.
					</p>
				</div>

				{#if draft.primaryCountryId}
					<fieldset>
						<legend class="label">Places this tour visits</legend>
						{#if byCountry.length}
							<div class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
								{#each byCountry as destination (destination.id)}
									<label
										class="flex cursor-pointer items-center gap-2 rounded-panel border px-3 py-2 text-sm transition {draft.destinationIds.includes(
											destination.id
										)
											? 'border-brand-500 bg-brand-50 text-slate-700'
											: 'border-slate-200 text-slate-600 hover:border-slate-300'}"
									>
										<input
											type="checkbox"
											name="destinationIds"
											value={destination.id}
											checked={draft.destinationIds.includes(destination.id)}
											onchange={() => toggleDestination(destination.id)}
										/>
										<span class="min-w-0 truncate">{destination.name}</span>
									</label>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-slate-400">
								The marketplace has not published any destinations for this country yet. Ask the
								Makutano team to add the places you sell.
							</p>
						{/if}
					</fieldset>
				{/if}
			</div>
			{@render saveBar('location')}
		</form>
	{/if}

	{#if step === 'itinerary'}
		<form method="POST" action="?/saveItinerary" use:enhance={track('itinerary')} class="card">
			<div class="card-header">
				<h2 class="card-title">Itinerary</h2>
				<button type="button" class="btn-secondary" onclick={addDay} disabled={!data.canWrite}>Add a day</button>
			</div>
			<!-- The finished list, as one field. The days are reordered and renumbered in
			     the browser, so the browser is what knows the final shape; the server
			     renumbers 1..n from the order it receives. -->
			<input type="hidden" name="days" value={JSON.stringify(draft.days)} />

			<div class="space-y-3 p-4">
				{#if route.length}
					<!-- Read off the days, never typed. Consecutive repeats collapse, so three
					     nights in the Serengeti read as one stop on the route. -->
					<p class="rounded-panel bg-slate-50 px-3 py-2 text-sm text-slate-600">
						<span class="text-xs font-semibold text-slate-400 uppercase">Route</span><br />
						{route.join(' → ')}
					</p>
				{/if}

				{#each draft.days as day, index (index)}
					<div class="rounded-panel border border-slate-200 p-3">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wide text-slate-400 uppercase">Day {index + 1}</span>
							<div class="flex gap-1">
								<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => moveDay(index, -1)} disabled={index === 0}>↑</button>
								<button
									type="button"
									class="btn-secondary px-2 py-1 text-xs"
									onclick={() => moveDay(index, 1)}
									disabled={index === draft.days.length - 1}>↓</button
								>
								<button type="button" class="btn-danger px-2 py-1 text-xs" onclick={() => removeDay(index)}>Remove</button>
							</div>
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label class="label" for="d-title-{index}">Title</label>
								<input id="d-title-{index}" bind:value={day.title} class="input" placeholder="Arusha to Tarangire" />
							</div>
							<div>
								<label class="label" for="d-dest-{index}">Destination</label>
								<select id="d-dest-{index}" bind:value={day.destinationId} class="input">
									<option value="">No destination</option>
									{#each dayOptions as option (option.id)}
										<option value={option.id}>{option.label}</option>
									{/each}
								</select>
							</div>
							<div class="sm:col-span-2">
								<label class="label" for="d-desc-{index}">What happens</label>
								<textarea id="d-desc-{index}" bind:value={day.description} rows="3" class="input"></textarea>
							</div>
							<div class="sm:col-span-2">
								<label class="label" for="d-act-{index}">Activities (comma-separated)</label>
								<input id="d-act-{index}" bind:value={day.activities} class="input" placeholder="Game drive, Sundowner" />
							</div>
							<div>
								<label class="label" for="d-acc-{index}">Accommodation</label>
								<input id="d-acc-{index}" bind:value={day.accommodation} class="input" />
							</div>
							<div>
								<label class="label" for="d-meals-{index}">Meals</label>
								<input id="d-meals-{index}" bind:value={day.meals} class="input" placeholder="Breakfast, Lunch, Dinner" />
							</div>
							<div>
								<label class="label" for="d-dist-{index}">Distance</label>
								<input id="d-dist-{index}" bind:value={day.distance} class="input" placeholder="120 km" />
							</div>
							<div>
								<label class="label" for="d-time-{index}">Travel time</label>
								<input id="d-time-{index}" bind:value={day.estimatedTravelTime} class="input" placeholder="About 2 hours" />
							</div>
						</div>
					</div>
				{:else}
					<p class="py-6 text-center text-xs text-slate-400">
						No days yet. Add the first one — the route across the top writes itself from them.
					</p>
				{/each}

				{#if !draft.destinationIds.length}
					<p class="text-xs text-slate-400">
						Choose the places this tour visits in <button type="button" class="text-brand-600 hover:underline" onclick={() => (step = 'location')}>Location</button>
						and each day can name one of them.
					</p>
				{/if}
			</div>
			{@render saveBar('itinerary')}
		</form>
	{/if}

	{#if step === 'pricing'}
		<form method="POST" action="?/savePricing" use:enhance={track('pricing')} class="card">
			<div class="card-header"><h2 class="card-title">Pricing</h2></div>
			<div class="grid gap-3 p-4 sm:grid-cols-3">
				<div>
					<label class="label" for="t-price">Price from</label>
					<input id="t-price" name="priceFrom" bind:value={draft.priceFrom} inputmode="decimal" class="input" placeholder="1850.00" />
				</div>
				<div>
					<label class="label" for="t-currency">Currency</label>
					<input id="t-currency" name="currency" bind:value={draft.currency} class="input uppercase" maxlength="3" placeholder="USD" />
				</div>
				<div>
					<label class="label" for="t-pricing">What the price means</label>
					<select id="t-pricing" name="pricingType" bind:value={draft.pricingType} class="input">
						<option value="PER_PERSON">Per person</option>
						<option value="PER_GROUP">Per group</option>
						<option value="FROM">Starting from</option>
					</select>
				</div>
				<p class="text-xs text-slate-400 sm:col-span-3">
					One starting price is all the marketplace shows. Departure dates, seasonal rates and
					availability are agreed with the traveller in the enquiry that follows.
				</p>
			</div>
			{@render saveBar('pricing')}
		</form>
	{/if}

	{#if step === 'media'}
		<div class="space-y-3">
			<div class="card">
				<div class="card-header"><h2 class="card-title">Add a photo</h2></div>
				{#if data.mediaConfigured}
					<form
						method="POST"
						action="?/uploadPhoto"
						enctype="multipart/form-data"
						use:enhance={track('upload')}
						class="flex flex-wrap items-end gap-2 p-4"
					>
						<label class="block">
							<span class="label">Photo</span>
							<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" class="input" />
						</label>
						<label class="block min-w-0 flex-1">
							<!-- Captured at upload: alt text belongs to the image, and there is no
							     service call that rewrites it afterwards. Replace the photo to change it. -->
							<span class="label">Describe it (for screen readers and search)</span>
							<input name="altText" class="input w-full" placeholder="Elephants crossing the Tarangire river" />
						</label>
						<button class="btn-primary" disabled={!data.canWrite}>Upload</button>
						<span
							class="text-xs {saved.upload === 'failed'
								? 'font-semibold text-danger'
								: saved.upload === 'saved'
									? 'text-success'
									: 'text-slate-400'}"
						>
							{saved.upload === 'saving'
								? 'Uploading…'
								: saved.upload === 'saved'
									? 'Uploaded'
									: saved.upload === 'failed'
										? 'Upload failed'
										: `JPEG, PNG, WebP or AVIF up to ${maxMb}MB.`}
						</span>
					</form>
				{:else}
					<p class="p-4 text-xs text-slate-500">
						Photo storage is not switched on for this deployment yet, so uploads are unavailable.
					</p>
				{/if}
			</div>

			<form method="POST" action="?/saveMedia" use:enhance={track('media')} class="card">
				<div class="card-header">
					<h2 class="card-title">Photos</h2>
					<span class="text-xs text-slate-400">The main photo is what the marketplace shows first.</span>
				</div>
				<input type="hidden" name="heroMediaId" value={heroMediaId} />
				<div class="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each photos as photo, index (photo.id)}
						<!-- The url, never the objectKey. -->
						<div class="overflow-hidden rounded-panel border {heroMediaId === photo.id ? 'border-brand-500' : 'border-slate-200'}">
							<input type="hidden" name="mediaIds" value={photo.id} />
							<img src={photo.url} alt={photo.altText ?? ''} class="h-36 w-full object-cover" />
							<div class="flex items-center justify-between gap-1 p-2">
								<button
									type="button"
									class="text-xs {heroMediaId === photo.id ? 'font-semibold text-brand-600' : 'text-slate-500 hover:underline'}"
									onclick={() => (heroMediaId = photo.id)}
								>
									{heroMediaId === photo.id ? 'Main photo' : 'Make main'}
								</button>
								<div class="flex gap-1">
									<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => movePhoto(index, -1)} disabled={index === 0}>←</button>
									<button
										type="button"
										class="btn-secondary px-2 py-1 text-xs"
										onclick={() => movePhoto(index, 1)}
										disabled={index === photos.length - 1}>→</button
									>
								</div>
							</div>
							{#if photo.altText}<p class="truncate px-2 pb-2 text-xs text-slate-400">{photo.altText}</p>{/if}
						</div>
					{:else}
						<p class="py-6 text-center text-xs text-slate-400 sm:col-span-2 lg:col-span-3">
							No photos yet. A listing cannot be submitted without a main photo.
						</p>
					{/each}
				</div>
				{@render saveBar('media', 'Save order & main photo')}
			</form>

			{#if photos.length && data.canWrite}
				<div class="card p-4">
					<h2 class="card-title mb-2">Remove a photo</h2>
					<div class="flex flex-wrap gap-2">
						{#each photos as photo (photo.id)}
							<!-- Its own form: deleting is not something to fold into a Save button. -->
							<form method="POST" action="?/deletePhoto" use:enhance={track('delete')}>
								<input type="hidden" name="mediaId" value={photo.id} />
								<button class="btn-danger px-2 py-1 text-xs">
									Delete {photo.altText ? `“${photo.altText}”` : 'photo'}
								</button>
							</form>
						{/each}
					</div>
					{#if saved.delete === 'failed'}
						<p class="mt-2 text-xs font-semibold text-danger">Delete failed.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if step === 'review'}
		<div class="space-y-3">
			<div class="card">
				<div class="card-header">
					<h2 class="card-title">Before it goes to the marketplace team</h2>
					<span class="badge {TONES[data.tour.status] ?? 'bg-slate-100 text-slate-600'}">{statusLabel(data.tour.status)}</span>
				</div>
				<ul class="divide-y divide-slate-100">
					{#each checklist as item (item.label)}
						<li class="flex items-center gap-2 px-4 py-2.5 text-sm">
							{#if item.done}
								<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" stroke-width="2">
									<path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
								<span class="text-slate-500">This listing has {item.label}.</span>
							{:else}
								<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0 text-danger" fill="none" stroke="currentColor" stroke-width="2">
									<circle cx="10" cy="10" r="7" />
									<path d="M10 6.5v4.5m0 2.5v.01" stroke-linecap="round" />
								</svg>
								<span class="font-medium text-slate-700">Still needs {item.label}.</span>
							{/if}
						</li>
					{/each}
				</ul>
				<div class="border-t border-slate-200 p-4">
					{#if canSubmit}
						<form method="POST" action="?/transition" use:enhance={track('submit')} class="flex flex-wrap items-center gap-3">
							<input type="hidden" name="action" value="submit" />
							<!-- Disabled while anything is missing: the service refuses on the same
							     list, so an enabled button here could only ever promise a rejection. -->
							<button class="btn-primary" disabled={!ready || !data.canWrite}>Submit for review</button>
							<span
								class="text-xs {saved.submit === 'failed'
									? 'font-semibold text-danger'
									: saved.submit === 'saved'
										? 'text-success'
										: 'text-slate-400'}"
							>
								{saved.submit === 'saving'
									? 'Sending…'
									: saved.submit === 'saved'
										? 'Sent'
										: saved.submit === 'failed'
											? 'Could not send'
											: ready
												? 'The Makutano team reviews it and decides when it goes live.'
												: 'Fill in what is listed above first.'}
							</span>
						</form>
					{:else}
						<p class="text-sm text-slate-600">
							{#if data.tour.status === 'SUBMITTED' || data.tour.status === 'IN_REVIEW'}
								This listing is with the Makutano team. You will see the outcome here.
							{:else if data.tour.status === 'APPROVED'}
								Approved. The Makutano team decides when it goes live on the marketplace.
							{:else if data.tour.status === 'PUBLISHED'}
								Live on the marketplace. Take it down below if it is no longer bookable.
							{:else}
								This listing is archived. Restore it to go on working on it.
							{/if}
						</p>
					{/if}
				</div>
			</div>

			{#if data.canWrite && (canUnpublish || canArchive || canRestore)}
				<div class="card p-4">
					<h2 class="card-title mb-1">Take it off the shelf</h2>
					<p class="mb-3 text-xs text-slate-400">
						Pulling your own listing is yours to do — a tour you cannot run should not stay
						bookable while somebody reviews the decision.
					</p>
					<div class="flex flex-wrap gap-2">
						{#if canUnpublish}
							<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
								<input type="hidden" name="action" value="unpublish" />
								<button class="btn-secondary">Take off the marketplace</button>
							</form>
						{/if}
						{#if canArchive}
							<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
								<input type="hidden" name="action" value="archive" />
								<button class="btn-secondary">Archive</button>
							</form>
						{/if}
						{#if canRestore}
							<form method="POST" action="?/transition" use:enhance={track('lifecycle')}>
								<input type="hidden" name="action" value="restore" />
								<button class="btn-primary">Restore to draft</button>
							</form>
						{/if}
					</div>
					{#if saved.lifecycle === 'failed'}
						<p class="mt-2 text-xs font-semibold text-danger">That did not go through.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
