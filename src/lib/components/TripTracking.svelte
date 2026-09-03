<script lang="ts">
	/*
	 * The tracking card on a trip.
	 *
	 * Polls ONLY while it is on screen and only while the tab is visible, at a
	 * conservative interval. There is no global tracker anywhere in the app: a
	 * dashboard that quietly polls a GPS server for every operator, forever, is how
	 * a third party ends up rate-limiting the product.
	 *
	 * Every failure lands as a state, never an exception. The trip page must remain
	 * completely usable when tracking is not.
	 */
	import { onMount } from 'svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import TrackingMap from '$components/TrackingMap.svelte';

	let { tripId, vehicleLabel = null }: { tripId: string; vehicleLabel?: string | null } = $props();

	const POLL_MS = 25_000;

	type Position = { latitude: number; longitude: number; speedKph: number | null; recordedAt: string };
	let trackState = $state<string>('NOT_CONFIGURED');
	let position = $state<Position | null>(null);
	let message = $state<string | null>(null);
	let track = $state<{ latitude: number; longitude: number }[]>([]);
	let showMap = $state(false);
	let loading = $state(true);

	/*
	 * One phrase per state, and they are mutually exclusive.
	 *
	 * This card used to print the state label AND the server's message, which
	 * could read "Tracking temporarily unavailable" above "Tracking is not
	 * configured on this deployment" — an outage and a missing feature claimed at
	 * once. The states now mean different things and each says one thing.
	 */
	const LABEL: Record<string, string> = {
		NOT_CONFIGURED: 'Tracking not configured',
		LIVE: 'Live',
		RECENT: 'Recently updated',
		STALE: 'Last position is stale',
		OFFLINE: 'Tracker offline',
		UNAVAILABLE: 'Tracking temporarily unavailable'
	};
	const TONE: Record<string, string> = {
		LIVE: 'text-success',
		RECENT: 'text-success',
		STALE: 'text-warning',
		OFFLINE: 'text-slate-400',
		NOT_CONFIGURED: 'text-slate-400',
		UNAVAILABLE: 'text-warning'
	};

	async function refresh(withHistory = false) {
		try {
			const res = await fetch(`/app/trips/${tripId}/tracking${withHistory ? '?history=1' : ''}`);
			if (!res.ok) throw new Error('unreachable');
			const body = await res.json();
			trackState = body.data.state;
			position = body.data.position;
			message = body.data.message;
			if (body.data.history) track = body.data.history.positions;
		} catch {
			// A failed poll says nothing about the vehicle, only about the request.
			trackState = 'UNAVAILABLE';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		refresh();
		const tick = () => {
			// Nothing to gain from polling a hidden tab, and a laptop full of them
			// would be a lot of requests for a screen nobody is reading.
			if (document.visibilityState === 'visible') refresh(showMap);
		};
		const timer = setInterval(tick, POLL_MS);
		return () => clearInterval(timer);
	});

	async function openMap() {
		showMap = true;
		await refresh(true);
	}
</script>

<div class="card p-3">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div>
			<p class="text-xs font-semibold text-slate-700">Vehicle</p>
			<p class="mt-0.5 text-sm text-slate-900">{vehicleLabel ?? 'No vehicle assigned'}</p>
		</div>
		<div class="text-right">
			<p class="text-xs font-medium {TONE[trackState] ?? 'text-slate-400'}">
				{#if trackState === 'LIVE'}<span aria-hidden="true">●</span> {/if}{LABEL[trackState] ?? trackState}
			</p>
			{#if position}
				<p class="text-[11.5px] text-slate-400">
					<TimeAgo value={position.recordedAt} />
					{#if position.speedKph !== null && position.speedKph > 0} · {position.speedKph} km/h{/if}
				</p>
			{/if}
		</div>
	</div>

	{#if loading}
		<p class="mt-2 text-[11.5px] text-slate-400">Checking…</p>
	{:else if trackState === 'NOT_CONFIGURED'}
		<!-- Not an outage, so not warning colour: nothing is broken and nobody needs
		     to go looking for a fault. -->
		<p class="mt-2 text-[11.5px] text-slate-400">
			{vehicleLabel ? 'No live location for this vehicle yet.' : 'Assign a vehicle to see where it is.'}
		</p>
	{:else if trackState === 'UNAVAILABLE'}
		<!-- A real request really failed. Says so without implying anything about
		     where the vehicle is, and never repeats the label above it. -->
		<p class="mt-2 text-[11.5px] text-warning">The rest of this trip is unaffected.</p>
	{:else if position}
		{#if showMap}
			<div class="mt-3">
				<TrackingMap latitude={position.latitude} longitude={position.longitude} label={vehicleLabel ?? 'Vehicle'} {track} />
				<p class="mt-1 text-[11.5px] text-slate-400">
					Last known position{track.length > 1 ? ` · ${track.length} points from the last 24 hours` : ''}
				</p>
			</div>
		{:else}
			<button class="btn-secondary mt-3 !py-1.5 text-xs" onclick={openMap}>View live map</button>
		{/if}
	{/if}
</div>
