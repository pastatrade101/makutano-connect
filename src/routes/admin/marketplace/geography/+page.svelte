<script lang="ts">
	// One screen for the marketplace's reference data. Destinations are shown INSIDE
	// their country rather than in a list of their own: a destination without a country
	// is not a row the schema allows, and grouping is the cheapest way to say so.
	//
	// Editing is inline and one row at a time. A modal would need its own state, its own
	// close rules and its own scroll trap for a form that is read far more often than it
	// is written.
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();

	type Country = (typeof data.countries)[number];
	type Destination = (typeof data.destinations)[number];

	let newCountry = $state(false);
	let editCountry = $state<string | null>(null);
	// Holds the country a new destination is being added to, so the form knows its parent.
	let newDestination = $state<string | null>(null);
	let editDestination = $state<string | null>(null);

	const groups = $derived(
		data.countries.map((c) => ({ country: c, places: data.destinations.filter((d) => d.countryId === c.id) }))
	);

	const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

	/** The enum reads in SCREAMING_CASE; a person reading a table should not have to. */
	const TYPE_LABELS: Record<string, string> = {
		NATIONAL_PARK: 'National park',
		GAME_RESERVE: 'Game reserve',
		CONSERVATION_AREA: 'Conservation area',
		MOUNTAIN: 'Mountain',
		ISLAND: 'Island',
		BEACH: 'Beach',
		CITY: 'City',
		CULTURAL_AREA: 'Cultural area',
		LAKE: 'Lake',
		OTHER: 'Other'
	};

	// A saved form closes itself. Leaving it open reads as though nothing happened, and
	// the row underneath has already been redrawn with the new values.
	let handled: unknown = null;
	$effect(() => {
		if (!form || form === handled) return;
		handled = form;
		if (form.success) {
			newCountry = false;
			editCountry = null;
			newDestination = null;
			editDestination = null;
		}
	});
</script>

<svelte:head><title>Countries & destinations · Makutano Admin</title></svelte:head>

<FormToast {form} successTitle="Saved" />

