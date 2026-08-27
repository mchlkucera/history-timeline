#!/usr/bin/env python3
"""
build-data.py — freeze the REAL corpus into data.js for the lane-picker prototype.

The prototype opens from file://, where fetch() of a sibling JSON is blocked by
CORS. So the numbers are computed here, once, from the same files the app reads,
and written out as one global. Nothing in data.js is hand-typed.

Sources, all of them the app's own:
  web/src/data/events.ts        the hand-editable event corpus (band, level, tags)
  web/public/data/datasets.json LIVES (39 lifespans), CATMAP (cat/type), PLACEMAP
  web/public/data/lanes.json    the 15 curated lanes and their member lists
  web/public/data/polities.json (via datasets POLIS) 147 polities with weight curves
  web/public/data/relations.json 20 spreads, 348 links
  data/beliefs.json             61 belief streams in 2 systems

It replicates, in Python, exactly what layers.ts build() does — facetOf, the
FACET_MIN fold, the science exemption, the big-wars adoption, the lane counts —
so every "n" the prototype prints is the number the real library would print.
"""
import json, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def R(p): return os.path.join(ROOT, p)

# ── events.ts → tuples ───────────────────────────────────────────────────────
src = open(R('web/src/data/events.ts')).read()
body = src.split('export const EVENTS: TLEvent[] = [', 1)[1]
EVENTS = []
for line in body.splitlines():
    line = line.strip()
    if line.startswith('];'): break
    if not line.startswith('['): continue
    row = line.rstrip(',')
    # numbers like -13.8e9 and 541e6 are valid JSON floats; the rest is plain
    try:
        t = json.loads(row)
    except Exception:
        continue
    if isinstance(t, list) and len(t) >= 4:
        EVENTS.append(t + [None] * (11 - len(t)))
print('events.ts tuples:', len(EVENTS), file=sys.stderr)

ds = json.load(open(R('web/public/data/datasets.json')))
CATMAP, PLACES, LIVES, POLIS = ds['CATMAP'], ds['PLACEMAP'], ds['LIVES'], ds['POLIS']
for L in LIVES:
    EVENTS.append(list(L) + [None] * (11 - len(L)))

def guess_cat(ev):
    t = ((ev[5] or '') + ' ' + ev[2]).lower()
    if re.search(r'war|battle|conquest|siege|invade|invasion|armada|crusade|revolt', t): return 'war'
    if re.search(r'religio|christian|islam|buddh|philosoph|reformation|schism|communism|enlighten', t): return 'belief'
    if re.search(r'science|physics|math|astronom|medicine|technolog|invention|computing|printing|space|internet|dna|electricity', t): return 'sci'
    if re.search(r'music|opera|art|literature|jazz|rock|symphon|mozart|beethoven', t): return 'art'
    if re.search(r'cosmos|life|extinction|plague|pandemic|volcano|earth|human|climate', t): return 'nature'
    if re.search(r'exploration|migration|colony|colonialism|voyage|route', t): return 'reach'
    if re.search(r'trade|economy|slavery|university|law|gold|money|independence', t): return 'society'
    return 'power'

for ev in EVENTS:
    m = CATMAP.get(ev[2])
    ev[6] = m[0] if m else guess_cat(ev)
    ev[7] = m[1] if m else ('episode' if ev[1] else 'moment')
    ev[8] = PLACES.get(ev[2])

# ── lanes.json → LANES, and every member appended to EVENTS (setLanes) ───────
LANES = json.load(open(R('web/public/data/lanes.json')))['lanes']
for lane in LANES:
    for m in lane.get('members', []):
        EVENTS.append([
            m['start'], m.get('end', 0), m['name'], lane['key'], m.get('lvl', 3),
            m.get('tags', ''), m.get('cat', 'art'), m.get('type', 'movement'),
            [m['lat'], m['lon'], m.get('place', ''), ''] if m.get('lat') is not None else None,
            m.get('sharpness', 0.5), 'lane:' + lane['key'] + ':' + m['id'],
        ])
print('EVENTS after lanes:', len(EVENTS), file=sys.stderr)

def ev_id(e):
    return e[10] if e[10] else (('entity:' if e[7] == 'life' else 'event:') + e[2])

# ── the catalogue, replicating layers.ts build() ─────────────────────────────
def facet_of(cat, type_):
    if type_ == 'polity': return 'pol'
    if cat == 'war': return 'war'
    if cat == 'sci': return 'sci'
    if cat == 'art': return 'art'
    return 'ess'

