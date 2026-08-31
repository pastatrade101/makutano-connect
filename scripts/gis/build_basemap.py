"""Build a web-ready Tanzania basemap from the NBS district shapefile.

Districts are dissolved into the 31 regions by edge cancellation, then the
region boundaries are cut into ARCS (maximal runs sharing the same pair of
neighbouring regions). Each arc is simplified ONCE and reused by both regions
that touch it, so simplification can never open a gap or an overlap between
neighbours. This is the TopoJSON idea, done inline so the output can stay
plain GeoJSON that the browser reads with no client library.
"""
import sys, json, math
from collections import defaultdict
sys.path.insert(0, '/private/tmp/claude-501/-Users-pastoryjoseph-Desktop-tour-site/35dc8473-ea6c-480d-9630-8589e7d3e116/scratchpad')
from shpread import read_dbf, read_shp

BASE = '/private/tmp/claude-501/-Users-pastoryjoseph-Desktop-tour-site/35dc8473-ea6c-480d-9630-8589e7d3e116/scratchpad/gis/'
TOL  = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0015
Q    = 6   # snap grid decimals, to make shared vertices compare equal

def snap(p): return (round(p[0], Q), round(p[1], Q))

def shoelace(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2.0

def dp(pts, tol):
    """Iterative Douglas-Peucker; always keeps both endpoints."""
    if len(pts) < 3: return pts[:]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1: continue
        x1, y1 = pts[i]; x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            x0, y0 = pts[k]
            d = (abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / den) if den else math.hypot(x0 - x1, y0 - y1)
            if d > best: best, bi = d, k
        if best > tol:
            keep[bi] = True; stack.append((i, bi)); stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]

# ---------------------------------------------------------------- load
_, rows = read_dbf(BASE + 'Districts and TC as 2020.dbf'.join(['districts/', '']))
shp     = read_shp(BASE + 'districts/Districts and TC as 2020.shp')
region_of = [r['Region_Nam'] for r in rows]

# undirected edge -> set of regions touching it
edge_regions = defaultdict(set)
edge_count   = defaultdict(int)
for reg, (_st, rings) in zip(region_of, shp):
    for ring in rings:
        pts = [snap(p) for p in ring]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if a == b: continue
            e = (a, b) if a <= b else (b, a)
            edge_regions[e].add(reg); edge_count[e] += 1

# ---------------------------------------------------------------- dissolve
def dissolve(region):
    """Rings of one region: keep edges not shared by two districts of it."""
    own = defaultdict(int)
    for reg, (_st, rings) in zip(region_of, shp):
        if reg != region: continue
        for ring in rings:
            pts = [snap(p) for p in ring]
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]
                if a == b: continue
                own[(a, b) if a <= b else (b, a)] += 1
    boundary = [e for e, c in own.items() if c == 1]
    adj = defaultdict(list)
    for a, b in boundary:
        adj[a].append(b); adj[b].append(a)
    used, rings_out = set(), []
    for start in list(adj):
        for nxt in adj[start]:
            e = (start, nxt) if start <= nxt else (nxt, start)
            if e in used: continue
            ring, cur, prev = [start], nxt, start
            used.add(e)
            while cur != start:
                ring.append(cur)
                opts = [v for v in adj[cur] if v != prev and
                        ((cur, v) if cur <= v else (v, cur)) not in used]
                if not opts: break
                nx = opts[0]
                used.add((cur, nx) if cur <= nx else (nx, cur))
                prev, cur = cur, nx
            ring.append(start)
            if len(ring) > 3: rings_out.append(ring)
    return rings_out

regions = sorted({r for r in region_of})
raw = {reg: dissolve(reg) for reg in regions}

# validate: dissolved area must match the sum of its districts' areas
ok = True
for reg in regions:
    da = sum(abs(shoelace([snap(p) for p in ring]))
             for r, (_s, rr) in zip(region_of, shp) if r == reg for ring in rr)
    ra = sum(abs(shoelace(x)) for x in raw[reg])
    if da == 0 or abs(ra - da) / da > 0.02:
        print(f"  !! {reg}: dissolved {ra:.4f} vs districts {da:.4f}"); ok = False
print(f"dissolve validation: {'PASS' if ok else 'FAIL'}  ({sum(len(v) for v in raw.values())} rings)")

# ---------------------------------------------------------------- arcs
def key_of(a, b):
    e = (a, b) if a <= b else (b, a)
    rs = edge_regions.get(e)
    return frozenset(rs) if rs else frozenset()

