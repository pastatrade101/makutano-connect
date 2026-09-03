<script lang="ts">
	// The fleet list. Deliberately a registry, not a dashboard: an operator comes
	// here to add a vehicle, map a tracker, or check one is still on the books.
	//
	// It reads as CARDS rather than table rows because the useful facts about a
	// vehicle are not one line long — where it is, how fast, which trip it is on,
	// which device reports it — and a row squeezes all of that into a right-hand
	// margin where none of it can be read at a glance.
	import { enhance } from '$app/forms';
	import EmptyState from '$components/EmptyState.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	let adding = $state(false);
	let editing = $state<string | null>(null);
	let configuring = $state<string | null>(null);

	// Colour carries the same meaning here as on the trip card.
	const TONE: Record<string, string> = {
		LIVE: 'bg-success/10 text-success ring-success/20',
		RECENT: 'bg-success/10 text-success ring-success/20',
		STALE: 'bg-warning/10 text-warning ring-warning/20',
		OFFLINE: 'bg-slate-100 text-slate-500 ring-slate-200',
		NOT_CONFIGURED: 'bg-slate-100 text-slate-500 ring-slate-200',
		UNAVAILABLE: 'bg-warning/10 text-warning ring-warning/20'
	};

	// A vehicle sitting still and a vehicle driving are different facts, and an
	// operator reads them differently. Below walking pace is parked.
	const MOVING_KPH = 3;

	const summary = $derived({
		total: data.vehicles.length,
		live: data.vehicles.filter((v) => v.trackingState === 'LIVE' || v.trackingState === 'RECENT').length,
		onTrip: data.vehicles.filter((v) => v.assignment).length,
		untracked: data.vehicles.filter((v) => !v.tracked).length
	});
</script>

