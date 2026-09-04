<script lang="ts">
	/*
	 * Fleet tracking. The map IS the page.
	 *
	 * Leaflet and its CSS load inside onMount, so the library only ships to
	 * somebody actually looking at a vehicle. Polling stops when the tab is
	 * hidden — a fleet map left open in a background tab should not spend an
	 * operator's connection all afternoon.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	type Row = (typeof data.vehicles)[number];

	let vehicles = $state<Row[]>(data.vehicles);
	let selectedId = $state<string | null>(data.selectedId);
	let checkedAt = $state<string>(data.checkedAt);
	let search = $state('');
	let panelOpen = $state(true);
	let historyHours = $state(24);
	let historyPoints = $state<[number, number, number][]>([]);
	let loadingHistory = $state(false);
	let fullscreen = $state(false);

	const selected = $derived(vehicles.find((v) => v.id === selectedId) ?? null);
	const filtered = $derived(
		vehicles.filter((v) =>
			[v.name, v.registration, v.make, v.model].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())
		)
	);

	/** Colour is never the only carrier — every row and pin also has a word. */
	const TONE: Record<string, string> = {
		LIVE: 'text-success',
		RECENT: 'text-success',
		STALE: 'text-warning',
		OFFLINE: 'text-slate-400',
		NOT_CONFIGURED: 'text-slate-400',
		UNAVAILABLE: 'text-warning'
	};
	const DOT: Record<string, string> = {
		LIVE: 'bg-success',
		RECENT: 'bg-success',
		STALE: 'bg-warning',
		OFFLINE: 'bg-slate-300',
		NOT_CONFIGURED: 'bg-slate-300',
		UNAVAILABLE: 'bg-warning'
	};

	let el = $state<HTMLDivElement | null>(null);
	let map: import('leaflet').Map | null = null;
	let L: typeof import('leaflet') | null = null;
	let tiles: import('leaflet').TileLayer | null = null;
	let marker: import('leaflet').CircleMarker | null = null;
	let line: import('leaflet').Polyline | null = null;
	let startDot: import('leaflet').CircleMarker | null = null;
	let poll: ReturnType<typeof setInterval> | null = null;

	const LAYERS = [
		{ key: 'standard', label: 'Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
		{ key: 'satellite', label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attribution: 'Imagery &copy; Esri' },
		{ key: 'terrain', label: 'Terrain', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)' }
	] as const;
	let layer = $state<(typeof LAYERS)[number]['key']>('standard');

	onMount(() => {
		let cancelled = false;
		(async () => {
			const leaflet = (await import('leaflet')).default;
			await import('leaflet/dist/leaflet.css');
			if (cancelled || !el) return;
			L = leaflet;
			map = leaflet.map(el, { zoomControl: false, attributionControl: true }).setView([-6.4, 34.9], 6);
			applyLayer();
			draw();
			if (selectedId) loadHistory();
		})();

		// Only while the operator is looking. A hidden tab polls nothing.
		poll = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, 25000);

		return () => {
			cancelled = true;
			map?.remove();
			map = null;
		};
	});

	onDestroy(() => {
		if (poll) clearInterval(poll);
	});

	function applyLayer() {
		if (!map || !L) return;
		const choice = LAYERS.find((l) => l.key === layer) ?? LAYERS[0];
		tiles?.remove();
		tiles = L.tileLayer(choice.url, { maxZoom: choice.maxZoom, attribution: choice.attribution }).addTo(map);
		if (map.getZoom() > choice.maxZoom) map.setZoom(choice.maxZoom);
	}

	/** Redraw the pin and the track WITHOUT rebuilding the map or moving the camera. */
	function draw(recenter = false) {
		if (!map || !L) return;
		const v = selected;
		marker?.remove();
		line?.remove();
		startDot?.remove();
		marker = null;
		line = null;
		startDot = null;
		if (!v || v.latitude == null || v.longitude == null) return;

		if (historyPoints.length > 1) {
			// Drawn verbatim. A smoothed curve would be a road the vehicle never took.
			line = L.polyline(
				historyPoints.map((p) => [p[0], p[1]] as [number, number]),
				{ weight: 4, opacity: 0.6 }
			).addTo(map);
			startDot = L.circleMarker([historyPoints[0][0], historyPoints[0][1]], {
				radius: 5,
				weight: 3,
				fillOpacity: 1,
				color: '#64748b',
				fillColor: '#ffffff'
			}).addTo(map);
			startDot.bindTooltip('Start of this route', { direction: 'top' });
		}

		marker = L.circleMarker([v.latitude, v.longitude], { radius: 10, weight: 4, fillOpacity: 0.95 }).addTo(map);
		marker.bindTooltip(v.name, { direction: 'top', offset: [0, -10] });
		if (recenter) map.setView([v.latitude, v.longitude], Math.max(map.getZoom(), 13));
	}

	async function refresh() {
		const res = await fetch('/app/tracking/positions').catch(() => null);
		if (!res?.ok) return;
		const body = await res.json();
		checkedAt = body.data.checkedAt;
		const byId = new Map<string, Row>(body.data.vehicles.map((v: Row) => [v.id, v]));
		// Merge, never replace: the poll carries live fields only, and the trip and
		// registration came from the page load.
		vehicles = vehicles.map((v) => ({ ...v, ...(byId.get(v.id) ?? {}) }));
		draw();
	}

	async function loadHistory() {
		if (!selectedId) return;
		loadingHistory = true;
		const res = await fetch(`/app/tracking/history?vehicle=${selectedId}&hours=${historyHours}`).catch(() => null);
		loadingHistory = false;
		if (!res?.ok) {
			historyPoints = [];
			draw();
			return;
		}
		const body = await res.json();
		historyPoints = body.data.points ?? [];
		draw();
	}

	function select(id: string) {
		selectedId = id;
		historyPoints = [];
		draw(true);
		loadHistory();
	}

	function recentre() {
		const v = selected;
		if (v?.latitude != null && v.longitude != null && map) map.setView([v.latitude, v.longitude], Math.max(map.getZoom(), 13));
	}

	function chooseHours(h: number) {
		historyHours = h;
		loadHistory();
	}

	$effect(() => {
		void layer;
		if (map) applyLayer();
	});

	// Leaflet measures its container on creation; a fullscreen toggle changes it.
	$effect(() => {
		void fullscreen;
		void panelOpen;
		if (map) setTimeout(() => map?.invalidateSize(), 210);
	});
