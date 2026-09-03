<script lang="ts">
	// The fleet list. Deliberately a registry, not a dashboard: an operator comes
	// here to add a vehicle, map a tracker, or check one is still on the books.
	import { enhance } from '$app/forms';
	import EmptyState from '$components/EmptyState.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	let adding = $state(false);
	let editing = $state<string | null>(null);
	let configuring = $state<string | null>(null);

	// Colour carries the same meaning here as on the trip card.
	const TONE: Record<string, string> = {
		LIVE: 'text-success',
		RECENT: 'text-success',
		STALE: 'text-warning',
		OFFLINE: 'text-slate-400',
		NOT_CONFIGURED: 'text-slate-400',
		UNAVAILABLE: 'text-warning'
	};
</script>

<svelte:head><title>Vehicles · Makutano Connect</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-3">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-base font-semibold text-slate-900">Vehicles</h1>
			<p class="mt-0.5 text-xs text-slate-500">
				The vehicles you run, and the tracker mapped to each. Assign one to a trip from the trip itself.
			</p>
		</div>
		{#if data.canWrite}
			<button class="btn-primary" onclick={() => (adding = !adding)}>{adding ? 'Cancel' : 'Add vehicle'}</button>
		{/if}
	</div>

	{#if form?.message}
		<p class="rounded-panel border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{form.message}</p>
	{/if}

	{#if adding}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); adding = false; }} class="card grid gap-3 p-3 sm:grid-cols-3">
			<div class="sm:col-span-3"><label class="label" for="name">Name you would recognise</label>
				<input id="name" name="name" required placeholder="Land Cruiser 3" class="input" /></div>
			<div><label class="label" for="registration">Registration</label><input id="registration" name="registration" placeholder="T 123 ABC" class="input" /></div>
			<div><label class="label" for="make">Make</label><input id="make" name="make" placeholder="Toyota" class="input" /></div>
			<div><label class="label" for="model">Model</label><input id="model" name="model" placeholder="Land Cruiser" class="input" /></div>
			<div><label class="label" for="seats">Seats</label><input id="seats" name="seats" type="number" min="1" max="99" class="input" /></div>
			<div class="sm:col-span-3"><button class="btn-primary">Add vehicle</button></div>
		</form>
	{/if}

	<div class="card divide-y divide-slate-100">
		{#each data.vehicles as v (v.id)}
			<div class="p-3 {v.isActive ? '' : 'opacity-60'}">
				<div class="flex flex-wrap items-start gap-3">
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium text-slate-900">
							{v.name}
							{#if v.registration}<span class="ml-1.5 font-mono text-xs text-slate-500">{v.registration}</span>{/if}
							{#if !v.isActive}<span class="badge ml-1.5 bg-slate-100 text-slate-500">Inactive</span>{/if}
						</p>
						<p class="mt-0.5 text-[11.5px] text-slate-500">
							{[v.make, v.model].filter(Boolean).join(' ') || '—'}{#if v.seats} · {v.seats} seats{/if}
							{#if v.assignment}
								· <a href="/app/trips/{v.assignment.tripId}" class="text-brand-600 hover:underline">On trip {v.assignment.reference}</a>
							{/if}
						</p>
					</div>

					<div class="text-right">
						<p class="text-xs font-medium {TONE[v.trackingState]}">{v.trackingLabel}</p>
						{#if v.tracked && v.lastFixAt}
							<p class="text-[11.5px] text-slate-400"><TimeAgo value={v.lastFixAt} /></p>
						{:else if !v.tracked}
							<p class="text-[11.5px] text-slate-400">no device mapped</p>
						{/if}
					</div>

					{#if data.canWrite}
						<div class="flex shrink-0 gap-2">
							<button type="button" class="text-xs text-brand-600 hover:underline" onclick={() => (configuring = configuring === v.id ? null : v.id)}>Tracking</button>
							<button type="button" class="text-xs text-slate-500 hover:underline" onclick={() => (editing = editing === v.id ? null : v.id)}>Edit</button>
						</div>
					{/if}
				</div>

				{#if configuring === v.id}
					<form method="POST" action="?/tracker" use:enhance={() => async ({ update }) => { await update(); configuring = null; }} class="mt-3 rounded-panel bg-slate-50 p-3">
						<input type="hidden" name="id" value={v.id} />
						<label class="label" for="deviceRef-{v.id}">Tracking device ID</label>
						<div class="flex flex-wrap gap-2">
							<input id="deviceRef-{v.id}" name="deviceRef" value={v.trackerDeviceRef ?? ''} placeholder="The identifier from your GPS device" class="input flex-1" />
							<button class="btn-secondary">Save</button>
						</div>
						<!-- Vendor-neutral on purpose: the operator maps an identifier, and which
						     tracking platform is behind it is not their problem. -->
						<p class="mt-1.5 text-[11.5px] text-slate-400">
							Leave empty to remove tracking. Each device can belong to only one vehicle.
							{#if !data.trackingEnabled}Tracking is not switched on for this workspace yet.{/if}
						</p>
					</form>
				{/if}

				{#if editing === v.id}
					<form method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update(); editing = null; }} class="mt-3 grid gap-3 rounded-panel bg-slate-50 p-3 sm:grid-cols-4">
						<input type="hidden" name="id" value={v.id} />
						<div><label class="label" for="n-{v.id}">Name</label><input id="n-{v.id}" name="name" value={v.name} required class="input" /></div>
						<div><label class="label" for="r-{v.id}">Registration</label><input id="r-{v.id}" name="registration" value={v.registration ?? ''} class="input" /></div>
						<div><label class="label" for="mk-{v.id}">Make</label><input id="mk-{v.id}" name="make" value={v.make ?? ''} class="input" /></div>
						<div><label class="label" for="md-{v.id}">Model</label><input id="md-{v.id}" name="model" value={v.model ?? ''} class="input" /></div>
						<div class="sm:col-span-4 flex items-center gap-2">
							<button class="btn-primary !py-1.5 text-xs">Save</button>
						</div>
					</form>
					<form method="POST" action="?/setActive" use:enhance class="mt-2">
						<input type="hidden" name="id" value={v.id} />
						<input type="hidden" name="active" value={v.isActive ? 'false' : 'true'} />
						<!-- Deactivate, never delete: a trip that ran last year still names it. -->
						<button class="text-[11.5px] text-slate-500 hover:underline">
							{v.isActive ? 'Deactivate this vehicle' : 'Reactivate this vehicle'}
						</button>
					</form>
				{/if}
			</div>
		{:else}
			<EmptyState
				title="No vehicles yet"
				description="Add the vehicles you run so a trip can name one, and so you can see where it is."
			/>
		{/each}
	</div>
</div>