arc_cache, arc_pts = {}, {}
def arc_id(pts):
    """Canonical id for an arc regardless of direction."""
    fwd, rev = (pts[0], pts[-1], len(pts)), (pts[-1], pts[0], len(pts))
    if fwd in arc_cache: return arc_cache[fwd], False
    if rev in arc_cache: return arc_cache[rev], True
    i = len(arc_pts); arc_cache[fwd] = i; arc_pts[i] = pts
    return i, False

def cut(ring):
    """Split a ring into arcs at every change of neighbouring-region set."""
    n = len(ring) - 1
    keys = [key_of(ring[i], ring[i + 1]) for i in range(n)]
    if len(set(keys)) == 1:
        return [(ring, keys[0])]
    start = next(i for i in range(n) if keys[i] != keys[i - 1])
    out, cur, ck = [], [ring[start]], keys[start]
    for s in range(n):
        i = (start + s) % n
        if keys[i] != ck:
            out.append((cur, ck)); cur, ck = [cur[-1]], keys[i]
        cur.append(ring[(i + 1) % n])
    out.append((cur, ck))
    return out

region_rings, all_keys = {}, {}
for reg in regions:
    rr = []
    for ring in raw[reg]:
        ids = []
        for pts, k in cut(ring):
            i, rev = arc_id(pts); ids.append((i, rev)); all_keys[i] = k
        rr.append(ids)
    region_rings[reg] = rr

simplified = {i: dp(p, TOL) for i, p in arc_pts.items()}
before = sum(len(p) for p in arc_pts.values()); after = sum(len(p) for p in simplified.values())
print(f"arcs: {len(arc_pts)}  points {before} -> {after}  ({100*after/before:.1f}%)")

def build(ids):
    out = []
    for i, rev in ids:
        seg = simplified[i][::-1] if rev else simplified[i]
        out.extend(seg[1:] if out else seg)
    if out and out[0] != out[-1]: out.append(out[0])
    return out


NAMES = {'Dar-es-salaam':'Dar es Salaam','Kaskazini Pemba':'Pemba North',
         'Kusini Pemba':'Pemba South','Kaskazini Unguja':'Zanzibar North',
         'Kusini Unguja':'Zanzibar South','Mjini Magharibi':'Zanzibar Urban West'}
def slugify(s):
    out=''.join(c if c.isalnum() else '-' for c in s.lower())
    while '--' in out: out=out.replace('--','-')
    return out.strip('-')

# ---- quantise every arc onto one shared integer grid, then delta-encode.
allpts=[p for a in simplified.values() for p in a]
minx=min(p[0] for p in allpts); maxx=max(p[0] for p in allpts)
miny=min(p[1] for p in allpts); maxy=max(p[1] for p in allpts)
GRID=20000
sx=(maxx-minx)/GRID; sy=(maxy-miny)/GRID
def qz(pts):
    out,px,py=[],0,0
    for x,y in pts:
        ix=int(round((x-minx)/sx)); iy=int(round((y-miny)/sy))
        out.append([ix-px,iy-py]); px,py=ix,iy
    return out
# drop arcs that collapse to nothing after quantisation
enc_arcs=[qz(simplified[i]) for i in range(len(simplified))]

def ring_refs(ids):
    return [(~i if rev else i) for i,rev in ids]

# ---- regional statistics, from the NBS census layer.
#
# Deliberately only area, population and density. The same table carries HIV
# prevalence, sex ratio and an age breakdown; none of that belongs on a page
# inviting somebody to visit a place, and publishing it there would be both
# irrelevant and stigmatising.
#
# 2012 CENSUS. The layer has 30 regions: Songwe was split out of Mbeya in 2016,
# so Songwe has no figures and Mbeya's still include it. Both facts are carried
# through to the page rather than smoothed over.
_, statrows = read_dbf(BASE + 'gismaps/Tanzania GIS Maps/Tanzania.dbf')
STATS = {}
for r in statrows:
    name = (r.get('REGION') or '').strip()
    if not name:
        continue
    STATS[name] = {
        'area': int(r['AREA']) if r.get('AREA') else None,
        'population': int(r['POPULATION']) if r.get('POPULATION') else None,
        'density': float(r['POP_DENSIT']) if r.get('POP_DENSIT') else None,
        'source': '2012 Census',
    }
# Mbeya's 2012 figures still contain the districts that became Songwe.
if 'Mbeya' in STATS:
    STATS['Mbeya']['note'] = 'Includes the districts that became Songwe Region in 2016.'

# ---- tourism circuits.
#
# The seven circuits are how the industry — and every operator — actually talks
# about Tanzania: "the northern circuit", "the southern circuit". Administrative
# regions are what the shapefile knows; circuits are what a traveller is
# choosing between, so the map carries both and leads with the circuit.
import os as _os
CIRC_PATH = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'circuits.json')
if not _os.path.exists(CIRC_PATH):
    CIRC_PATH = '/Users/pastoryjoseph/Desktop/pastatrade/makutano-connect/scripts/gis/circuits.json'