</script>

<svelte:head><title>Vehicle tracking · Makutano Connect</title></svelte:head>

<div class="flex flex-col gap-3 {fullscreen ? 'fixed inset-0 z-50 bg-white p-3' : ''}">
	{#if !fullscreen}
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 class="text-lg font-semibold text-slate-900">Vehicle tracking</h1>
				<p class="mt-0.5 text-xs text-slate-500">
					Where your fleet is now. Positions come from each vehicle's tracker, not from a guess.
				</p>
			</div>
			<p class="text-xs text-slate-400">Checked <TimeAgo value={checkedAt} /></p>
		</div>
	{/if}

	<div
		class="flex overflow-hidden rounded-panel border border-slate-200 bg-white"
		style="height: {fullscreen ? 'calc(100vh - 24px)' : 'calc(100vh - 210px)'}; min-height: 460px;">
		<!-- Vehicle panel -->
		{#if panelOpen}
			<aside class="flex w-[290px] shrink-0 flex-col border-r border-slate-200">
				<div class="border-b border-slate-100 p-3">
					<input bind:value={search} placeholder="Search vehicles…" class="input" />
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					{#each filtered as v (v.id)}
						<button
							type="button"
							onclick={() => select(v.id)}
							class="flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-3 text-left transition hover:bg-slate-50 {selectedId ===
							v.id
								? 'bg-brand-50/60'
								: ''}">
							<span class="mt-1.5 size-2 shrink-0 rounded-full {DOT[v.state]}"></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-slate-900">{v.name}</span>
								{#if v.registration}<span class="block truncate font-mono text-[11.5px] text-slate-500">{v.registration}</span>{/if}
								<span class="mt-0.5 block truncate text-[11.5px] {TONE[v.state]}">
									{v.label}{#if v.recordedAt} · <TimeAgo value={v.recordedAt} />{/if}
								</span>
							</span>
						</button>
					{:else}
						<p class="p-4 text-xs text-slate-500">No vehicles match “{search}”.</p>
					{/each}
				</div>
			</aside>
		{/if}

		<!-- Map -->
		<div class="relative min-w-0 flex-1">
			<div bind:this={el} class="absolute inset-0 bg-slate-100"></div>

			<div class="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start justify-between gap-2">
				<div class="pointer-events-auto flex items-center gap-2">
					<button
						type="button"
						onclick={() => (panelOpen = !panelOpen)}
						title={panelOpen ? 'Hide vehicles' : 'Show vehicles'}
						class="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
						>{panelOpen ? '‹ Vehicles' : 'Vehicles ›'}</button>
					<div class="flex overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm">
						{#each LAYERS as l (l.key)}
							<button
								type="button"
								onclick={() => (layer = l.key)}
								aria-pressed={layer === l.key}
								class="px-2.5 py-1.5 text-[11.5px] font-medium transition {layer === l.key
									? 'bg-brand-600 text-white'
									: 'text-slate-600 hover:bg-slate-50'}">{l.label}</button>
						{/each}
					</div>
				</div>
				<div class="pointer-events-auto flex flex-col gap-1.5">
					<button type="button" onclick={() => map?.zoomIn()} title="Zoom in" class="size-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">+</button>
					<button type="button" onclick={() => map?.zoomOut()} title="Zoom out" class="size-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">−</button>
					<button type="button" onclick={recentre} title="Centre on this vehicle" class="size-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">◎</button>
					<button type="button" onclick={() => (fullscreen = !fullscreen)} title={fullscreen ? 'Exit full screen' : 'Full screen'} class="size-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">⛶</button>
				</div>
			</div>

			<!-- Selected vehicle -->
			{#if selected}
				<div class="pointer-events-auto absolute bottom-3 left-3 z-[500] w-[330px] max-w-[calc(100%-24px)] rounded-panel border border-slate-200 bg-white/97 p-4 shadow-lg backdrop-blur">
					<p class="text-sm font-semibold text-slate-900">{selected.name}</p>
					{#if selected.registration || selected.make}
						<p class="mt-0.5 text-xs text-slate-500">
							{[selected.make, selected.model].filter(Boolean).join(' ')}{#if selected.registration} · <span class="font-mono">{selected.registration}</span>{/if}
						</p>
					{/if}

					<p class="mt-2.5 flex items-center gap-2 text-xs font-medium {TONE[selected.state]}">
						<span class="size-2 rounded-full {DOT[selected.state]}"></span>{selected.label}
					</p>

					<dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-slate-100 pt-3 text-xs">
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Last GPS update</dt>
							<dd class="mt-0.5 text-sm font-medium text-slate-900">
								{#if selected.recordedAt}<TimeAgo value={selected.recordedAt} />{:else}Never{/if}
							</dd>
						</div>
						<div>
							<dt class="text-[11px] uppercase tracking-wide text-slate-400">Movement</dt>
							<dd class="mt-0.5 text-sm font-medium text-slate-900">
								{#if selected.speedKph == null}—{:else if selected.speedKph > 3}{Math.round(selected.speedKph)} km/h{:else}Parked{/if}
							</dd>
						</div>
					</dl>

					{#if selected.trip}
						<a href="/app/trips/{selected.trip.id}" class="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs hover:bg-slate-100">
							<span class="min-w-0"><span class="block text-[11px] uppercase tracking-wide text-slate-400">Current trip</span>
								<span class="block truncate font-medium text-slate-800">{selected.trip.title || selected.trip.reference}</span></span>
							<span class="shrink-0 text-brand-600">→</span>
						</a>
					{/if}

					<div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
						<span class="text-[11px] uppercase tracking-wide text-slate-400">Route</span>
						{#each [6, 24] as h (h)}
							<button
								type="button"
								onclick={() => chooseHours(h)}
								class="rounded-md px-2 py-1 text-[11.5px] font-medium transition {historyHours === h
									? 'bg-brand-600 text-white'
									: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">Last {h}h</button>
						{/each}
						<span class="ml-auto text-[11px] text-slate-400">
							{#if loadingHistory}loading…{:else if historyPoints.length > 1}{historyPoints.length} points{:else}no route yet{/if}
						</span>
					</div>

					<!-- Coordinates are secondary and stay behind a disclosure. -->
					{#if selected.latitude != null}
						<details class="mt-2">
							<summary class="cursor-pointer text-[11.5px] text-slate-500 hover:text-slate-700">Tracking details</summary>
							<p class="mt-1.5 font-mono text-[11px] text-slate-500">
								{selected.latitude.toFixed(5)}, {selected.longitude?.toFixed(5)}
							</p>
							<p class="text-[11px] text-slate-400">Checked <TimeAgo value={checkedAt} /></p>
						</details>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