{#snippet heroPanel(scope: 'country' | 'destination', id: string, hero: { url: string; altText: string | null } | null)}
	<div class="rounded-panel border border-slate-200 p-3">
		<p class="label">Hero photograph</p>
		{#if hero}
			<img src={hero.url} alt={hero.altText ?? ''} class="mb-2 h-32 w-full rounded-panel object-cover" />
		{/if}
		{#if data.mediaEnabled}
			<form method="POST" action="?/uploadHero" enctype="multipart/form-data" use:enhance class="flex flex-wrap items-end gap-2">
				<input type="hidden" name="scope" value={scope} />
				<input type="hidden" name="id" value={id} />
				<input
					type="file"
					name="file"
					required
					accept="image/jpeg,image/png,image/webp,image/avif"
					class="input min-w-[200px] flex-1 py-1.5 text-[12px]"
				/>
				<input name="altText" placeholder="Describe the photograph" class="input w-52 py-1.5 text-[12px]" />
				<button class="btn-secondary !px-2.5 !py-1.5 text-[12px]">{hero ? 'Replace' : 'Upload'}</button>
			</form>
			<div class="mt-1.5 flex flex-wrap items-center gap-3">
				<p class="text-[12px] text-slate-400">JPEG, PNG, WebP or AVIF, up to {data.maxImageMb}MB.</p>
				{#if hero}
					<form method="POST" action="?/removeHero" use:enhance>
						<input type="hidden" name="scope" value={scope} />
						<input type="hidden" name="id" value={id} />
						<button class="text-[12px] text-slate-400 hover:text-danger hover:underline">Remove photograph</button>
					</form>
				{/if}
			</div>
		{:else}
			<p class="text-[12px] text-slate-400">Image storage is not configured on this deployment.</p>
		{/if}
	</div>
{/snippet}

{#snippet countryFields(c: Country | null)}
	{@const k = c?.id ?? 'new'}
	<div>
		<label class="label" for="cn-{k}">Name</label>
		<input id="cn-{k}" name="name" value={c?.name ?? ''} placeholder="Tanzania" class="input" />
	</div>
	<div>
		<label class="label" for="cs-{k}">Web address</label>
		<input id="cs-{k}" name="slug" value={c?.slug ?? ''} placeholder="built from the name" class="input" />
		<p class="mt-1 font-mono text-[12px] text-slate-400">/countries/{c?.slug ?? '…'}</p>
	</div>
	<div>
		<label class="label" for="ci-{k}">ISO code</label>
		<input id="ci-{k}" name="isoCode" value={c?.isoCode ?? ''} maxlength="2" placeholder="TZ" class="input uppercase" />
	</div>
	<div class="sm:col-span-3">
		<label class="label" for="csd-{k}">Short description</label>
		<input
			id="csd-{k}"
			name="shortDescription"
			value={c?.shortDescription ?? ''}
			placeholder="One line, for the card the marketplace shows."
			class="input"
		/>
	</div>
	<div class="sm:col-span-3">
		<label class="label" for="cd-{k}">Description</label>
		<textarea id="cd-{k}" name="description" rows="4" class="input" placeholder="The country page itself.">{c?.description ?? ''}</textarea>
	</div>
	<div>
		<label class="label" for="cst-{k}">SEO title</label>
		<input id="cst-{k}" name="seoTitle" value={c?.seoTitle ?? ''} class="input" />
	</div>
	<div class="sm:col-span-2">
		<label class="label" for="csde-{k}">SEO description</label>
		<input id="csde-{k}" name="seoDescription" value={c?.seoDescription ?? ''} class="input" />
	</div>
{/snippet}

{#snippet destinationFields(d: Destination | null, countryId: string)}
	{@const k = d?.id ?? `new-${countryId}`}
	<div>
		<label class="label" for="dc-{k}">Country</label>
		<select id="dc-{k}" name="countryId" class="input">
			{#each data.countries as c (c.id)}
				<option value={c.id} selected={(d?.countryId ?? countryId) === c.id}>{c.name}</option>
			{/each}
		</select>
	</div>
	<div>
		<label class="label" for="dn-{k}">Name</label>
		<input id="dn-{k}" name="name" value={d?.name ?? ''} placeholder="Serengeti National Park" class="input" />
	</div>
	<div>
		<label class="label" for="dt-{k}">Type</label>
		<select id="dt-{k}" name="destinationType" class="input">
			{#each data.destinationTypes as t (t)}
				<option value={t} selected={(d?.destinationType ?? 'OTHER') === t}>{TYPE_LABELS[t] ?? t}</option>
			{/each}
		</select>
	</div>
	<div>
		<label class="label" for="ds-{k}">Web address</label>
		<input id="ds-{k}" name="slug" value={d?.slug ?? ''} placeholder="built from the name" class="input" />
		<p class="mt-1 font-mono text-[12px] text-slate-400">/destinations/{d?.slug ?? '…'}</p>
	</div>
	<div>
		<label class="label" for="dmin-{k}">Shortest stay (nights)</label>
		<input id="dmin-{k}" name="recommendedStayMin" type="number" min="1" value={d?.recommendedStayMin ?? ''} class="input" />
	</div>
	<div>
		<label class="label" for="dmax-{k}">Longest stay (nights)</label>
		<input id="dmax-{k}" name="recommendedStayMax" type="number" min="1" value={d?.recommendedStayMax ?? ''} class="input" />
	</div>
	<div class="sm:col-span-3">
		<label class="label" for="dsd-{k}">Short description</label>
		<input id="dsd-{k}" name="shortDescription" value={d?.shortDescription ?? ''} placeholder="One line, for a card." class="input" />
	</div>
	<div class="sm:col-span-3">
		<label class="label" for="dd-{k}">Description</label>
		<textarea id="dd-{k}" name="description" rows="4" class="input">{d?.description ?? ''}</textarea>
	</div>
	<div class="sm:col-span-3">
		<label class="label" for="dbt-{k}">Best time to visit</label>
		<input
			id="dbt-{k}"
			name="bestTimeSummary"
			value={d?.bestTimeSummary ?? ''}
			placeholder="June to October for the migration river crossings."
			class="input"
		/>
	</div>
	<div class="sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-3">
		<div>
			<label class="label" for="dh-{k}">Highlights</label>
			<textarea id="dh-{k}" name="highlights" rows="4" class="input" placeholder="One per line.">{(d?.highlights ?? []).join('\n')}</textarea>
		</div>
		<div>
			<label class="label" for="dtt-{k}">Travel tips</label>
			<textarea id="dtt-{k}" name="travelTips" rows="4" class="input" placeholder="One per line.">{(d?.travelTips ?? []).join('\n')}</textarea>
		</div>
	</div>
	<div>
		<label class="label" for="dst-{k}">SEO title</label>
		<input id="dst-{k}" name="seoTitle" value={d?.seoTitle ?? ''} class="input" />
	</div>
	<div class="sm:col-span-2">
		<label class="label" for="dsde-{k}">SEO description</label>
		<input id="dsde-{k}" name="seoDescription" value={d?.seoDescription ?? ''} class="input" />
	</div>
{/snippet}

<div class="space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-base font-semibold text-slate-800">Countries &amp; destinations</h1>
			<p class="mt-0.5 max-w-2xl text-[12.5px] leading-5 text-slate-500">
				The canonical places every listing points at. Operators choose from this list and cannot add to it — that is
				what stops Serengeti, Serengeti NP and Serengeti National Park becoming three rival pages chasing one search
				result.
			</p>
		</div>
		<button class="btn-primary" onclick={() => (newCountry = !newCountry)}>Add country</button>
	</div>

	{#if newCountry}
		<form method="POST" action="?/createCountry" use:enhance class="card grid gap-3 p-3 sm:grid-cols-3">
			<p class="text-sm font-semibold text-slate-700 sm:col-span-3">New country</p>
			{@render countryFields(null)}
			<div class="flex items-end gap-2 sm:col-span-3">
				<button class="btn-primary">Create country</button>
				<button type="button" class="btn-secondary" onclick={() => (newCountry = false)}>Cancel</button>
			</div>
			<p class="text-[12px] text-slate-400 sm:col-span-3">
				Add the hero photograph after the country exists — the image is filed under its id.
			</p>
		</form>
	{/if}

	{#each groups as g (g.country.id)}
		<section class="card">
			<div class="card-header flex-wrap gap-3">
				<div class="flex min-w-0 items-center gap-3">
					{#if g.country.hero}
						<img src={g.country.hero.url} alt={g.country.hero.altText ?? ''} class="size-10 shrink-0 rounded-panel object-cover" />
					{:else}
						<div class="flex size-10 shrink-0 items-center justify-center rounded-panel bg-slate-100 text-[11px] text-slate-400">
							No photo
						</div>
					{/if}
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate text-sm font-semibold text-slate-700">{g.country.name}</h2>
							{#if g.country.isoCode}<span class="badge bg-slate-100 text-slate-500">{g.country.isoCode}</span>{/if}
							<span class="badge {g.country.isActive ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-500'}">
								{g.country.isActive ? 'live' : 'hidden'}
							</span>
						</div>
						<p class="truncate font-mono text-[12px] text-slate-400">/countries/{g.country.slug}</p>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<span class="text-[12px] text-slate-400">
						{counted(g.places.length, 'destination')} · {counted(g.country.tourCount, 'tour')}
					</span>
					<button
						class="btn-secondary !px-2.5 !py-1.5 text-[12px]"
						onclick={() => (editCountry = editCountry === g.country.id ? null : g.country.id)}
					>
						{editCountry === g.country.id ? 'Close' : 'Edit'}
					</button>
					<form method="POST" action="?/setCountryActive" use:enhance>
						<input type="hidden" name="id" value={g.country.id} />
						<input type="hidden" name="isActive" value={g.country.isActive ? 'false' : 'true'} />
						<button class="btn-secondary !px-2.5 !py-1.5 text-[12px]">{g.country.isActive ? 'Deactivate' : 'Activate'}</button>
					</form>
					<button
						class="btn-secondary !px-2.5 !py-1.5 text-[12px]"
						onclick={() => (newDestination = newDestination === g.country.id ? null : g.country.id)}
					>
						Add destination
					</button>
					{#if g.country.destinationCount || g.country.tourCount}
						<!-- Not a disabled button: a control that cannot ever work here should say
						     why instead of sitting there greyed out waiting to be clicked. -->
						<span class="text-[12px] text-slate-400">In use — deactivate rather than delete</span>
					{:else}
						<form method="POST" action="?/deleteCountry" use:enhance>
							<input type="hidden" name="id" value={g.country.id} />
							<button class="btn-danger !px-2.5 !py-1.5 text-[12px]">Delete</button>
						</form>
					{/if}
				</div>
			</div>

			{#if editCountry === g.country.id}
				<div class="space-y-3 border-b border-slate-200 bg-slate-50/60 p-3">
					<form method="POST" action="?/updateCountry" use:enhance class="grid gap-3 sm:grid-cols-3">
						<input type="hidden" name="id" value={g.country.id} />
						{@render countryFields(g.country)}
						<div class="flex items-end gap-2 sm:col-span-3">
							<button class="btn-primary">Save country</button>
							<button type="button" class="btn-secondary" onclick={() => (editCountry = null)}>Cancel</button>
						</div>
					</form>
					{@render heroPanel('country', g.country.id, g.country.hero)}
				</div>
			{/if}

			{#if newDestination === g.country.id}
				<form method="POST" action="?/createDestination" use:enhance class="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-3">
					<p class="text-sm font-semibold text-slate-700 sm:col-span-3">New destination in {g.country.name}</p>
					{@render destinationFields(null, g.country.id)}
					<div class="flex items-end gap-2 sm:col-span-3">
						<button class="btn-primary">Create destination</button>
						<button type="button" class="btn-secondary" onclick={() => (newDestination = null)}>Cancel</button>
					</div>
					<p class="text-[12px] text-slate-400 sm:col-span-3">
						It starts as a draft. Publishing a place is a separate decision, taken from the row once it reads well.
					</p>
				</form>
			{/if}

			{#if g.places.length}
				<ul class="divide-y divide-slate-100">
					{#each g.places as d (d.id)}
						<li class="p-3">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div class="flex min-w-0 items-center gap-3">
									{#if d.hero}
										<img src={d.hero.url} alt={d.hero.altText ?? ''} class="size-9 shrink-0 rounded-panel object-cover" />
									{:else}
										<div class="size-9 shrink-0 rounded-panel bg-slate-100"></div>
									{/if}
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<span class="truncate text-sm font-medium text-slate-700">{d.name}</span>
											<span class="badge bg-slate-100 text-slate-500">{TYPE_LABELS[d.destinationType] ?? d.destinationType}</span>
											<span
												class="badge {d.status === 'PUBLISHED'
													? 'bg-success/10 text-success'
													: d.status === 'ARCHIVED'
														? 'bg-slate-100 text-slate-500'
														: 'bg-warning/15 text-[#b58514]'}"
											>
												{d.status.toLowerCase()}
											</span>
										</div>
										<p class="truncate font-mono text-[12px] text-slate-400">/destinations/{d.slug}</p>
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-2">
									<span class="text-[12px] text-slate-400">{counted(d.tourCount, 'tour')}</span>
									<button
										class="btn-secondary !px-2.5 !py-1.5 text-[12px]"
										onclick={() => (editDestination = editDestination === d.id ? null : d.id)}
									>
										{editDestination === d.id ? 'Close' : 'Edit'}
									</button>
									<form method="POST" action="?/setDestinationStatus" use:enhance class="inline-flex items-center gap-1">
										<input type="hidden" name="id" value={d.id} />
										<select name="status" class="input w-auto py-1 text-[12px]">
											{#each data.statuses as s (s)}<option value={s} selected={d.status === s}>{s}</option>{/each}
										</select>
										<button class="text-[12px] font-medium text-brand-600 hover:underline">Set</button>
									</form>
									{#if d.tourCount || d.itineraryCount}
										<span class="text-[12px] text-slate-400">In use — archive rather than delete</span>
									{:else}
										<form method="POST" action="?/deleteDestination" use:enhance>
											<input type="hidden" name="id" value={d.id} />
											<button class="btn-danger !px-2.5 !py-1.5 text-[12px]">Delete</button>
										</form>
									{/if}
								</div>
							</div>

							{#if editDestination === d.id}
								<div class="mt-3 space-y-3 rounded-panel bg-slate-50/60 p-3">
									<form method="POST" action="?/updateDestination" use:enhance class="grid gap-3 sm:grid-cols-3">
										<input type="hidden" name="id" value={d.id} />
										{@render destinationFields(d, d.countryId)}
										<div class="flex items-end gap-2 sm:col-span-3">
											<button class="btn-primary">Save destination</button>
											<button type="button" class="btn-secondary" onclick={() => (editDestination = null)}>Cancel</button>
										</div>
									</form>
									{@render heroPanel('destination', d.id, d.hero)}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="px-4 py-6 text-center text-[12.5px] text-slate-400">
					No destinations in {g.country.name} yet. Until one exists, no operator can say their tour goes there.
				</p>
			{/if}
		</section>
	{/each}

	{#if !data.countries.length}
		<div class="card px-3 py-10 text-center">
			<p class="text-sm font-medium text-slate-700">No countries yet</p>
			<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
				A listing has to sit in a country, so this is the first row the marketplace needs. Add one, then the
				destinations inside it.
			</p>
			<button class="btn-primary mt-4" onclick={() => (newCountry = true)}>Add country</button>
		</div>
	{/if}
</div>
