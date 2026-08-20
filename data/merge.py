#!/usr/bin/env python3
"""Merge curated agent JSON into datasets.js for the Timeline lab."""
import json, glob, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(D), 'prototypes', 'partA.html')

def load(name):
    p = os.path.join(D, name)
    if not os.path.exists(p):
        print(f'  ! missing {name}', file=sys.stderr); return None
    try:
        return json.load(open(p))
    except Exception as e:
        print(f'  ! bad JSON in {name}: {e}', file=sys.stderr); return None

# ---- event titles (join key) -------------------------------------------------
html = open(SRC).read()
block = html.split('const EVENTS=[', 1)[1].split('\n];', 1)[0]
titles = re.findall(r'^\[[^,]+,[^,]+,"((?:[^"\\]|\\.)*)"', block, re.M)
titles = [t.replace('\\"', '"') for t in titles]
print(f'{len(titles)} event titles parsed')

# ---- categories --------------------------------------------------------------
CATS = {'power','war','belief','sci','art','nature','society','reach'}
TYPES = {'moment','episode','life','zone','era'}

# renames let a title be edited in partA without orphaning the classifier/geocoder joins
_ov = json.load(open(os.path.join(D, 'overrides.json'))) if os.path.exists(os.path.join(D, 'overrides.json')) else {}
RENAME = _ov.get('rename') or {}
rename = lambda t: RENAME.get(t, t)

catmap, seen, bad = {}, set(), []
for f in sorted(glob.glob(os.path.join(D, 'cat-*.json'))):
    d = load(os.path.basename(f))
    if not d: continue
    for a in d.get('assignments', []):
        t = rename(a.get('t'))
        if t not in titles:
            bad.append((os.path.basename(f), t)); continue
        c = a.get('cat') if a.get('cat') in CATS else 'power'
        ty = a.get('type') if a.get('type') in TYPES else 'moment'
        catmap[t] = [c, ty]; seen.add(t)
missing = [t for t in titles if t not in seen]
print(f'categories: {len(catmap)}/{len(titles)} matched, {len(missing)} unmatched, {len(bad)} unjoinable')
for f, t in bad[:5]: print(f'   unjoinable in {f}: {t[:60]!r}')
for t in missing[:5]: print(f'   no assignment: {t[:60]!r}')

# ---- polities ----------------------------------------------------------------
pol, ids = [], set()
for f in sorted(glob.glob(os.path.join(D, 'polities-*.json'))):
    d = load(os.path.basename(f))
    if not d: continue
    for p in d.get('polities', []):
        if not p.get('id') or p['id'] in ids: continue
        try:
            s, e = int(p['start']), int(p['end'])
        except Exception:
            continue
        if e <= s: e = s + 1
        w = [[int(a), float(b)] for a, b in (p.get('weight') or []) if b is not None]
        w = [pt for pt in w if s <= pt[0] <= e]
        w.sort(key=lambda q: q[0])
        if not w: w = [[s, 3], [e, 3]]
        if w[0][0] > s: w.insert(0, [s, w[0][1]])
        if w[-1][0] < e: w.append([e, w[-1][1]])
        ids.add(p['id'])
        pol.append({'id': p['id'], 'name': p.get('name', p['id']), 'start': s, 'end': e,
                    'region': p.get('region', 'EU'), 'weight': w,
                    'from': p.get('from') or [], 'to': p.get('to') or [],
                    'note': (p.get('note') or '')[:120]})
dangling = 0
for p in pol:
    nf = [x for x in p['from'] if x in ids]
    nt = [x for x in p['to'] if x in ids]
    dangling += (len(p['from']) - len(nf)) + (len(p['to']) - len(nt))
    p['from'], p['to'] = nf, nt
by = {p['id']: p for p in pol}
for p in pol:                                   # mirror edges both ways
    for t in p['to']:
        if p['id'] not in by[t]['from']: by[t]['from'].append(p['id'])
    for f in p['from']:
        if p['id'] not in by[f]['to']: by[f]['to'].append(p['id'])