peak = lambda w: max([p[1] for p in (w or [])] or [0])
def lvl_of_weight(pk): return 1 if pk >= 9 else 2 if pk >= 7 else 3 if pk >= 5 else 4 if pk >= 3 else 5
def region_of(lat, lon):
    if -25 <= lon <= 45 and 34 <= lat <= 72: return 'EU'
    if lon < -25: return 'AM'
    if lon <= 62 and lat < 34: return 'ME'
    return 'AS'

REL = json.load(open(R('web/public/data/relations.json')))
SPREADCAT = {'technology': 'sci', 'movement': 'belief', 'religion': 'belief', 'era': 'power', 'economy': 'society'}

n, strongest = {}, {}
def bump(band, facet, lvl):
    k = band + '/' + facet
    n[k] = n.get(k, 0) + 1
    if lvl < strongest.get(k, 9): strongest[k] = lvl

for e in EVENTS: bump(e[3], facet_of(e[6] or 'power', e[7] or ('episode' if e[1] else 'moment')), e[4] or 3)
for p in POLIS:  bump('ME' if p['region'] == 'AF' else p['region'], 'pol', lvl_of_weight(peak(p['weight'])))
for s in REL['spreads']:
    fp = (s.get('footprint') or [None])[0]
    r = region_of(fp['lat'], fp['lon']) if fp else None
    if r: bump(r, facet_of(SPREADCAT.get(s['kind'], 'society'), 'spread'), lvl_of_weight(peak(s['weight'])))

REGIONS = [('EU', 'Europe'), ('ME', 'MidEast & Africa'), ('AS', 'Asia'), ('AM', 'Americas')]
FACET_NAME = {'ess': 'Essentials', 'sci': 'Science', 'war': 'Wars', 'art': 'Art & culture', 'pol': 'States & empires'}
FACET_NAME_BY = {'AS': {'pol': 'Dynasties'}}
FACET_MIN = 4
LANE_KIND = {'MZ': 'person', 'CZ': 'region'}

FOLDED = {}
defs = []
defs.append({'id': 'deep', 'subject': 'CO', 'facet': 'all', 'name': 'Deep time', 'kind': 'region',
             'n': sum(n.get('CO/' + f, 0) for f in ['ess', 'sci', 'war', 'art', 'pol'])})
for key, label in REGIONS:
    essN = n.get(key + '/ess', 0); live = []
    for f in ['sci', 'war', 'art', 'pol']:
        c = n.get(key + '/' + f, 0)
        keep = c >= FACET_MIN or (f == 'sci' and c > 0 and strongest.get(key + '/sci', 9) <= 2)
        if keep: live.append(f)
        else:
            essN += c
            FOLDED.setdefault(key, []).append(f)
    big = [ev_id(e) for e in EVENTS if e[3] == key and e[1] and (e[6] or 'power') == 'war' and (e[4] or 3) <= 2] if 'war' in live else []
    defs.append({'id': key.lower() + '-ess', 'subject': key, 'facet': 'ess',
                 'name': label + ' · Essentials', 'kind': 'region', 'n': essN + len(big), 'anchors': big})
    for f in live:
        defs.append({'id': key.lower() + '-' + f, 'subject': key, 'facet': f,
                     'name': label + ' · ' + FACET_NAME_BY.get(key, {}).get(f, FACET_NAME[f]),
                     'kind': 'movements' if f == 'pol' else 'region', 'n': n.get(key + '/' + f, 0)})
for L in LANES:
    k = L['key']; kind = LANE_KIND.get(k, 'movements')
    cnt = sum(n.get(k + '/' + f, 0) for f in ['ess', 'sci', 'war', 'art', 'pol'])
    d = {'id': k.lower(), 'subject': k, 'facet': 'all', 'name': L['label'], 'kind': kind,
         'n': cnt + (1 if kind == 'person' else 0)}
    if kind == 'person': d['anchors'] = ['entity:Wolfgang Amadeus Mozart']
    defs.append(d)

