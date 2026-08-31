<script lang="ts">
	/**
	 * A Tanzania map rendered as plain SVG from the bundled national basemap.
	 *
	 * Deliberately not Leaflet/Mapbox: no API key on a public page, no tile
	 * request to a third party, no runtime dependency to keep alive, and it
	 * inherits the surrounding theme through CSS custom properties instead of
	 * fighting a library's stylesheet. It also renders correctly on the server,
	 * so a destination page ships its map in the HTML.
	 */
	import {
		decodeBasemap,
		fitProjection,
		regionShapes,
		outlinePath,
		lakePaths,
		legPath,
		LEG_BOW,
		padBBox,
		boundsOf,
		type BasemapDoc,
		type BBox,
		type LngLat,
		type MapMarker
	} from './basemap';

	interface Props {
		basemap: BasemapDoc;
		/** Region slugs painted as active. */
		highlight?: string[];
		markers?: MapMarker[];
		/** Join the markers in order, as a journey. */
		route?: boolean;
		/** 'country', 'markers', 'highlight', or an explicit bbox. */
		focus?: BBox | 'country' | 'markers' | 'highlight';
		width?: number;
		showRegionLabels?: boolean;
		interactive?: boolean;
		ariaLabel?: string;
		onselect?: (slug: string) => void;
		/**
		 * Per-region fill, keyed by region slug. Used to shade the country by
		 * tourism circuit, where every region has a colour and "highlight" would
		 * be the wrong idea — nothing is being singled out.
		 */
		regionColors?: Record<string, string>;
		/** Turns the map into a picker: a click reports where it landed. */
		onmapclick?: (p: LngLat) => void;
		class?: string;
	}

	let {
		basemap,
		highlight = [],
		markers = [],
		route = false,
		focus = 'country',
		width = 640,
		showRegionLabels = false,
		interactive = false,
		regionColors,
		ariaLabel = 'Map of Tanzania',
		onselect,
		onmapclick,
		class: className = ''
	}: Props = $props();

	let svgEl = $state<SVGSVGElement | null>(null);

	/**
	 * Client pixels to lon/lat.
	 *
	 * Goes through the SVG's own screen matrix rather than getBoundingClientRect
	 * arithmetic, so it stays correct under preserveAspectRatio letterboxing, CSS
	 * transforms and any zoom the browser is applying.
	 */
	function pointAt(ev: MouseEvent): LngLat | null {
		if (!svgEl) return null;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		const p = svgEl.createSVGPoint();
		p.x = ev.clientX;
		p.y = ev.clientY;
		const local = p.matrixTransform(ctm.inverse());
		return project.invert([local.x, local.y]);
	}

	// A stable id so <defs> in two maps on one page cannot collide.
	const uid = `mk-map-${Math.random().toString(36).slice(2, 9)}`;

	const map = $derived(decodeBasemap(basemap));
	const active = $derived(new Set(highlight));

	const bounds = $derived.by((): BBox => {
		if (Array.isArray(focus)) return padBBox(focus);
		if (focus === 'markers' && markers.length) {
			return padBBox(
				boundsOf(
					markers.map((m) => [m.lng, m.lat] as LngLat),
					basemap.bbox
				),
				0.45
			);
		}
		if (focus === 'highlight' && highlight.length) {
			const hit = basemap.regions.filter((r) => active.has(r.slug));
			if (hit.length) {
				return padBBox([
					Math.min(...hit.map((r) => r.bbox[0])),
					Math.min(...hit.map((r) => r.bbox[1])),
					Math.max(...hit.map((r) => r.bbox[2])),
					Math.max(...hit.map((r) => r.bbox[3]))
				]);
			}
		}
		return padBBox(basemap.bbox, 0.04);
	});

	const project = $derived(fitProjection(bounds, width));
	const regions = $derived(regionShapes(map, project));
	const outline = $derived(outlinePath(map, project));
	const lakes = $derived(lakePaths(map, project));
	// A marker with a missing or unparseable coordinate is DROPPED rather than
	// projected to NaN, which SVG renders as a dot in the top-left corner.
	const pins = $derived(
		markers
			.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
			.map((m, i) => {
				const [x, y] = project([m.lng, m.lat]);
				return { ...m, x, y, i };
			})
	);
	// Leg i runs from pin i to pin i+1, and is styled by the mode of the pin it
	// ARRIVES at — that is the journey the operator described for that day.
	const legs = $derived(
		route
			? pins.slice(1).map((p, i) => ({
					d: legPath([pins[i].x, pins[i].y], [p.x, p.y], LEG_BOW[p.mode ?? 'NONE']),
					mode: p.mode ?? null,
					key: i
				}))
			: []
	);

	const usedModes = $derived([...new Set(legs.map((l) => l.mode).filter(Boolean))] as string[]);

	let hovered = $state<string | null>(null);