forks = sum(1 for p in pol if len(p['to']) > 1)
print(f'polities: {len(pol)} kept, {dangling} dangling links dropped, {forks} genuine forks')

# ---- beliefs / populations / places ------------------------------------------
bel = load('beliefs.json') or {'systems': []}
for s in bel.get('systems', []):
    sids = {st['id'] for st in s.get('streams', [])}
    for st in s.get('streams', []):
        st['from'] = [x for x in (st.get('from') or []) if x in sids]
        st['to'] = [x for x in (st.get('to') or []) if x in sids]
        st['region'] = ''
        st['note'] = (st.get('note') or '')[:120]
print('beliefs: ' + ', '.join(f"{s['id']}={len(s.get('streams',[]))}" for s in bel.get('systems', [])))

pops = load('populations.json')
places_raw = load('event-places.json') or {'places': []}
places, unmatched = {}, 0
for p in places_raw.get('places', []):
    t = rename(p.get('t'))
    if t in titles:
        places[t] = [p.get('lat', 0), p.get('lon', 0), p.get('place', ''), p.get('scope', 'point')]
    else:
        unmatched += 1
print(f'places: {len(places)}/{len(titles)} joined ({unmatched} unjoinable)')

# ---- taxonomy-review overrides ------------------------------------------------
ov = load('overrides.json') or {}
recat, miss = 0, []
for t, c in (ov.get('recat') or {}).items():
    if t in catmap and c in CATS:
        catmap[t][0] = c; recat += 1
    else:
        miss.append(t)
retype = 0
for t, ty in (ov.get('retype') or {}).items():
    if t in catmap and ty in TYPES:
        catmap[t][1] = ty; retype += 1
    else:
        miss.append(t)
print(f'overrides: {recat} recategorised, {retype} retyped' + (f', {len(miss)} targets not found' if miss else ''))
for t in miss[:5]: print(f'   ! not found: {t!r}')

eras = []
for E in (ov.get('eras') or []):
    t = E['name']
    if t in seen:
        print(f'  ! era collides with an existing event title: {t!r}'); continue
    eras.append([E['start'], E['end'], t, E.get('band', 'EU'), E.get('imp', 2), E.get('tags', '')])
    catmap[t] = [E.get('cat', 'society') if E.get('cat') in CATS else 'society', 'era']
print(f'eras: {len(eras)} added')

# ---- lives (appended to EVENTS at load; exercises the "life" shape) -----------
lives_raw = load('lives.json') or {'lives': []}
lives = []
for L in lives_raw.get('lives', []):
    t = L['name']
    if t in seen:
        print(f'  ! life collides with an existing event title: {t!r}'); continue
    lives.append([L['start'], L['end'], t, L.get('band', 'EU'), L.get('imp', 3), L.get('tags', '')])
    catmap[t] = [L.get('cat', 'power') if L.get('cat') in CATS else 'power', 'life']
    if L.get('lat') is not None:
        places[t] = [L['lat'], L['lon'], L.get('place', ''), 'point']
print(f'lives: {len(lives)} lifespans added')

# ---- emit --------------------------------------------------------------------
out = os.path.join(os.path.dirname(D), 'prototypes', 'datasets.js')
j = lambda o: json.dumps(o, separators=(',', ':'), ensure_ascii=False)
with open(out, 'w') as fh:
    fh.write('const LIVES=' + j(lives + eras) + ';\n')
    fh.write('const CATMAP=' + j(catmap) + ';\n')
    fh.write('const POLIS=' + j(pol) + ';\n')
    fh.write('const BELIEF=' + j(bel) + ';\n')
    fh.write('const POPDATA=' + j(pops) + ';\n')
    fh.write('const PLACEMAP=' + j(places) + ';\n')
print(f'wrote {out} ({os.path.getsize(out)/1024:.0f} KB)')
