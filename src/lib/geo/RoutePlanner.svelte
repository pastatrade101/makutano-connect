<script lang="ts">
	/**
	 * The itinerary, drawn as the vendor builds it.
	 *
	 * The route is READ OFF the days — pick Tarangire on day 2 and the leg appears.
	 * Nobody draws a route by hand, because a route typed twice is a route that
	 * contradicts itself the first time a day is moved.
	 *
	 * A day whose stop is not a canonical destination (a camp, a viewpoint, a
	 * river crossing) can be pinned directly on the map instead. Those places
	 * should not become directory entries — seeding the directory with every
	 * lodge is how a destination list stops being useful — so the pin lives on
	 * the day.
	 */
	import TanzaniaMap from './TanzaniaMap.svelte';
	import type { BasemapDoc, LngLat, MapMarker } from './basemap';

	interface Stop {
		dayNumber: number;
		title: string;
		/** Name of the canonical destination, when the day names one. */
		placeName: string | null;
		lat: number | null;
		lng: number | null;
		/** True when the coordinate is the day's own pin rather than a destination's. */
		pinned: boolean;
		/** DRIVE | FLY | BOAT — how this stop is reached from the previous one. */
		mode?: string | null;
	}

	interface Props {
		basemap: BasemapDoc | null;
		stops: Stop[];
		/** The day a click on the map should pin, or null when not placing. */
		placingDay?: number | null;
		onplace?: (dayNumber: number, p: LngLat) => void;
		onclear?: (dayNumber: number) => void;
		onstartplacing?: (dayNumber: number | null) => void;
	}

	let { basemap, stops, placingDay = null, onplace, onclear, onstartplacing }: Props = $props();

	const located = $derived(stops.filter((s) => s.lat !== null && s.lng !== null));
	const markers = $derived<MapMarker[]>(
		located.map((s) => ({
			lat: s.lat as number,
			lng: s.lng as number,
			badge: `Day ${s.dayNumber}`,
			kind: 'stop',
			mode: (s.mode ?? undefined) as MapMarker['mode']
		}))
	);
	const regions = $derived([...new Set(stops.map((s) => s.placeName).filter(Boolean))] as string[]);
	const unplaced = $derived(stops.filter((s) => s.lat === null || s.lng === null));
</script>

<div class="rounded-lg border border-slate-200 bg-white">
	<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
		<h3 class="text-sm font-semibold text-slate-900">Route</h3>
		<p class="text-xs text-slate-500">
			{#if placingDay !== null}
				Click the map to pin day {placingDay}.
				<button type="button" class="ml-1 underline" onclick={() => onstartplacing?.(null)}>Cancel</button>
			{:else}
				Drawn from the places you choose for each day.
			{/if}
		</p>
	</div>

	{#if !basemap}
		<p class="px-4 py-8 text-center text-sm text-slate-500">Loading the map…</p>
	{:else if !located.length && placingDay === null}
		<p class="px-4 py-8 text-center text-sm text-slate-500">
			Choose a place for a day, and the route appears here.
		</p>
	{:else}
		<div class="p-3">
			<TanzaniaMap
				{basemap}
				{markers}
				route
				focus={located.length > 1 ? 'markers' : 'country'}
				width={560}
				ariaLabel={regions.length ? `Route through ${regions.join(', ')}` : 'Route map'}
				onmapclick={placingDay !== null ? (p) => onplace?.(placingDay, p) : undefined}
			/>
		</div>
	{/if}

	<ol class="divide-y divide-slate-100 border-t border-slate-200">
		{#each stops as s (s.dayNumber)}
			<li class="flex items-center gap-3 px-4 py-2 text-sm">
				<span
					class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold
						{s.lat !== null ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}"
				>
					{s.dayNumber}
				</span>
				<span class="min-w-0 flex-1 truncate">
					<span class="text-slate-900">{s.title || `Day ${s.dayNumber}`}</span>
					{#if s.placeName}
						<span class="text-slate-500"> · {s.placeName}</span>
					{/if}
					{#if s.mode}
						<span class="text-slate-400"> · {s.mode.toLowerCase()}</span>
					{:else if s.pinned}
						<span class="text-slate-500"> · pinned on the map</span>
					{/if}
				</span>
				{#if s.pinned}
					<button type="button" class="shrink-0 text-xs text-slate-500 underline" onclick={() => onclear?.(s.dayNumber)}>
						Remove pin
					</button>
				{:else}
					<button
						type="button"
						class="shrink-0 text-xs text-emerald-700 underline"
						onclick={() => onstartplacing?.(s.dayNumber)}
					>
						Pin on map
					</button>
				{/if}
			</li>
		{/each}
	</ol>

	{#if unplaced.length && placingDay === null}
		<p class="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
			{unplaced.length}
			{unplaced.length === 1 ? 'day has' : 'days have'} no place yet, so
			{unplaced.length === 1 ? 'it is' : 'they are'} not on the map.
		</p>
	{/if}
</div>
