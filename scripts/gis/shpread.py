"""Minimal, dependency-free ESRI Shapefile (.shp) + dBase (.dbf) reader.

Only what we need: Polygon(5), PolyLine(3), Point(1) and their Z/M variants,
plus dBase III field parsing. Written because pyshp/gdal are unavailable and
PEP 668 blocks installing them.
"""
import struct, math

def read_dbf(path):
    with open(path, 'rb') as f:
        buf = f.read()
    nrec, hlen, rlen = struct.unpack('<IHH', buf[4:12])
    fields, off = [], 32
    while buf[off] != 0x0D:
        raw = buf[off:off + 32]
        name = raw[:11].split(b'\x00')[0].decode('latin-1').strip()
        ftype = chr(raw[11]); flen = raw[16]
        fields.append((name, ftype, flen)); off += 32
    rows = []
    for i in range(nrec):
        base = hlen + i * rlen
        rec = buf[base:base + rlen]
        if not rec or rec[:1] == b'*':      # deleted
            continue
        pos, row = 1, {}
        for name, ftype, flen in fields:
            val = rec[pos:pos + flen].decode('latin-1').strip(); pos += flen
            if ftype in 'NF' and val not in ('', '-'):
                try: val = float(val) if '.' in val else int(val)
                except ValueError: pass
            row[name] = val
        rows.append(row)
    return [f[0] for f in fields], rows

def read_shp(path):
    """Yield (shape_type, [ring/part as [(x,y),...], ...]) per record."""
    with open(path, 'rb') as f:
        buf = f.read()
    total = struct.unpack('>I', buf[24:28])[0] * 2
    off, out = 100, []
    while off < total:
        clen = struct.unpack('>I', buf[off + 4:off + 8])[0] * 2
        body = buf[off + 8: off + 8 + clen]
        off += 8 + clen
        if len(body) < 4:
            out.append((0, [])); continue
        st = struct.unpack('<i', body[:4])[0]
        if st == 0:
            out.append((0, [])); continue
        if st in (1, 11, 21):                        # Point / PointZ / PointM
            x, y = struct.unpack('<2d', body[4:20])
            out.append((st, [[(x, y)]])); continue
        if st in (3, 5, 13, 15, 23, 25):             # PolyLine / Polygon (+Z/M)
            nparts, npts = struct.unpack('<2i', body[36:44])
            parts = struct.unpack('<%di' % nparts, body[44:44 + 4 * nparts])
            pbase = 44 + 4 * nparts
            coords = struct.unpack('<%dd' % (2 * npts), body[pbase:pbase + 16 * npts])
            pts = list(zip(coords[0::2], coords[1::2]))
            rings = [pts[parts[i]: (parts[i + 1] if i + 1 < nparts else npts)]
                     for i in range(nparts)]
            out.append((st, rings)); continue
        out.append((st, []))
    return out

# --- inverse UTM (WGS84) for the Tanzania.shp layer, zone 37 south ---
_A, _F = 6378137.0, 1 / 298.257223563
def utm_to_lonlat(x, y, zone=37, south=True):
    e2 = _F * (2 - _F); e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    x -= 500000.0
    if south: y -= 10000000.0
    m = y / 0.9996
    mu = m / (_A * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    p = (mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
            + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
            + (151 * e1**3 / 96) * math.sin(6 * mu))
    ep2 = e2 / (1 - e2)
    c1 = ep2 * math.cos(p)**2; t1 = math.tan(p)**2
    n1 = _A / math.sqrt(1 - e2 * math.sin(p)**2)
    r1 = _A * (1 - e2) / (1 - e2 * math.sin(p)**2)**1.5
    d = x / (n1 * 0.9996)
    lat = p - (n1 * math.tan(p) / r1) * (d**2 / 2 - (5 + 3*t1 + 10*c1 - 4*c1**2 - 9*ep2) * d**4 / 24
              + (61 + 90*t1 + 298*c1 + 45*t1**2 - 252*ep2 - 3*c1**2) * d**6 / 720)
    lon = (d - (1 + 2*t1 + c1) * d**3 / 6
             + (5 - 2*c1 + 28*t1 - 3*c1**2 + 8*ep2 + 24*t1**2) * d**5 / 120) / math.cos(p)
    return math.degrees(lon) + (zone * 6 - 183), math.degrees(lat)
