/**
 * Tanzania basemap: decoding, projection and SVG path building.
 *
 * There is no map library and no tile server here on purpose. The basemap is
 * ~37 KB gzipped of national geometry built once from the NBS district
 * shapefile, so a map is a plain <svg> — no API key to leak, no third-party
 * request on a page we tell operators is theirs, and it renders identically in
 * the marketplace (Bootstrap) and in Connect (Tailwind).
 *
 * Geometry is stored as SHARED ARCS: a boundary between two regions exists once
 * and both reference it. That is what stops simplification from opening hairline
 * gaps between neighbours, and it halves the payload.
 */

export type LngLat = [number, number];

/** A pin on the map: a stop on a route, or the place a page is about. */
export interface MapMarker {
	lat: number;
	lng: number;
	label?: string;
	/** "Day 1-2" style text set beside the pin. */
	badge?: string;
	kind?: 'stop' | 'start' | 'end' | 'place';
	href?: string;
}

export type BBox = [number, number, number, number];

export interface RegionEntry {
	name: string;
	official: string;
	slug: string;
	/** Label anchor — the centroid of the region's largest ring. */
	c: LngLat;
	bbox: BBox;
	/** Rings of arc references; a negative ref `~i` means arc i reversed. */
	rings: number[][];
}

export interface BasemapDoc {
	transform: { scale: [number, number]; translate: [number, number] };
	bbox: BBox;
	arcs: [number, number][][];
	regions: RegionEntry[];
	outline: number[];
	lakes: { name: string; ring: [number, number][] }[];
}

/** Delta-decode one quantised arc back to absolute lon/lat. */
function decodeArc(doc: BasemapDoc, arc: [number, number][]): LngLat[] {
	const { scale, translate } = doc.transform;
	const out: LngLat[] = [];
	let x = 0;
	let y = 0;
	for (const [dx, dy] of arc) {
		x += dx;
		y += dy;
		out.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
	}
	return out;
}

export interface DecodedBasemap {
	arcs: LngLat[][];
	doc: BasemapDoc;
	lakes: { name: string; ring: LngLat[] }[];
}

export function decodeBasemap(doc: BasemapDoc): DecodedBasemap {
	return {
		doc,
		arcs: doc.arcs.map((a) => decodeArc(doc, a)),
		lakes: doc.lakes.map((l) => ({ name: l.name, ring: decodeArc(doc, l.ring) }))
	};
}

/** Stitch a ring's arc references into one continuous coordinate list. */
function ringCoords(map: DecodedBasemap, refs: number[]): LngLat[] {
	const out: LngLat[] = [];
	for (const ref of refs) {
		const reversed = ref < 0;
		const arc = map.arcs[reversed ? ~ref : ref];
		if (!arc) continue;
		const seg = reversed ? [...arc].reverse() : arc;
		for (let i = out.length ? 1 : 0; i < seg.length; i++) out.push(seg[i]);
	}
	return out;
}

/* --------------------------------------------------------------- projection */

const RAD = Math.PI / 180;

/** Spherical Mercator, in degree-like units so both axes scale together. */
function mercY(lat: number): number {
	const clamped = Math.max(-85, Math.min(85, lat));
	return Math.log(Math.tan(Math.PI / 4 + (clamped * RAD) / 2)) / RAD;
}

export interface Projection {
	(p: LngLat): [number, number];
	width: number;
	height: number;
	/** Screen point back to lon/lat, so a click can place a pin. */
	invert: (xy: [number, number]) => LngLat;
}

/**
 * Fit `bounds` into a `width`-wide box, letting the height follow from the
 * shape of the country rather than being told what it should be. Tanzania is
 * slightly wider than tall, and forcing a square would letterbox it.
 */
export function fitProjection(bounds: BBox, width: number, padding = 8): Projection {
	const [minLon, minLat, maxLon, maxLat] = bounds;
	// Mercator y grows NORTHWARD and SVG y grows DOWNWARD, so the vertical axis
	// is measured down from the top edge rather than up from the bottom.
	const yTop = mercY(maxLat);
	const yBottom = mercY(minLat);
	const spanX = Math.max(maxLon - minLon, 1e-9);
	const spanY = Math.max(yTop - yBottom, 1e-9);
	const inner = width - padding * 2;
	const k = inner / spanX;
	const height = spanY * k + padding * 2;
	const project = ((p: LngLat) => [
		padding + (p[0] - minLon) * k,
		padding + (yTop - mercY(p[1])) * k
	]) as Projection;
	project.width = width;
	project.height = height;
	project.invert = ([x, y]: [number, number]): LngLat => [
		minLon + (x - padding) / k,
		// The inverse of the Mercator used above, so a click lands where it looks.
		(2 * Math.atan(Math.exp((yTop - (y - padding) / k) * RAD)) - Math.PI / 2) / RAD
	];
	return project;
}

