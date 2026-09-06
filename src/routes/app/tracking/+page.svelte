<script lang="ts">
	/*
	 * Fleet tracking. The map IS the page, and the page has two modes.
	 *
	 *   LIVE           every vehicle the tenant owns, drawn where it last reported,
	 *                  refreshed by ONE fleet poll every 25 s while the tab is visible.
	 *   ROUTE HISTORY  one vehicle's recorded fixes for a bounded range, fetched
	 *                  ONCE and replayed entirely in the browser.
	 *
	 * Everything on this screen comes from the server's own state words. Nothing
	 * here decides whether a fix is "live" from its age — that rule lives in one
	 * place on the server and the client only presents it. A provider fault is
	 * presented as a fault, never as a quiet vehicle.
	 *
	 * Leaflet and its CSS load inside onMount so the library only ships to
	 * somebody actually looking at a vehicle.
	 */
	import { onMount, onDestroy } from 'svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import {
		clampIndex,
		cumulativeMetres,
		formatKm,
		hoursForPreset,
		replayDelayMs,
		REPLAY_SPEEDS,
		step,
		truncationNotice,
		type Fix,
		type HistoryPreset,
		type ReplaySpeed
	} from '$lib/tracking/replay';
	import {
		fleetOrder,
		hasPosition,
		isProviderFault,
		MARKER_HEX,
		movement,
		STATE_BADGE,
		STATE_TONE,
		TONE_DOT,
		TONE_TEXT
	} from '$lib/tracking/presentation';
	import type { TrackingState } from '$lib/server/tracking/types';

	let { data } = $props();
	type Row = (typeof data.vehicles)[number];

	/* ------------------------------------------------------------ live state */
	let vehicles = $state<Row[]>(data.vehicles);
	let selectedId = $state<string | null>(data.selectedId);
	let checkedAt = $state<string>(data.checkedAt);
	let search = $state('');
	let mode = $state<'live' | 'history'>('live');
	let listOpen = $state(true);
	let sheetOpen = $state(false); // the selected-vehicle panel on a phone
	let fullscreen = $state(false);

	const selected = $derived(vehicles.find((v) => v.id === selectedId) ?? null);
	const ordered = $derived(fleetOrder(vehicles));
	const filtered = $derived(
		ordered.filter((v) =>
			[v.name, v.registration, v.make, v.model].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())
		)
	);
	const reporting = $derived(vehicles.filter((v) => v.state === 'LIVE' || v.state === 'RECENT').length);
	const faulted = $derived(vehicles.some((v) => isProviderFault(v.state as TrackingState)));

	const toneOf = (state: string) => STATE_TONE[state as TrackingState] ?? 'muted';
	const textOf = (state: string) => TONE_TEXT[toneOf(state)];
	const dotOf = (state: string) => TONE_DOT[toneOf(state)];
	const badgeOf = (state: string) => STATE_BADGE[state as TrackingState] ?? state;

	/* --------------------------------------------------------- history state */
	let preset = $state<HistoryPreset>('today');
	let customHours = $state(12);
	let fixes = $state<Fix[]>([]);
	let cum = $state<number[]>([]);
	let historyMeta = $state<{ hours: number; truncated: boolean; limit: number | null }>({ hours: 0, truncated: false, limit: null });
	let historyStatus = $state<'idle' | 'loading' | 'ready' | 'empty' | 'failed'>('idle');
	let replayIndex = $state(-1);
	let playing = $state(false);
	let speed = $state<ReplaySpeed>(1);
	let replayTimer: ReturnType<typeof setTimeout> | null = null;

	const current = $derived(replayIndex >= 0 && replayIndex < fixes.length ? fixes[replayIndex] : null);
	const travelled = $derived(replayIndex >= 0 && cum.length ? cum[replayIndex] : 0);
	const routeLength = $derived(cum.length ? cum[cum.length - 1] : 0);

	/* ---------------------------------------------------------------- map */
	let el = $state<HTMLDivElement | null>(null);
	let map: import('leaflet').Map | null = null;
	let L: typeof import('leaflet') | null = null;
	let tiles: import('leaflet').TileLayer | null = null;
	const markers = new Map<string, import('leaflet').CircleMarker>();
	let line: import('leaflet').Polyline | null = null;
	let startDot: import('leaflet').CircleMarker | null = null;
	let endDot: import('leaflet').CircleMarker | null = null;
	let replayDot: import('leaflet').CircleMarker | null = null;
	let poll: ReturnType<typeof setInterval> | null = null;
	let onVisible: (() => void) | null = null;

	const LAYERS = [
		{ key: 'standard', label: 'Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
		{ key: 'satellite', label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attribution: 'Imagery &copy; Esri' },
		{ key: 'terrain', label: 'Terrain', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)' }
	] as const;
	let layer = $state<(typeof LAYERS)[number]['key']>('standard');
	let mapFailed = $state(false);

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const leaflet = (await import('leaflet')).default;
				await import('leaflet/dist/leaflet.css');
				if (cancelled || !el) return;
				L = leaflet;
				map = leaflet.map(el, { zoomControl: false, attributionControl: true }).setView([-6.4, 34.9], 6);
				applyLayer();
				drawFleet();
				frameFleet();
			} catch {
				mapFailed = true;
			}
		})();

		// Only while the operator is looking. A hidden tab polls nothing, and
		// coming back refreshes at once rather than waiting out the interval.
		poll = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, 25000);
		onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			cancelled = true;
			map?.remove();
			map = null;
		};
	});

	onDestroy(() => {
		if (poll) clearInterval(poll);
		if (onVisible) document.removeEventListener('visibilitychange', onVisible);
		stopReplay();
	});

	function applyLayer() {
		if (!map || !L) return;
		const choice = LAYERS.find((l) => l.key === layer) ?? LAYERS[0];
		tiles?.remove();
		tiles = L.tileLayer(choice.url, { maxZoom: choice.maxZoom, attribution: choice.attribution }).addTo(map);
		if (map.getZoom() > choice.maxZoom) map.setZoom(choice.maxZoom);
	}

	/**
	 * One pin per vehicle that has a position, coloured by the server's state and
	 * sized by selection. Pins are UPDATED in place: rebuilding them every poll
	 * would make the map flicker and lose the operator's tooltip.
	 */
	function drawFleet() {
		if (!map || !L) return;
		const seen = new Set<string>();
		for (const v of vehicles) {
			if (!hasPosition(v)) continue;
			seen.add(v.id);
			const isSel = v.id === selectedId;
			const colour = MARKER_HEX[toneOf(v.state)];
			const style = { radius: isSel ? 10 : 7, weight: isSel ? 4 : 3, color: '#ffffff', fillColor: colour, fillOpacity: 0.95, opacity: 1 };
			const at: [number, number] = [v.latitude as number, v.longitude as number];
			let m = markers.get(v.id);
			if (!m) {
				m = L.circleMarker(at, style).addTo(map);
				m.on('click', () => select(v.id, false));
				markers.set(v.id, m);
			} else {
				m.setLatLng(at);
				m.setStyle(style);
			}
			m.unbindTooltip();
			m.bindTooltip(`${v.name} · ${badgeOf(v.state)}`, { direction: 'top', offset: [0, -8] });
			if (isSel) m.bringToFront();
		}
		// A vehicle that lost its position is removed, not left at its old spot.
		for (const [id, m] of markers) {
			if (!seen.has(id)) {
				m.remove();
				markers.delete(id);
			}
		}
	}

	/** Frame everything that has a position; one vehicle gets a close view. */
	function frameFleet() {
		if (!map || !L) return;
		const pts = vehicles.filter(hasPosition).map((v) => [v.latitude as number, v.longitude as number] as [number, number]);
		if (pts.length === 0) return;
		if (pts.length === 1) map.setView(pts[0], 13);
		else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
	}

	async function refresh() {
		const res = await fetch('/app/tracking/positions').catch(() => null);
		if (!res?.ok) return;
		const body = await res.json();
		checkedAt = body.data.checkedAt;
		const byId = new Map<string, Row>(body.data.vehicles.map((v: Row) => [v.id, v]));
		// Merge, never replace: the poll carries live fields only; the trip and
		// registration came from the page load.
		vehicles = vehicles.map((v) => ({ ...v, ...(byId.get(v.id) ?? {}) }));
		drawFleet();
	}

	function select(id: string, recenter = true) {
		selectedId = id;
		sheetOpen = true;
		drawFleet();
		if (recenter) recentre();
		if (mode === 'history') loadHistory();
	}

	function recentre() {
		const v = selected;
		if (!map) return;
		if (mode === 'history' && line) {
			map.fitBounds(line.getBounds(), { padding: [40, 40] });
			return;
		}
		if (v && hasPosition(v)) map.setView([v.latitude as number, v.longitude as number], Math.max(map.getZoom(), 13));
	}

	/* --------------------------------------------------------------- modes */
	function enterHistory() {
		mode = 'history';
		loadHistory();
	}

	function enterLive() {
		mode = 'live';
		stopReplay();
		clearRoute();
		historyStatus = 'idle';
		fixes = [];
		cum = [];
		replayIndex = -1;
	}

	function choosePreset(p: HistoryPreset) {
		preset = p;
		loadHistory();
	}

	/**
	 * ONE request per range. Scrubbing, stepping and playing never come back
	 * here — they move an index over the array this fills.
	 */
	async function loadHistory() {
		if (!selectedId) return;
		stopReplay();
		historyStatus = 'loading';
		const hours = hoursForPreset(preset, new Date(), customHours);
		const res = await fetch(`/app/tracking/history?vehicle=${selectedId}&hours=${hours}`).catch(() => null);
		if (!res?.ok) {
			fixes = [];
			cum = [];
			replayIndex = -1;
			historyStatus = 'failed';
			clearRoute();
			return;
		}
		const body = await res.json();
		const points: Fix[] = body.data.points ?? [];
		fixes = points;
		cum = cumulativeMetres(points);
		historyMeta = { hours: body.data.hours ?? hours, truncated: Boolean(body.data.truncated), limit: body.data.limit ?? null };
		replayIndex = points.length ? points.length - 1 : -1;
		historyStatus = points.length ? 'ready' : 'empty';
		drawRoute();
		if (map && line) map.fitBounds(line.getBounds(), { padding: [40, 40] });
	}

	function clearRoute() {
		line?.remove();
		startDot?.remove();
		endDot?.remove();
		replayDot?.remove();
		line = startDot = endDot = replayDot = null;
	}

	/** The route exactly as recorded: straight legs between real fixes, start, end, and the fix being looked at. */
	function drawRoute() {
		if (!map || !L) return;
		clearRoute();
		if (fixes.length < 1) return;
		const colour = MARKER_HEX[toneOf(selected?.state ?? 'OFFLINE')];
		if (fixes.length > 1) {
			line = L.polyline(fixes.map((p) => [p[0], p[1]] as [number, number]), { weight: 4, opacity: 0.7, color: colour }).addTo(map);
		}
		startDot = L.circleMarker([fixes[0][0], fixes[0][1]], { radius: 6, weight: 3, color: '#64748b', fillColor: '#ffffff', fillOpacity: 1 })
			.addTo(map)
			.bindTooltip('Start of this range', { direction: 'top' });
		const last = fixes[fixes.length - 1];
		endDot = L.circleMarker([last[0], last[1]], { radius: 6, weight: 3, color: colour, fillColor: '#ffffff', fillOpacity: 1 })
			.addTo(map)
			.bindTooltip('Last recorded fix', { direction: 'top' });
		replayDot = L.circleMarker([last[0], last[1]], { radius: 9, weight: 4, color: '#ffffff', fillColor: colour, fillOpacity: 1 }).addTo(map);
		placeReplayDot();
	}

	function placeReplayDot() {
		if (!replayDot || !current) return;
		replayDot.setLatLng([current[0], current[1]]);
	}

	/* --------------------------------------------------------------- replay */
	function seek(i: number) {
		replayIndex = clampIndex(i, fixes.length);
		placeReplayDot();
	}
	function stepReplay(by: 1 | -1) {
		pause();
		seek(step(replayIndex, fixes.length, by));
	}
	function play() {
		if (fixes.length < 2) return;
		// Play from the start when parked at the end, the way a video does.
		if (replayIndex >= fixes.length - 1) seek(0);
		playing = true;
		tick();
	}
	function tick() {
		if (!playing) return;
		const delay = replayDelayMs(fixes, replayIndex, speed);
		if (delay === 0) {
			playing = false;
			return;
		}
		replayTimer = setTimeout(() => {
			if (!playing) return;
			seek(replayIndex + 1);
			tick();
		}, delay);
	}
	function pause() {
		playing = false;
		if (replayTimer) clearTimeout(replayTimer);
		replayTimer = null;
	}
	function stopReplay() {
		pause();
	}
	function setSpeed(s: ReplaySpeed) {
		speed = s;
		if (playing) {
			pause();
			playing = true;
			tick();
		}
	}

	$effect(() => {
		void layer;
		if (map) applyLayer();
	});
	// Leaflet measures its container on creation; layout toggles change it.
	$effect(() => {
		void fullscreen;
		void listOpen;
		void sheetOpen;
		if (map) setTimeout(() => map?.invalidateSize(), 210);
	});

	const fmtTime = (ms: number) =>
		new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<svelte:head><title>Live map · Makutano Connect</title></svelte:head>