CIRC = json.load(open(CIRC_PATH, encoding='utf-8'))

feats,country=[],[]
for reg in regions:
    rings=[ring_refs(ids) for ids in region_rings[reg] if len(build(ids))>=4]
    if not rings: continue
    polys=[build(ids) for ids in region_rings[reg] if len(build(ids))>=4]
    big=max(polys,key=lambda r:abs(shoelace(r)))
    xs=[p[0] for r in polys for p in r]; ys=[p[1] for r in polys for p in r]
    a=shoelace(big) or 1e-9
    cx=sum((big[i][0]+big[i+1][0])*(big[i][0]*big[i+1][1]-big[i+1][0]*big[i][1]) for i in range(len(big)-1))/(6*a)
    cy=sum((big[i][1]+big[i+1][1])*(big[i][0]*big[i+1][1]-big[i+1][0]*big[i][1]) for i in range(len(big)-1))/(6*a)
    disp=NAMES.get(reg,reg)
    entry = {'name':disp,'official':reg,'slug':slugify(disp),
             'c':[round(cx,4),round(cy,4)],
             'bbox':[round(min(xs),4),round(min(ys),4),round(max(xs),4),round(max(ys),4)],
             'rings':rings}
    if reg in STATS:
        entry['stats'] = STATS[reg]
    # Circuit membership and the editorial notes, keyed on the OFFICIAL name so
    # renaming a region for display cannot silently orphan its content.
    # The shapefile writes "Dar-es-salaam"; the editorial file writes it the way
    # a person does. Matched on a normalised key so neither has to change.
    def _key(n): return ''.join(ch for ch in n.lower() if ch.isalnum())
    ed = CIRC['regions'].get(reg) or next(
        (v for k, v in CIRC['regions'].items() if _key(k) == _key(reg)), None)
    if ed:
        entry['circuit'] = ed['circuit']
        if ed.get('highlights'): entry['highlights'] = ed['highlights']
        if ed.get('gateway'): entry['gateway'] = ed['gateway']
        if ed.get('note'): entry['note'] = ed['note']
    feats.append(entry)
    for ids in region_rings[reg]:
        for i,_ in ids:
            if len(all_keys.get(i,()))<2 and i not in country: country.append(i)

# ---- lakes (Arc 1960 datum; the shift is sub-pixel at these zooms)
_,wrows=read_dbf(BASE+'districts/water_bodies.dbf')
wshp=read_shp(BASE+'districts/water_bodies.shp')
SKIP={'Bahari ya Hindi'}
lakes=[]
for row,(st,rings) in zip(wrows,wshp):
    nm=(row.get('Ziwa') or row.get('LAKES') or '').strip()
    if not nm or nm in SKIP or not rings: continue
    big=max(rings,key=lambda r:abs(shoelace([(x,y) for x,y in r])))
    sm=dp([(x,y) for x,y in big],TOL*1.5)
    if len(sm)<4: continue
    lakes.append({'name':nm.replace('Ziwa ','Lake ').replace('Bwawa la ','Lake '),'ring':qz(sm)})
lakes.sort(key=lambda l:-len(l['ring']))

doc={'circuits':CIRC['circuits'],
     'transform':{'scale':[sx,sy],'translate':[minx,miny]},
     'bbox':[round(minx,4),round(miny,4),round(maxx,4),round(maxy,4)],
     'arcs':enc_arcs,'regions':feats,'outline':country,'lakes':lakes}
import json,os
out='/private/tmp/claude-501/-Users-pastoryjoseph-Desktop-tour-site/35dc8473-ea6c-480d-9630-8589e7d3e116/scratchpad/out'
os.makedirs(out,exist_ok=True)
json.dump(doc,open(out+'/tz-basemap.json','w'),separators=(',',':'))
import gzip
raw=open(out+'/tz-basemap.json','rb').read()
print(f"regions={len(feats)} arcs={len(enc_arcs)} lakes={len(lakes)} outlineArcs={len(country)}")
print(f"with statistics: {sum(1 for f in feats if 'stats' in f)}/{len(feats)}  (Songwe post-dates the census)")
print(f"with a circuit:  {sum(1 for f in feats if 'circuit' in f)}/{len(feats)}")
print(f"raw={len(raw)/1024:.1f} KB  gzip={len(gzip.compress(raw,9))/1024:.1f} KB")
print("lakes:", ", ".join(l['name'] for l in lakes[:8]))