print('layers:', len(defs), file=sys.stderr)
for d in defs: print('  %-10s %-28s n=%d' % (d['id'], d['name'], d['n']), file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════
# WHAT IS ACTUALLY IN A LAYER — so a candidate row can show a glimpse, and so
# "roughly how many" is a count of things, not a promise.
# ═══════════════════════════════════════════════════════════════════════════
def items_of(layer_id):
    d = next((x for x in defs if x['id'] == layer_id), None)
    if not d: return []
    out = []
    if d['facet'] == 'all' and d['subject'] not in ('CO',):
        for e in EVENTS:
            if e[3] == d['subject']:
                out.append({'id': ev_id(e), 'name': e[2], 'start': e[0], 'end': e[1] or e[0],
                            'cat': e[6], 'lon': (e[8][1] if e[8] else None)})
    elif d['subject'] == 'CO':
        for e in EVENTS:
            if e[3] == 'CO':
                out.append({'id': ev_id(e), 'name': e[2], 'start': e[0], 'end': e[1] or e[0], 'cat': e[6], 'lon': None})
    else:
        for e in EVENTS:
            ok = {d['facet']} | (set(FOLDED.get(d['subject'], [])) if d['facet'] == 'ess' else set())
            if e[3] == d['subject'] and facet_of(e[6] or 'power', e[7] or ('episode' if e[1] else 'moment')) in ok:
                out.append({'id': ev_id(e), 'name': e[2], 'start': e[0], 'end': e[1] or e[0],
                            'cat': e[6], 'lon': (e[8][1] if e[8] else None)})
        for sp in REL['spreads']:
            fp = (sp.get('footprint') or [None])[0]
            r = region_of(fp['lat'], fp['lon']) if fp else None
            ok2 = {d['facet']} | (set(FOLDED.get(d['subject'], [])) if d['facet'] == 'ess' else set())
            if r == d['subject'] and facet_of(SPREADCAT.get(sp['kind'], 'society'), 'spread') in ok2:
                out.append({'id': 'spread:' + sp['id'], 'name': sp['name'], 'start': sp['start'],
                            'end': sp['end'], 'cat': SPREADCAT.get(sp['kind'], 'society'),
                            'lon': (fp['lon'] if fp else None)})
        if d['facet'] == 'pol':
            for p in POLIS:
                if ('ME' if p['region'] == 'AF' else p['region']) == d['subject']:
                    out.append({'id': 'polity:' + p['id'], 'name': p['name'], 'start': p['start'],
                                'end': p['end'], 'cat': 'power', 'lon': None})
    for a in d.get('anchors', []):
        e = next((x for x in EVENTS if ev_id(x) == a), None)
        if e and not any(o['id'] == a for o in out):
            out.append({'id': a, 'name': e[2], 'start': e[0], 'end': e[1] or e[0], 'cat': e[6],
                        'lon': (e[8][1] if e[8] else None)})
    return out

ITEMS = {d['id']: items_of(d['id']) for d in defs}
for d in defs:
    got = len(ITEMS[d['id']])
    if got != d['n']:
        print('  ! count drift %s: catalogue n=%d, items=%d' % (d['id'], d['n'], got), file=sys.stderr)

def span_of(ls):
    if not ls: return None
    return [min(i['start'] for i in ls), max(i['end'] for i in ls)]

def neighbours(layer_id, a, b, k=3, skip=None):
    """The k members of a layer nearest in time to [a,b] — overlap first, then
    gap; within each group, nearest by midpoint, so the glimpse is what is
    ACTUALLY beside the subject rather than whatever is oldest. The subject
    itself is never its own neighbour."""
    ls = [i for i in ITEMS.get(layer_id, []) if i['id'] != skip]
    mid = (a + b) / 2
    def key(i):
        gap = 0 if (i['end'] >= a and i['start'] <= b) else min(abs(i['start'] - b), abs(a - i['end']))
        return (gap, abs((i['start'] + i['end']) / 2 - mid))
    return sorted(ls, key=key)[:k]

# ═══════════════════════════════════════════════════════════════════════════
# THE CANDIDATE RULE — four sources, in falling order of confidence.
#
#   A  HERE ALREADY   a lane whose members or anchors already name this id.
#   B  DERIVED        layerIdFor(band, cat, type) — the ONE coordinate the app
#                     computes today. Band = the mark's own, or regionOf(place)
#                     when it has none.
#   C  SUBJECT FIT    every curated lane, scored against the subject:
#                       +3  the lane's dominant member category == the subject's
#                       +2  the lane's span CONTAINS the subject's; +1 overlap
#                       +1  per shared word with a member name/tag/note (max 3)
#                     kept at >= 4.
#   D  A LANE OF YOUR OWN — always offered, always last, never scored.
# ═══════════════════════════════════════════════════════════════════════════
def Yr(v):
    return (str(-v) + ' BC') if v < 0 else ('present' if v >= 2026 else str(v))

STOP = set('the a an of and in to for on at from with is was were be by its it as '
           'that this his her their they he she not no non its own new first '
           'movement period age era century world great'.split())
def toks(*parts):
    s = ' '.join(p or '' for p in parts).lower()
    return {w for w in re.split(r'[^a-z0-9]+', s) if len(w) > 3 and w not in STOP}

LANE_TOKENS, LANE_DOMINANT, LANE_PURITY = {}, {}, {}
for L in LANES:
    ms = L.get('members', [])
    t = set()
    for m in ms: t |= toks(m['name'], m.get('tags'), m.get('note'))
    LANE_TOKENS[L['key']] = t
    cats = {}
    for m in ms: cats[m.get('cat', 'art')] = cats.get(m.get('cat', 'art'), 0) + 1
    top = max(cats, key=cats.get) if cats else None
    LANE_DOMINANT[L['key']] = top
    LANE_PURITY[L['key']] = (cats[top] / len(ms)) if ms else 0

def score_items(items, sub):
    """The subject-fit score, computed over whatever a layer actually holds —
    so a region facet and a curated lane are ranked by the same three tests."""
    if not items: return 0
    cats = {}
    for i in items: cats[i.get('cat', 'power')] = cats.get(i.get('cat', 'power'), 0) + 1
    top = max(cats, key=cats.get)
    pure = cats[top] / len(items) >= 0.9
    sc = 3 if (pure and top == sub['cat']) else 0
    lo = min(i['start'] for i in items); hi = max(i['end'] for i in items)
    if lo <= sub['start'] <= hi: sc += 2 if hi >= sub['end'] else 1
    toks_all = set()
    for i in items: toks_all |= toks(i['name'])
    sc += min(3, len(sub['words'] & toks_all))
    return sc

def cats_of(ms):
    return {m.get('cat', 'art') for m in ms}
def first_member_with(ms, w):
    for m in ms:
        if w in toks(m['name'], m.get('tags'), m.get('note')): return m['name']
    return None

def candidates(sub):
    """sub: {id,name,cat,type,band,start,end,lat,lon,words}"""
    out, seen = [], set()
    def row(lid, source, score, reasons):
        if lid in seen or not any(d['id'] == lid for d in defs): return
        seen.add(lid)
        d = next(x for x in defs if x['id'] == lid)
        ls = ITEMS[lid]
        out.append({
            'id': lid, 'name': d['name'], 'n': d['n'], 'kind': d['kind'],
            'axis': 'derived' if d['facet'] != 'all' or d['subject'] == 'CO' else 'curated',
            'source': source, 'score': score, 'reasons': reasons,
            'rank': {'derived': 0, 'here': 1, 'place': 2, 'fit': 2}[source],
            'span': span_of(ls),
            'near': [{'name': i['name'], 'start': i['start'], 'end': i['end']}
                     for i in neighbours(lid, sub['start'], sub['end'], 3, sub['id'])],
            'east': sum(1 for i in ls if i.get('lon') is not None and i['lon'] > 62),
            'located': sum(1 for i in ls if i.get('lon') is not None),
        })
    # A — already named
    for d in defs:
        if sub['id'] in d.get('anchors', []):
            row(d['id'], 'here', 99, [{'k': 'named', 'n': 0, 't': 'this lane already anchors this exact id'}])
    for L in LANES:
        if any('lane:' + L['key'] + ':' + m['id'] == sub['id'] for m in L.get('members', [])):
            row(L['key'].lower(), 'here', 99, [{'k': 'named', 'n': 0, 't': 'this lane already lists it as a member'}])
    # B — the derived coordinate
    band = sub.get('band')
    if not band and sub.get('lat') is not None: band = region_of(sub['lat'], sub['lon'])
    derived, derived_note = None, None
    if band:
        f = facet_of(sub['cat'], sub['type'])
        if band == 'CO': derived = 'deep'
        elif band in ('EU', 'ME', 'AS', 'AM'):
            want = band.lower() + '-' + f
            derived = want if any(d['id'] == want for d in defs) else band.lower() + '-ess'
            if derived != want: derived_note = 'the %s facet folded into Essentials' % FACET_NAME[f].lower()
            if f == 'ess' and sub['cat'] not in ('war', 'sci', 'art'):
                derived_note = "'%s' has no facet of its own — it lands in Essentials" % sub['cat']
        else:
            derived = band.lower() if any(d['id'] == band.lower() for d in defs) else None
    if derived:
        rs = [{'k': 'derived', 'n': 0, 't': 'layerIdFor(%s, %s, %s) — the one lane the app computes today' % (band, sub['cat'], sub['type'])}]
        if derived_note: rs.append({'k': 'derived', 'n': 0, 't': derived_note})
        row(derived, 'derived', 90, rs)
    # B2 — the place-derived region lane (see the note: `band` is either a
    # region or a lane key, never both, so a curated-band mark has no region).
    if sub.get('lat') is not None:
        r = region_of(sub['lat'], sub['lon'])
        f2 = facet_of(sub['cat'], sub['type'])
        want2 = r.lower() + '-' + f2
        lid2 = want2 if any(d['id'] == want2 for d in defs) else r.lower() + '-ess'
        if lid2 not in seen:
            # SCORED ON THE SAME SCALE AS A CURATED LANE, not given a privileged
            # rank. It used to sit above every subject-fit lane purely because it
            # came from a coordinate, which put Europe · Art & culture (7 things,
            # nearest neighbour Kafka) ahead of Arts & movements (which holds
            # Viennese Classicism) for Mozart. That ordering only survived
            # because a visible reason excused it; the founder's cut removes the
            # reason, so the order has to be right on its own.
            row(lid2, 'place', score_items(ITEMS[lid2], sub), [
                {'k': 'place', 'n': 0, 't': 'from its place, %s (%.1fN %.1fE) — regionOf() calls that %s'
                 % (sub.get('place', '?'), sub['lat'], sub['lon'], r)},
                {'k': 'place', 'n': 0, 't': 'NOT computed today: layerIdFor() reads the band, and this band is %s'
                 % sub.get('band')},
            ])

    # C — subject fit
    scored = []
    for L in LANES:
        k = L['key']; ms = L.get('members', [])
        if not ms: continue
        pure = LANE_PURITY[k] >= 0.9
        # A SINGLE-DOMAIN LANE WILL NOT TAKE A FOREIGNER. Every one of Religion's
        # 40 members is `belief`; a composer's life is not a candidate for it at
        # any word score. A MIXED lane (Czech history: power, art, belief, war)
        # is about a PLACE, so it takes whatever happened there — it just has to
        # earn its place on evidence instead of on domain.
        if pure and LANE_DOMINANT[k] != sub['cat']: continue
        lo, hi = min(m['start'] for m in ms), max(m.get('end') or m['start'] for m in ms)
        # AND IT MUST HAVE BEEN THERE AT THE TIME. A lane that begins after the
        # subject does cannot hold its origin, which is the one moment a lane
        # exists to place. This is what keeps Daoism (-350) out of Political
        # ideologies (1685) without a hand-written exception.
        if not (lo <= sub['start'] <= hi): continue
        s_, why = 0, []
        if pure:
            s_ += 3; why.append({'k': 'domain', 'n': 3,
                't': "same domain — all %d members are '%s'" % (len(ms), sub['cat'])})
        else:
            why.append({'k': 'domain', 'n': 0,
                't': 'a mixed lane (%s) — it is about a place, not a domain' % ', '.join(sorted(cats_of(ms))[:4])})
        if hi >= sub['end']:
            s_ += 2; why.append({'k': 'era', 'n': 2, 't': 'its span %s – %s contains the whole subject' % (Yr(lo), Yr(hi))})
        else:
            s_ += 1; why.append({'k': 'era', 'n': 1, 't': 'its span %s – %s holds the subject\u2019s start but ends before it does' % (Yr(lo), Yr(hi))})
        shared = sorted(sub['words'] & LANE_TOKENS[k])[:3]
        if shared:
            s_ += len(shared)
            why.append({'k': 'words', 'n': len(shared), 't': 'shares the word' + ('s ' if len(shared) > 1 else ' ') + ', '.join(shared),
                        'hits': [{'w': w, 'in': first_member_with(ms, w)} for w in shared]})
        else:
            why.append({'k': 'words', 'n': 0, 't': 'no word in common with any member'})
        if s_ >= 4: scored.append((s_, k, why))
    for s, k, why in sorted(scored, key=lambda x: (-x[0], x[1])):
        row(k.lower(), 'fit', s, why)
    out.sort(key=lambda c: (c['rank'], -c['score']))
    return out

# ── the two subjects, from the real files ────────────────────────────────────
BEL = json.load(open(R('data/beliefs.json')))['systems']
dao = next(s for sy in BEL for s in sy['streams'] if s['id'] == 'daoism')
conf = next(s for sy in BEL for s in sy['streams'] if s['id'] == 'confucianism')
moz = next(e for e in EVENTS if e[2] == 'Wolfgang Amadeus Mozart')

SUBS = []
SUBS.append({
    'id': 'belief:daoism', 'name': dao['name'], 'what': 'belief stream',
    'kindline': 'Belief · stream · Religions and their schisms',
    'cat': 'belief', 'type': 'spread', 'band': None, 'lat': None, 'lon': None,
    'start': dao['start'], 'end': dao['end'], 'note': dao['note'],
    'peak': peak(dao['weight']), 'lvl': lvl_of_weight(peak(dao['weight'])),
    'words': toks(dao['name'], dao['note']),
    'source': 'data/beliefs.json → systems[religion].streams[daoism]',
    'drawnBy': 'the Beliefs (braided rivers) view only',
})
SUBS.append({
    'id': 'entity:Wolfgang Amadeus Mozart', 'name': moz[2], 'what': 'life',
    'kindline': 'Art & culture · life · band MU',
    'cat': moz[6], 'type': moz[7], 'band': moz[3],
    'lat': moz[8][0] if moz[8] else None, 'lon': moz[8][1] if moz[8] else None,
    'place': moz[8][2] if moz[8] else None,
    'start': moz[0], 'end': moz[1], 'note': '', 'lvl': moz[4],
    'words': toks(moz[2], moz[5], 'salzburg vienna prague classical opera symphony'),
    'source': 'web/public/data/datasets.json → LIVES',
    'drawnBy': 'the Music lane, when it is on the board',
})

# ── WHY THE DERIVED AXIS CANNOT REACH DAOISM ────────────────────────────────
# factsOf('belief:daoism') returns null: eventById misses (no EVENTS tuple), so
# there is no band, no cat and no type to feed layerIdFor. Nor is there a place
# to fall back on — a belief stream carries a weight curve and nothing spatial.
# What follows is NOT a candidate. It is the lane the subject WOULD compute to
# if someone gave it the one coordinate it lacks, and the page labels it that way.
_dao_hyp_lane = 'as-ess'
_dao = SUBS[0]
_dao['derivedMiss'] = {
    'reason': 'a belief stream has no EVENTS tuple, so it has no band, no category and no type — '
              'layerIdFor() has nothing to compute from. It has no lat/lon either, so there is no place to fall back on.',
    'hypothetical': {
        'band': 'AS',
        'basis': "its parent stream is chinese-folk-religion, and Confucius — its one link in the whole corpus — "
                 "sits at Qufu (35.6N, 117.0E), which regionOf() calls AS",
        'lane': _dao_hyp_lane,
        'laneName': next(d['name'] for d in defs if d['id'] == _dao_hyp_lane),
        'n': next(d['n'] for d in defs if d['id'] == _dao_hyp_lane),
        'facetNote': "facetOf('belief', 'spread') is 'ess' — belief has no facet of its own, "
                     "so it would land in Essentials beside the dynasties and the wars",
        'near': [{'name': i['name'], 'start': i['start'], 'end': i['end']}
                 for i in neighbours(_dao_hyp_lane, _dao['start'], _dao['end'], 4, _dao['id'])],
    },
}
# Mozart's missing lane is the opposite shape: the coordinate exists, the LANE does not.
SUBS[1]['missingLane'] = {
    'want': 'Austria',
    'reason': 'the derived axis has exactly four regions — EU, ME, AS, AM. There is no Austria, no France, '
              'no Italy. The only nation-shaped lane in the whole corpus is Czech history, and it exists '
              'because a person wrote 38 members into lanes.json by hand.',
    'closest': 'eu-art',
    'closestName': next(d['name'] for d in defs if d['id'] == 'eu-art'),
    'closestN': next(d['n'] for d in defs if d['id'] == 'eu-art'),
    'closestItems': [{'name': i['name'], 'start': i['start'], 'end': i['end']} for i in ITEMS['eu-art']],
}

LINKS = REL['links']
for s in SUBS:
    s['links'] = [{'other': (l['b'] if l['a'] == s['id'] else l['a']), 'kind': l['kind'], 'w': l['w']}
                  for l in LINKS if s['id'] in (l['a'], l['b'])]
    s['cands'] = candidates(s)
    s['words'] = sorted(s['words'])

# Confucius, because he is the founder's own route in: he IS drawn, Daoism is not.
confucius = next(e for e in EVENTS if e[2] == 'Confucius')
CONF = {'id': 'entity:Confucius', 'name': 'Confucius', 'band': confucius[3], 'cat': confucius[6],
        'type': confucius[7], 'start': confucius[0], 'end': confucius[1],
        'lane': 'as-ess', 'laneName': next(d['name'] for d in defs if d['id'] == 'as-ess')}

# ── the words the page says, composed from the facts above ──────────────────
def Y(v):
    return (str(-v) + ' BC') if v < 0 else ('present' if v >= 2026 else str(v))

def why_short(c):
    return ' · '.join(r['t'] for r in c['reasons'])

NAMES = {}
for e in EVENTS: NAMES[ev_id(e)] = e[2]
for p_ in POLIS: NAMES['polity:' + p_['id']] = p_['name']
for sp in REL['spreads']: NAMES['spread:' + sp['id']] = sp['name']
for sy in BEL:
    for st_ in sy['streams']: NAMES['belief:' + st_['id']] = st_['name']

for sub in SUBS:
    for c in sub['cands']: c['whyShort'] = why_short(c)
    held = [c for c in sub['cands'] if c['source'] in ('derived', 'here')]
    more = [c for c in sub['cands'] if c['source'] not in ('derived', 'here')]
    sub['held'], sub['more'] = len(held), len(more)

d0, m0 = SUBS[0], SUBS[1]
d0.update({
    'slug': 'daoism',
    'stageLabel': 'The hard case — in no lane at all',
    'presentLine': '',
    'sayHead': 'Not on the board',
    'sayTail': 'in 0 of %d lanes — %d would take it' % (len(LANES), d0['more']),
    'onBoard': False,
    'shutReason': 'Daoism is in no lane, so no layer on this timeline draws it',
    'emptyAxis': 'A belief stream has no EVENTS tuple and no coordinate, so layerIdFor() '
                 'has nothing to compute from. Given a band it would land in %s (%d things) — '
                 "facetOf('belief','spread') is 'ess', so belief has no facet of its own."
                 % (d0['derivedMiss']['hypothetical']['laneName'],
                    d0['derivedMiss']['hypothetical']['n']),
})
m0.update({
    'slug': 'mozart',
    'stageLabel': 'The plural case — he fits several',
    'presentLine': '',
    'sayHead': 'Not on the board',
    'sayTail': 'in %d of %d lanes, neither shown — %d more would take him'
               % (m0['held'], len(LANES), m0['more']),
    'onBoard': True,
    'shutReason': '',
    'emptyAxis': '',
    'note': 'Banded MU. His life is a mark in the Music lane, and the Mozart lane — a study of him — '
            'adopts it by name. Neither is on the default board.',
})

OUT = {
    'names': NAMES,
    'defs': defs,
    'lanes': [{'key': L['key'], 'label': L['label'], 'n': len(L.get('members', [])),
               'dominant': LANE_DOMINANT[L['key']]} for L in LANES],
    'subjects': SUBS,
    'confucius': CONF,
    'confucianism': {'id': 'belief:confucianism', 'name': conf['name'], 'start': conf['start'],
                     'end': conf['end'], 'note': conf['note']},
    'corpus': {'events': len(EVENTS), 'polities': len(POLIS), 'spreads': len(REL['spreads']),
               'links': len(LINKS), 'lanes': len(LANES), 'layers': len(defs),
               'beliefs': sum(len(sy['streams']) for sy in BEL)},
    'year': 1789,
}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'data.js'), 'w') as f:
    f.write('/* GENERATED by build-data.py from the real corpus. Do not hand-edit. */\n')
    f.write('window.LP = ')
    json.dump(OUT, f, indent=1)
    f.write(';\n')
print('\nwrote data.js', file=sys.stderr)
for s in SUBS:
    print('\n%s — %s' % (s['name'], s['id']), file=sys.stderr)
    for c in s['cands']:
        print('   %-8s %-30s n=%-3d score=%-3s %s' % (c['source'], c['name'], c['n'], c['score'], ' | '.join(r['t'] for r in c['reasons'])), file=sys.stderr)