</script>

<div class="mk-map {className}" class:is-interactive={interactive}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<svg
		bind:this={svgEl}
		viewBox="0 0 {project.width} {project.height}"
		role="img"
		aria-label={ariaLabel}
		preserveAspectRatio="xMidYMid meet"
		class:is-picking={!!onmapclick}
		onclick={onmapclick
			? (e) => {
					const p = pointAt(e);
					if (p) onmapclick(p);
				}
			: undefined}
	>
		<defs>
			<filter id="{uid}-pin" x="-50%" y="-50%" width="200%" height="200%">
				<feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.35" />
			</filter>
			<marker
				id="{uid}-arrow"
				viewBox="0 0 10 10"
				refX="8"
				refY="5"
				markerWidth="5"
				markerHeight="5"
				orient="auto-start-reverse"
			>
				<path d="M0 0 L10 5 L0 10 z" fill="var(--map-route, #c8553d)" />
			</marker>
		</defs>

		<rect width="100%" height="100%" fill="var(--map-sea, #eef4f7)" />

		<g class="mk-map__land">
			{#each regions as r (r.slug)}
				{#if interactive}
					<path
						d={r.d}
						class="mk-map__region"
						class:is-active={active.has(r.slug)}
						class:is-hovered={hovered === r.slug}
						style={regionColors?.[r.slug] ? `fill:${regionColors[r.slug]}` : undefined}
						role="button"
						tabindex="0"
						aria-label={r.name}
						onmouseenter={() => (hovered = r.slug)}
						onmouseleave={() => (hovered = null)}
						onfocus={() => (hovered = r.slug)}
						onblur={() => (hovered = null)}
						onclick={() => onselect?.(r.slug)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onselect?.(r.slug);
							}
						}}
					/>
				{:else}
					<path
						d={r.d}
						class="mk-map__region"
						class:is-active={active.has(r.slug)}
						style={regionColors?.[r.slug] ? `fill:${regionColors[r.slug]}` : undefined}
					/>
				{/if}
			{/each}
		</g>

		{#each lakes as l (l.name)}
			<path d={l.d} class="mk-map__lake" />
		{/each}

		<path d={outline} class="mk-map__outline" />

		{#if legs.length}
			<g class="mk-map__route">
				{#each legs as leg (leg.key)}
					<path
						d={leg.d}
						class={leg.mode ? `is-${leg.mode.toLowerCase()}` : 'is-unstated'}
						marker-end="url(#{uid}-arrow)"
					/>
				{/each}
			</g>
		{/if}

		{#if showRegionLabels}
			<g class="mk-map__labels">
				{#each regions as r (r.slug)}
					{#if !highlight.length || active.has(r.slug)}
						<text x={r.label[0]} y={r.label[1]} class:is-active={active.has(r.slug)}>{r.name}</text>
					{/if}
				{/each}
			</g>
		{/if}

		<g class="mk-map__pins">
			{#each pins as p (p.i)}
				<g class="mk-map__pin mk-map__pin--{p.kind ?? 'stop'}" filter="url(#{uid}-pin)">
					<circle cx={p.x} cy={p.y} r={p.kind === 'place' ? 6.5 : 5.5} />
					{#if p.kind !== 'place' && route}
						<text x={p.x} y={p.y + 2.6} class="mk-map__pin-n">{p.i + 1}</text>
					{/if}
				</g>
				{#if p.badge}
					<text x={p.x + 9} y={p.y + 3.5} class="mk-map__badge">{p.badge}</text>
				{/if}
			{/each}
		</g>

		{#if interactive && hovered}
			{@const r = regions.find((x) => x.slug === hovered)}
			{#if r}
				<text x={r.label[0]} y={r.label[1]} class="mk-map__tip">{r.name}</text>
			{/if}
		{/if}
	</svg>
</div>

<style>
	.mk-map {
		width: 100%;
	}
	.mk-map svg {
		display: block;
		width: 100%;
		height: auto;
		border-radius: var(--map-radius, 6px);
		overflow: hidden;
	}
	.mk-map svg.is-picking {
		cursor: crosshair;
	}

	.mk-map__region {
		fill: var(--map-land, #dfe6df);
		stroke: var(--map-border, #ffffff);
		stroke-width: 0.6;
		stroke-linejoin: round;
		transition: fill 0.15s ease;
	}
	.mk-map__region.is-active {
		fill: var(--map-land-active, #e6c3ba);
		stroke: var(--map-land-active-edge, #c8553d);
		stroke-width: 1;
	}
	.is-interactive .mk-map__region {
		cursor: pointer;
		outline: none;
	}
	.is-interactive .mk-map__region.is-hovered {
		fill: var(--map-land-hover, #b9c7b9);
	}
	.is-interactive .mk-map__region.is-active.is-hovered {
		fill: var(--map-land-active-hover, #dcb0a5);
	}

	.mk-map__lake {
		fill: var(--map-water, #cfe1ea);
		stroke: var(--map-water-edge, #b9d3df);
		stroke-width: 0.4;
		pointer-events: none;
	}

	.mk-map__outline {
		fill: none;
		stroke: var(--map-outline, #9aa89a);
		stroke-width: 1;
		stroke-linejoin: round;
		stroke-linecap: round;
		pointer-events: none;
	}

	.mk-map__route path {
		fill: none;
		stroke: var(--map-route, #c8553d);
		stroke-width: 1.8;
		stroke-linecap: round;
		pointer-events: none;
	}
	/* Solid ground, dashes for air, dots for water — readable before the legend. */
	.mk-map__route path.is-drive {
		stroke-dasharray: none;
	}
	.mk-map__route path.is-fly {
		stroke-dasharray: 6 5;
	}
	.mk-map__route path.is-boat {
		stroke-dasharray: 1.5 4;
	}
	.mk-map__route path.is-unstated {
		stroke-dasharray: 4 3.5;
		opacity: 0.75;
	}

	.mk-map__pin circle {
		fill: var(--map-pin, #c8553d);
		stroke: #fff;
		stroke-width: 1.6;
	}
	.mk-map__pin--start circle {
		fill: var(--map-pin-start, #2f6f4e);
	}
	.mk-map__pin--end circle {
		fill: var(--map-pin-end, #1f2937);
	}
	.mk-map__pin-n {
		fill: #fff;
		font-size: 6.5px;
		font-weight: 700;
		text-anchor: middle;
		pointer-events: none;
	}

	.mk-map__badge {
		font-size: 9.5px;
		font-weight: 600;
		fill: var(--map-label, #37404a);
		paint-order: stroke;
		stroke: var(--map-sea, #eef4f7);
		stroke-width: 2.6;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.mk-map__labels text {
		font-size: 7px;
		fill: var(--map-label-muted, #7a857a);
		text-anchor: middle;
		paint-order: stroke;
		stroke: var(--map-land, #dfe6df);
		stroke-width: 2.2;
		stroke-linejoin: round;
		pointer-events: none;
	}
	.mk-map__labels text.is-active {
		fill: var(--map-label, #37404a);
		stroke: var(--map-land-active, #e6c3ba);
		font-weight: 700;
	}

	.mk-map__tip {
		font-size: 9px;
		font-weight: 700;
		text-anchor: middle;
		fill: var(--map-label, #37404a);
		paint-order: stroke;
		stroke: #fff;
		stroke-width: 3;
		stroke-linejoin: round;
		pointer-events: none;
	}
</style>
