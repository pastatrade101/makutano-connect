# Tanzania basemap

`static/geo/tz-basemap.json` is generated from official National Bureau of
Statistics shapefiles, not hand-drawn and not traced from a tile provider.

## Source

| Layer | File | Projection |
|---|---|---|
| Districts and Town Councils, 2020 | `Districts and TC as 2020.shp` | WGS84 geographic |
| Water bodies | `water_bodies.shp` | Arc 1960 geographic |

The district layer carries `Region_Nam`, so the 31 regions are produced by
DISSOLVING districts rather than by trusting a separate region layer that was a
census older than the current region list. The build asserts that each dissolved
region's area matches the sum of its districts' areas to within 2%.

The water layer is Arc 1960; the datum shift against WGS84 in Tanzania is a few
hundred metres, which is sub-pixel at every zoom this map is used at.

## Why arcs

Neighbouring regions share a boundary. If each region were simplified on its
own, the shared boundary would be simplified twice, differently, and hairline
gaps would open between neighbours. So boundaries are cut into ARCS — maximal
runs sharing the same pair of neighbouring regions — and each arc is simplified
once and referenced by both sides. This is the idea behind TopoJSON, done inline
so the runtime stays a plain `<svg>` with no client library.

## Rebuild

    python3 scripts/gis/build_basemap.py 0.003 > /dev/null

The argument is the Douglas-Peucker tolerance in degrees. 0.003 ≈ 330 m, which
is well under a pixel on a 640 px-wide national map and about one pixel on a
single-region map. Output is ~115 KB raw, ~37 KB gzipped, for 31 regions,
18 lakes and the coastline.

Edit the paths at the top of the script if the shapefiles move.
