<script lang="ts">
	/*
	 * A real map, for the one screen that needs one.
	 *
	 * Connect already has a Tanzania basemap, and it is deliberately NOT used here.
	 * Two reasons, both measured: padBBox() floors the frame at 1.6 degrees — about
	 * 178 km — so it physically cannot show where a vehicle is on a track, and its
	 * route mode draws each leg as a BOWED Bezier, which for GPS points would paint
	 * a path the vehicle never drove. That map exists to say which part of the
	 * country a place is in, and it is very good at that. This is a different job.
	 *
	 * Leaflet and its CSS are imported INSIDE onMount so neither reaches any other
	 * page: the whole library only loads for somebody actually looking at a vehicle.
	 * Nothing here runs during SSR, which is also why the container renders empty
	 * first and is filled afterwards.
	 */
	import { onMount } from 'svelte';

	let {
		latitude,
		longitude,
		label = 'Vehicle',
		/** Oldest-first GPS points. Drawn verbatim — no smoothing, no curve. */
		track = [] as { latitude: number; longitude: number }[],
		height = '320px'
	}: {
		latitude: number | null;
		longitude: number | null;
		label?: string;
		track?: { latitude: number; longitude: number }[];
		height?: string;
	} = $props();

	/*
	 * Three basemaps, none of which needs an API key or a bill.
	 *
	 * Satellite is not decoration for this product: a Land Cruiser in the
	 * Serengeti is usually on a track that no street map has ever drawn, so on
	 * Standard the vehicle floats in empty beige. Imagery is the only view where
	 * an operator can tell a riverbed from a road.
	 *
	 * Each carries its own attribution because each licence demands it, and its
	 * own maxZoom because OpenTopoMap stops at 17 and will otherwise serve grey.
	 */
	const LAYERS = [
		{
			key: 'standard',
			label: 'Standard',
			url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
			maxZoom: 19,
			attribution: '&copy; OpenStreetMap contributors'
		},
		{
			key: 'satellite',
			label: 'Satellite',
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			maxZoom: 19,
			attribution: 'Imagery &copy; Esri'
		},
		{
			key: 'terrain',
			label: 'Terrain',
			url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
			maxZoom: 17,
			attribution: '&copy; OpenTopoMap (CC-BY-SA)'
		}
	] as const;

	let active = $state<(typeof LAYERS)[number]['key']>('standard');
	let tiles: import('leaflet').TileLayer | null = null;

	let el = $state<HTMLDivElement | null>(null);
	let map: import('leaflet').Map | null = null;
	let marker: import('leaflet').Marker | null = null;
	let line: import('leaflet').Polyline | null = null;
	let failed = $state(false);

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const L = (await import('leaflet')).default;
				await import('leaflet/dist/leaflet.css');
				if (cancelled || !el) return;

				map = L.map(el, { attributionControl: true, zoomControl: true });
				leaflet = L;
				applyLayer(L);
				draw(L);
			} catch {
				// A map that will not load must not take the tracking card with it —
				// the coordinates and the timestamp beside it are the load-bearing part.
				failed = true;
			}
		})();
		return () => {
			cancelled = true;
			map?.remove();
			map = null;
		};
	});

	let leaflet: typeof import('leaflet') | null = null;

	/** Swap the basemap without touching the marker, the track or the camera. */
	function applyLayer(L: typeof import('leaflet')) {
		if (!map) return;
		const choice = LAYERS.find((l) => l.key === active) ?? LAYERS[0];
		tiles?.remove();
		tiles = L.tileLayer(choice.url, { maxZoom: choice.maxZoom, attribution: choice.attribution }).addTo(map);
		// A view with a lower ceiling must not leave the reader staring at grey.
		if (map.getZoom() > choice.maxZoom) map.setZoom(choice.maxZoom);
	}

	function choose(key: (typeof LAYERS)[number]['key']) {
		active = key;
		if (leaflet) applyLayer(leaflet);
	}

	/** Back to the vehicle, for when panning has lost it. */
	function recenter() {
		if (!map || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
		map.setView([latitude as number, longitude as number], Math.max(map.getZoom(), 13));
	}

	function draw(L: typeof import('leaflet')) {
		if (!map) return;
		const points = track.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

		if (points.length > 1) {
			line?.remove();
			// A straight segment between consecutive fixes. This is what the vehicle
			// reported, in the order it reported it.
			line = L.polyline(points.map((p) => [p.latitude, p.longitude] as [number, number]), {
				weight: 3,
				opacity: 0.85
			}).addTo(map);
			map.fitBounds(line.getBounds(), { padding: [24, 24] });
		}

		if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
			marker?.remove();
			marker = L.circleMarker([latitude as number, longitude as number], {
				radius: 8,
				weight: 3,
				fillOpacity: 0.9
			})
				.addTo(map)
				.bindTooltip(label, { permanent: false }) as unknown as import('leaflet').Marker;
			if (points.length <= 1) map.setView([latitude as number, longitude as number], 12);
		} else if (points.length <= 1) {
			// Nothing to show. Frame Tanzania rather than the Atlantic, which is where
			// [0,0] would put a reader who trusted an empty map.
			map.setView([-6.4, 34.9], 5);
		}
	}

	// Re-draw when a poll brings a newer fix, without rebuilding the map.
	$effect(() => {
		void latitude;
		void longitude;
		void track;
		if (!map) return;
		import('leaflet').then(({ default: L }) => draw(L));
	});
</script>

{#if failed}
	<p class="rounded-panel border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
		The map could not load. The position and time above are still current.
	</p>
{:else}
	<div class="relative">
		<div bind:this={el} style="height: {height}" class="w-full overflow-hidden rounded-panel border border-slate-200 bg-slate-100"></div>

		<!-- Above Leaflet's own panes (z-index 400) but below its popups. -->
		<div class="pointer-events-none absolute inset-x-2 top-2 z-[500] flex items-start justify-between gap-2">
			<div class="pointer-events-auto flex overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
				{#each LAYERS as l (l.key)}
					<button
						type="button"
						onclick={() => choose(l.key)}
						aria-pressed={active === l.key}
						class="px-2.5 py-1 text-[11.5px] font-medium transition {active === l.key
							? 'bg-brand-600 text-white'
							: 'text-slate-600 hover:bg-slate-50'}">{l.label}</button>
				{/each}
			</div>

			{#if Number.isFinite(latitude) && Number.isFinite(longitude)}
				<button
					type="button"
					onclick={recenter}
					title="Centre on the vehicle"
					class="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 shadow-sm backdrop-blur hover:bg-slate-50"
					>Recentre</button>
			{/if}
		</div>
	</div>
{/if}