/** Grow a bbox by a ratio of its own size, so pins never sit on the edge. */
/**
 * Grow a bbox so pins never sit on the edge.
 *
 * `minSpan` matters more than the ratio: Zanzibar Urban West is about a third of
 * a degree across, and fitted tightly it renders as an abstract blob. Holding a
 * floor of roughly 1.6 degrees keeps enough coastline in frame to say WHERE the
 * place is, which is the only reason the map is on the page.
 */
export function padBBox(b: BBox, ratio = 0.18, minSpan = 1.6): BBox {
	const w = Math.max(b[2] - b[0], minSpan);
	const h = Math.max(b[3] - b[1], minSpan);
	const cx = (b[0] + b[2]) / 2;
	const cy = (b[1] + b[3]) / 2;
	const dx = (w * (1 + ratio)) / 2;
	const dy = (h * (1 + ratio)) / 2;
	return [cx - dx, cy - dy, cx + dx, cy + dy];
}

export function boundsOf(points: LngLat[], fallback: BBox): BBox {
	if (!points.length) return fallback;
	let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [x, y] of points) {
		if (x < a) a = x;
		if (y < b) b = y;
		if (x > c) c = x;
		if (y > d) d = y;
	}
	return [a, b, c, d];
}

/* ------------------------------------------------------------- path building */

function toPath(coords: LngLat[], project: Projection, close: boolean): string {
	if (coords.length < 2) return '';
	let d = '';
	let px = NaN;
	let py = NaN;
	for (let i = 0; i < coords.length; i++) {
		const [x, y] = project(coords[i]);
		const rx = Math.round(x * 10) / 10;
		const ry = Math.round(y * 10) / 10;
		// Drop points that land on the same tenth of a pixel as the last one.
		if (i && rx === px && ry === py) continue;
		d += `${i ? 'L' : 'M'}${rx} ${ry}`;
		px = rx;
		py = ry;
	}
	return close ? `${d}Z` : d;
}

export interface RegionShape {
	slug: string;
	name: string;
	official: string;
	d: string;
	label: [number, number];
	bbox: BBox;
}

export function regionShapes(map: DecodedBasemap, project: Projection): RegionShape[] {
	return map.doc.regions.map((r) => ({
		slug: r.slug,
		name: r.name,
		official: r.official,
		bbox: r.bbox,
		label: project(r.c),
		d: r.rings.map((refs) => toPath(ringCoords(map, refs), project, true)).join('')
	}));
}

export function outlinePath(map: DecodedBasemap, project: Projection): string {
	return map.doc.outline.map((i) => toPath(map.arcs[i] ?? [], project, false)).join('');
}

export function lakePaths(map: DecodedBasemap, project: Projection) {
	return map.lakes.map((l) => ({ name: l.name, d: toPath(l.ring, project, true) }));
}

/* ------------------------------------------------------------------ routing */

/**
 * A gently curved connector between two stops.
 *
 * Straight segments across a country read as a chart; a consistent arc reads as
 * a journey. The bow is perpendicular to the leg and always bends the same way,
 * so a multi-stop route stays legible instead of zig-zagging.
 */
export function legPath(a: [number, number], b: [number, number], bow = 0.16): string {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const mx = (a[0] + b[0]) / 2;
	const my = (a[1] + b[1]) / 2;
	const len = Math.hypot(dx, dy) || 1;
	const cx = mx - (dy / len) * len * bow;
	const cy = my + (dx / len) * len * bow;
	const r = (n: number) => Math.round(n * 10) / 10;
	return `M${r(a[0])} ${r(a[1])}Q${r(cx)} ${r(cy)} ${r(b[0])} ${r(b[1])}`;
}

/** Point-in-polygon, used to name the region a coordinate falls in. */
export function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

export function regionAt(map: DecodedBasemap, pt: LngLat): RegionEntry | null {
	for (const r of map.doc.regions) {
		if (pt[0] < r.bbox[0] || pt[0] > r.bbox[2] || pt[1] < r.bbox[1] || pt[1] > r.bbox[3]) continue;
		for (const refs of r.rings) {
			if (pointInRing(pt, ringCoords(map, refs))) return r;
		}
	}
	return null;
}