<div class="flex flex-col gap-3 {fullscreen ? 'fixed inset-0 z-50 bg-white p-3' : ''}">
	<!-- Title row: what mode we are in, and how the fleet is doing in one line. -->
	{#if !fullscreen}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="min-w-0">
				<h1 class="text-lg font-semibold text-slate-900">Live map</h1>
				<p class="mt-0.5 text-xs text-slate-500">
					{#if !data.trackingEnabled}
						Tracking is not set up on this deployment.
					{:else if vehicles.length === 0}
						No vehicles yet.
					{:else}
						{reporting} of {vehicles.length} reporting
						{#if faulted}<span class="text-warning"> · tracking service temporarily unavailable</span>{/if}
						· checked <TimeAgo value={checkedAt} />
					{/if}
				</p>
			</div>
			<div class="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-medium shadow-sm" role="tablist" aria-label="Map mode">
				<button type="button" role="tab" aria-selected={mode === 'live'} onclick={enterLive} class="px-3 py-1.5 transition {mode === 'live' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}">Live</button>
				<button type="button" role="tab" aria-selected={mode === 'history'} onclick={enterHistory} disabled={!selected} class="px-3 py-1.5 transition disabled:opacity-40 {mode === 'history' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}">Route history</button>
			</div>
		</div>
	{/if}

	<div
		class="flex overflow-hidden rounded-panel border border-slate-200 bg-white"
		style="height: {fullscreen ? 'calc(100vh - 24px)' : 'calc(100vh - 190px)'}; min-height: 480px;">
		<!-- Fleet list: desktop sidebar. On a phone it becomes a chip strip over the map. -->
		{#if listOpen}
			<aside class="hidden w-[300px] shrink-0 flex-col border-r border-slate-200 lg:flex">
				<div class="border-b border-slate-100 p-3">
					<input bind:value={search} placeholder="Search vehicles…" class="input" aria-label="Search vehicles" />
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					{#if vehicles.length === 0}
						<p class="p-4 text-xs text-slate-500">No vehicles yet. Add one under Vehicles, then set up its tracker.</p>
					{:else}
						{#each filtered as v (v.id)}
							<button
								type="button"
								onclick={() => select(v.id)}
								aria-current={selectedId === v.id ? 'true' : undefined}
								class="flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-3 text-left transition hover:bg-slate-50 {selectedId === v.id ? 'bg-brand-50/60' : ''}">
								<span class="mt-1.5 size-2.5 shrink-0 rounded-full {dotOf(v.state)}"></span>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline justify-between gap-2">
										<span class="truncate text-sm font-medium text-slate-900">{v.name}</span>
										<span class="shrink-0 text-[10.5px] font-semibold tracking-wide {textOf(v.state)}">{badgeOf(v.state)}</span>
									</span>
									{#if v.registration}<span class="block truncate font-mono text-[11.5px] text-slate-500">{v.registration}</span>{/if}
									<span class="mt-0.5 block truncate text-[11.5px] text-slate-500">
										{#if v.recordedAt}GPS <TimeAgo value={v.recordedAt} />{:else if v.tracked}No GPS fix yet{:else}Not set up{/if}
										{#if v.trip} · {v.trip.title || v.trip.reference}{/if}
									</span>
								</span>
							</button>
						{:else}
							<p class="p-4 text-xs text-slate-500">No vehicles match “{search}”.</p>
						{/each}
					{/if}
				</div>
			</aside>
		{/if}

		<!-- Map -->
		<div class="relative min-w-0 flex-1">
			<div bind:this={el} class="absolute inset-0 bg-slate-100"></div>

			{#if mapFailed}
				<div class="absolute inset-0 grid place-items-center bg-slate-50 p-6 text-center text-sm text-slate-600">
					The map could not load. Vehicle states in the list are still current.
				</div>
			{:else if !data.trackingEnabled}
				<div class="absolute inset-0 grid place-items-center bg-white/80 p-6 text-center">
					<div><p class="text-sm font-semibold text-slate-900">Tracking is not set up</p><p class="mt-1 text-xs text-slate-500">This deployment has no tracking service configured.</p></div>
				</div>
			{:else if vehicles.length === 0}
				<div class="absolute inset-0 grid place-items-center bg-white/80 p-6 text-center">
					<div><p class="text-sm font-semibold text-slate-900">No vehicles yet</p><p class="mt-1 text-xs text-slate-500">Add a vehicle, then set up its tracker to see it here.</p></div>
				</div>
			{:else if !vehicles.some(hasPosition) && mode === 'live'}
				<div class="pointer-events-none absolute inset-x-0 top-14 z-[500] flex justify-center px-3">
					<p class="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-sm">
						{#if faulted}Tracking service temporarily unavailable — positions will return when it does.{:else}No vehicle has sent a GPS fix yet.{/if}
					</p>
				</div>
			{/if}

			<!-- Phone: a compact vehicle strip instead of a sidebar eating the map. -->
			<div class="pointer-events-none absolute inset-x-0 top-0 z-[500] lg:hidden">
				<div class="pointer-events-auto flex gap-1.5 overflow-x-auto p-2">
					{#each ordered as v (v.id)}
						<button type="button" onclick={() => select(v.id)} class="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium shadow-sm backdrop-blur {selectedId === v.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white/95 text-slate-700'}">
							<span class="size-2 rounded-full {selectedId === v.id ? 'bg-white' : dotOf(v.state)}"></span>{v.name}
						</button>
					{/each}
				</div>
			</div>

			<!-- Map controls -->
			<div class="pointer-events-none absolute inset-x-3 top-12 z-[500] flex items-start justify-between gap-2 lg:top-3">
				<div class="pointer-events-auto flex items-center gap-2">
					<button type="button" onclick={() => (listOpen = !listOpen)} title={listOpen ? 'Hide vehicles' : 'Show vehicles'} class="hidden rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 lg:block">{listOpen ? '‹ Vehicles' : 'Vehicles ›'}</button>
					<div class="flex overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm" role="group" aria-label="Map layer">
						{#each LAYERS as l (l.key)}
							<button type="button" onclick={() => (layer = l.key)} aria-pressed={layer === l.key} class="px-2.5 py-1.5 text-[11.5px] font-medium transition {layer === l.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}">{l.label}</button>
						{/each}
					</div>
				</div>
				<div class="pointer-events-auto flex flex-col gap-1.5">
					<button type="button" onclick={() => map?.zoomIn()} title="Zoom in" class="size-9 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">+</button>
					<button type="button" onclick={() => map?.zoomOut()} title="Zoom out" class="size-9 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">−</button>
					<button type="button" onclick={recentre} title={mode === 'history' ? 'Fit the route' : 'Centre on this vehicle'} class="size-9 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">◎</button>
					<button type="button" onclick={frameFleet} title="Show the whole fleet" class="size-9 rounded-lg border border-slate-200 bg-white/95 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50">ALL</button>
					<button type="button" onclick={() => (fullscreen = !fullscreen)} title={fullscreen ? 'Exit full screen' : 'Full screen'} class="size-9 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">⛶</button>
				</div>
			</div>

			<!-- Selected vehicle: a floating panel on desktop, a bottom sheet on a phone. -->
			{#if selected}
				<div class="pointer-events-auto absolute inset-x-0 bottom-0 z-[500] lg:inset-x-auto lg:bottom-3 lg:left-3 lg:w-[360px]">
					<div class="rounded-t-2xl border border-slate-200 bg-white/97 shadow-lg backdrop-blur lg:rounded-panel">
						<!-- Drag handle / toggle for the phone sheet -->
						<button type="button" class="flex w-full justify-center py-2 lg:hidden" onclick={() => (sheetOpen = !sheetOpen)} aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}>
							<span class="h-1 w-10 rounded-full bg-slate-300"></span>
						</button>

						<!-- Vehicle header: the whole row leads to the tracker page -->
						<a href="/app/vehicles/{selected.id}/tracking" class="flex items-center gap-3 px-4 pb-3 pt-1 hover:bg-slate-50 lg:pt-4">
							<span class="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600" aria-hidden="true">
								<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" /><circle cx="7.5" cy="15.5" r="1" /><circle cx="16.5" cy="15.5" r="1" /></svg>
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[15px] font-semibold text-slate-900">{selected.name}</span>
								<span class="block truncate font-mono text-xs text-slate-500">{selected.registration || [selected.make, selected.model].filter(Boolean).join(' ') || 'No registration'}</span>
							</span>
							<span class="shrink-0 text-[11px] font-semibold tracking-wide {textOf(selected.state)}">{badgeOf(selected.state)}</span>
							<span class="shrink-0 text-slate-400" aria-hidden="true">›</span>
						</a>

						<div class="{sheetOpen ? '' : 'hidden'} lg:block">
							{#if mode === 'live'}
								<!-- State sentence: the server's words, with a fault said as a fault. -->
								<p class="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs font-medium {textOf(selected.state)}">
									<span class="size-2 rounded-full {dotOf(selected.state)}"></span>
									{#if isProviderFault(selected.state)}Tracking service temporarily unavailable{:else}{selected.label}{/if}
								</p>

								<dl class="grid grid-cols-2 gap-x-3 gap-y-3 px-4 pb-3 text-xs">
									<div>
										<dt class="text-[10.5px] uppercase tracking-wide text-slate-400">GPS updated</dt>
										<dd class="mt-0.5 text-base font-semibold text-slate-900">
											{#if selected.recordedAt}<TimeAgo value={selected.recordedAt} />{:else if selected.tracked}No fix yet{:else}—{/if}
										</dd>
									</div>
									<div>
										<dt class="text-[10.5px] uppercase tracking-wide text-slate-400">Speed</dt>
										<dd class="mt-0.5 text-base font-semibold text-slate-900">{movement(selected.speedKph)}</dd>
									</div>
									<div class="col-span-2 text-[11px] text-slate-400">Checked <TimeAgo value={checkedAt} /> — that is when Connect last asked, not when the vehicle last moved.</div>
								</dl>

								{#if selected.trip}
									<a href="/app/trips/{selected.trip.id}" class="mx-4 mb-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs hover:bg-slate-100">
										<span class="min-w-0"><span class="block text-[10.5px] uppercase tracking-wide text-slate-400">Current trip</span>
											<span class="block truncate font-medium text-slate-800">{selected.trip.title || selected.trip.reference}</span></span>
										<span class="shrink-0 text-brand-600">→</span>
									</a>
								{/if}

								<div class="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
									<button type="button" onclick={recentre} class="btn-secondary !py-1.5 text-xs">Recenter</button>
									<button type="button" onclick={enterHistory} class="btn-secondary !py-1.5 text-xs">Route history</button>
									<a href="/app/vehicles/{selected.id}/tracking" class="btn-secondary !py-1.5 text-xs">Tracker setup</a>
								</div>
							{:else}
								<!-- ROUTE HISTORY: one bounded range, fetched once, replayed here. -->
								<div class="border-t border-slate-100 px-4 py-3">
									<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Range">
										{#each [['today', 'Today'], ['6h', 'Last 6 h'], ['24h', 'Last 24 h'], ['custom', 'Custom']] as [key, label] (key)}
											<button type="button" onclick={() => choosePreset(key as HistoryPreset)} aria-pressed={preset === key} class="rounded-md px-2 py-1 text-[11.5px] font-medium transition {preset === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">{label}</button>
										{/each}
									</div>
									{#if preset === 'custom'}
										<label class="mt-2 flex items-center gap-2 text-[11.5px] text-slate-600">
											Last
											<input type="number" min="1" max="24" bind:value={customHours} onchange={() => loadHistory()} class="input !w-16 !py-1 text-xs" aria-label="Hours" />
											hours <span class="text-slate-400">(up to 24 — the tracking service keeps one day)</span>
										</label>
									{/if}

									<div class="mt-3 text-xs">
										{#if historyStatus === 'loading'}
											<p class="text-slate-500">Loading the route…</p>
										{:else if historyStatus === 'failed'}
											<p class="text-warning">The route could not be loaded. <button type="button" class="underline" onclick={loadHistory}>Try again</button></p>
										{:else if historyStatus === 'empty'}
											<p class="text-slate-500">No route recorded in the last {historyMeta.hours} h.</p>
										{:else if historyStatus === 'ready'}
											{#if historyMeta.truncated}
												<p class="mb-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-[11.5px] text-warning">{truncationNotice(fixes.length, historyMeta.limit)}</p>
											{/if}
											<div class="grid grid-cols-3 gap-2">
												<div><span class="block text-[10.5px] uppercase tracking-wide text-slate-400">Fix time</span><span class="block text-sm font-semibold text-slate-900">{current ? fmtTime(current[2]) : '—'}</span></div>
												<div><span class="block text-[10.5px] uppercase tracking-wide text-slate-400">Travelled</span><span class="block text-sm font-semibold text-slate-900">{formatKm(travelled)}</span></div>
												<div><span class="block text-[10.5px] uppercase tracking-wide text-slate-400">Route</span><span class="block text-sm font-semibold text-slate-900">{formatKm(routeLength)}</span></div>
											</div>
											<p class="mt-1 text-[11px] text-slate-400">{fixes.length.toLocaleString('en-US')} recorded fixes · {historyMeta.hours} h · distance follows the recorded fixes, not a straight line</p>

											<!-- Replay -->
											<div class="mt-3">
												<input type="range" min="0" max={Math.max(0, fixes.length - 1)} value={replayIndex} oninput={(e) => { pause(); replayIndex = clampIndex(Number((e.currentTarget as HTMLInputElement).value), fixes.length); placeReplayDot(); }} class="w-full accent-brand-600" aria-label="Route timeline" />
												<div class="mt-2 flex items-center gap-1.5">
													<button type="button" onclick={() => stepReplay(-1)} class="btn-secondary !px-2.5 !py-1 text-xs" aria-label="Previous fix">‹</button>
													{#if playing}
														<button type="button" onclick={pause} class="btn-primary !px-3 !py-1 text-xs">Pause</button>
													{:else}
														<button type="button" onclick={play} disabled={fixes.length < 2} class="btn-primary !px-3 !py-1 text-xs disabled:opacity-40">Play</button>
													{/if}
													<button type="button" onclick={() => stepReplay(1)} class="btn-secondary !px-2.5 !py-1 text-xs" aria-label="Next fix">›</button>
													<span class="ml-auto flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Replay speed">
														{#each REPLAY_SPEEDS as s (s)}
															<button type="button" onclick={() => setSpeed(s)} aria-pressed={speed === s} class="px-2 py-1 {speed === s ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}">{s}×</button>
														{/each}
													</span>
												</div>
											</div>
										{/if}
									</div>
								</div>
								<div class="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
									<button type="button" onclick={recentre} class="btn-secondary !py-1.5 text-xs">Fit route</button>
									<button type="button" onclick={enterLive} class="btn-secondary !py-1.5 text-xs">Back to live</button>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{:else if vehicles.length > 0 && data.trackingEnabled}
				<div class="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-sm">Select a vehicle to see where it is.</div>
			{/if}
		</div>
	</div>
</div>
