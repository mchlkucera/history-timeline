#!/usr/bin/env python3
"""Pack historical-basemaps GeoJSON into compact delta-encoded worlds.js.

LOCAL CORRECTIONS TO THE VENDORED ATLAS. geo/*.geojson is a copy of the
upstream historical-basemaps data, and the labels are whatever it shipped —
including its misspellings, which the app then engraves on the map. Anything
fixed by hand is listed here so a re-import does not quietly restore it:

  · world_1600.geojson — "Poland-Llituania" -> "Poland-Lithuania" (NAME,
    ABBREVN, SUBJECTO, PARTOF). It is the only snapshot that spelt it that way;
    world_1492.geojson already had it right. web/scripts/build-polities.mjs
    keeps the misspelling in its alias list for the commonwealth, so the join
    survives either spelling.
"""
import json, glob, os, re

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geo')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'prototypes', 'worlds.js')

def ring_area(r):
    a = 0
    for i in range(len(r) - 1):
        a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return abs(a / 2)

def pack_ring(r, prec=1):
    m = 10 ** prec
    pts, last = [], None
    for x, y in r:
        xi, yi = round(x * m), round(y * m)
        if (xi, yi) != last:
            pts.append((xi, yi)); last = (xi, yi)
    if len(pts) < 4:
        return None
    flat = [pts[0][0], pts[0][1]]
    for i in range(1, len(pts)):
        flat += [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]
    return flat

worlds = {}
for fp in sorted(glob.glob(os.path.join(D, 'world_*.geojson'))):
    tag = re.match(r'world_(bc)?(\d+)\.geojson', os.path.basename(fp))
    year = int(tag.group(2)) * (-1 if tag.group(1) else 1)
    d = json.load(open(fp))
    feats = []
    for ft in d['features']:
        p, g = ft['properties'], ft.get('geometry')
        if not g:
            continue
        name = p.get('NAME') or '?'
        sov = p.get('SUBJECTO') or p.get('PARTOF') or name
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = []
        for poly in polys:
            if ring_area(poly[0]) < 0.5:
                continue
            pr = pack_ring(poly[0])
            if pr:
                rings.append(pr)
            for hole in poly[1:]:
                if ring_area(hole) > 3.0:
                    ph = pack_ring(hole)
                    if ph:
                        rings.append(ph)
        if rings:
            feats.append([name, sov if sov != name else 0, rings])
    worlds[year] = feats

with open(OUT, 'w') as fh:
    fh.write('const WORLDS=' + json.dumps(worlds, separators=(',', ':')) + ';')
print(f'{len(worlds)} years, {sum(len(v) for v in worlds.values())} features -> {os.path.getsize(OUT)/1024/1024:.1f} MB')
