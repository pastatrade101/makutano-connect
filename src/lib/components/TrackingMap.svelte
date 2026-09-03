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
				L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
					maxZoom: 19,
					// OpenStreetMap's licence requires this credit to be visible.
					attribution: '&copy; OpenStreetMap contributors'
				}).addTo(map);
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
	<div bind:this={el} style="height: {height}" class="w-full overflow-hidden rounded-panel border border-slate-200 bg-slate-100"></div>
{/if}