<svelte:head><title>Vehicles · Makutano Connect</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold text-slate-900">Vehicles</h1>
			<p class="mt-0.5 text-xs text-slate-500">
				The vehicles you run, and the tracker mapped to each. Assign one to a trip from the trip itself.
			</p>
		</div>
		{#if data.canWrite}
			<button class="btn-primary" onclick={() => (adding = !adding)}>{adding ? 'Cancel' : 'Add vehicle'}</button>
		{/if}
	</div>

	{#if data.vehicles.length}
		<!-- Four counts, not a chart. This is the whole fleet answered in one line. -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each [
				{ label: 'Vehicles', value: summary.total, tone: 'text-slate-900' },
				{ label: 'Reporting now', value: summary.live, tone: summary.live ? 'text-success' : 'text-slate-400' },
				{ label: 'On a trip', value: summary.onTrip, tone: summary.onTrip ? 'text-slate-900' : 'text-slate-400' },
				{ label: 'No tracker', value: summary.untracked, tone: summary.untracked ? 'text-warning' : 'text-slate-400' }
			] as s (s.label)}
				<div class="card p-3">
					<p class="text-[11px] uppercase tracking-wide text-slate-400">{s.label}</p>
					<p class="mt-1 text-2xl font-semibold tabular-nums {s.tone}">{s.value}</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if form?.message}
		<p class="rounded-panel border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{form.message}</p>
	{/if}

	{#if adding}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); adding = false; }} class="card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
			<div class="sm:col-span-3 lg:col-span-2"><label class="label" for="name">Name you would recognise</label>
				<input id="name" name="name" required placeholder="Land Cruiser 3" class="input" /></div>
			<div><label class="label" for="registration">Registration</label><input id="registration" name="registration" placeholder="T 123 ABC" class="input" /></div>
			<div><label class="label" for="make">Make</label><input id="make" name="make" placeholder="Toyota" class="input" /></div>
			<div><label class="label" for="model">Model</label><input id="model" name="model" placeholder="Land Cruiser" class="input" /></div>
			<div><label class="label" for="seats">Seats</label><input id="seats" name="seats" type="number" min="1" max="99" class="input" /></div>
			<div class="sm:col-span-3 lg:col-span-5"><button class="btn-primary">Add vehicle</button></div>
		</form>
	{/if}

	{#if data.vehicles.length}
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each data.vehicles as v (v.id)}
				{@const open = configuring === v.id || editing === v.id}
				<div class="card flex flex-col p-4 {v.isActive ? '' : 'opacity-60'} {open ? 'md:col-span-2 xl:col-span-3' : ''}">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-base font-semibold text-slate-900">{v.name}</p>
							<p class="mt-0.5 text-xs text-slate-500">
								{[v.make, v.model].filter(Boolean).join(' ') || 'Make and model not set'}
							</p>
						</div>
						<span class="badge shrink-0 ring-1 {TONE[v.trackingState]}">{v.trackingLabel}</span>
					</div>

					<!-- The facts an operator actually looks for, each labelled, so none of
					     them has to be inferred from position on a line. -->
					<dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs">
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Registration</dt>
							<dd class="mt-0.5 font-mono text-slate-700">{v.registration || '—'}</dd>
						</div>
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Seats</dt>
							<dd class="mt-0.5 text-slate-700">{v.seats ?? '—'}</dd>
						</div>
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Last reported</dt>
							<dd class="mt-0.5 text-slate-700">
								{#if v.lastFixAt}<TimeAgo value={v.lastFixAt} />{:else}Never{/if}
							</dd>
						</div>
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Movement</dt>
							<dd class="mt-0.5 text-slate-700">
								{#if v.speedKph == null}
									—
								{:else if v.speedKph >= MOVING_KPH}
									<span class="font-medium text-slate-900 tabular-nums">{Math.round(v.speedKph)} km/h</span>
								{:else}
									Parked
								{/if}
							</dd>
						</div>
						<div class="col-span-2">
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Current trip</dt>
							<dd class="mt-0.5">
								{#if v.assignment}
									<a href="/app/trips/{v.assignment.tripId}" class="font-medium text-brand-600 hover:underline">
										{v.assignment.reference}
									</a>
								{:else}
									<span class="text-slate-500">Not assigned</span>
								{/if}
							</dd>
						</div>
						<div class="col-span-2">
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Tracking device</dt>
							<dd class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
								{#if v.tracked}
									<span class="font-mono text-slate-700">{v.trackerDeviceRef}</span>
									{#if v.latitude != null && v.longitude != null}
										<!-- Coordinates are the one detail that proves the tracker is
										     really reporting, rather than merely mapped. -->
										<span class="font-mono text-[11px] text-slate-400 tabular-nums">
											{v.latitude.toFixed(4)}, {v.longitude.toFixed(4)}
										</span>
									{/if}
								{:else}
									<span class="text-slate-500">No device mapped</span>
								{/if}
							</dd>
						</div>
					</dl>

					<div class="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
						{#if !v.isActive}<span class="badge bg-slate-100 text-slate-500">Inactive</span>{/if}
						{#if v.assignment}
							<a href="/app/trips/{v.assignment.tripId}" class="text-xs font-medium text-brand-600 hover:underline">Open trip</a>
						{/if}
						{#if data.canWrite}
							<div class="ml-auto flex gap-3">
								<button type="button" class="text-xs font-medium text-brand-600 hover:underline" onclick={() => { configuring = configuring === v.id ? null : v.id; editing = null; }}>
									{v.tracked ? 'Tracking' : 'Add tracker'}
								</button>
								<button type="button" class="text-xs text-slate-500 hover:underline" onclick={() => { editing = editing === v.id ? null : v.id; configuring = null; }}>Edit</button>
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
						<form method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update(); editing = null; }} class="mt-3 grid gap-3 rounded-panel bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
							<input type="hidden" name="id" value={v.id} />
							<div><label class="label" for="n-{v.id}">Name</label><input id="n-{v.id}" name="name" value={v.name} required class="input" /></div>
							<div><label class="label" for="r-{v.id}">Registration</label><input id="r-{v.id}" name="registration" value={v.registration ?? ''} class="input" /></div>
							<div><label class="label" for="mk-{v.id}">Make</label><input id="mk-{v.id}" name="make" value={v.make ?? ''} class="input" /></div>
							<div><label class="label" for="md-{v.id}">Model</label><input id="md-{v.id}" name="model" value={v.model ?? ''} class="input" /></div>
							<div class="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
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
			{/each}
		</div>
	{:else}
		<div class="card">
			<EmptyState
				title="No vehicles yet"
				description="Add the vehicles you run so a trip can name one, and so you can see where it is."
			/>
		</div>
	{/if}
</div>
