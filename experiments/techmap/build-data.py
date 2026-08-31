#!/usr/bin/env python3
"""
build-data.py — freeze the base map, the corpus places and the four
hand-authored diffusions into data.js for the tech-map prototype.

WHY A GENERATOR AT ALL. The prototype must open from file://, where fetch() of
a sibling JSON is blocked. So everything is baked once, here, out of the files
the app itself ships:

  web/public/data/worlds.json     the atlas — 18 border snapshots. Six of them
                                  are re-encoded here in the atlas's OWN format
                                  (delta decimetre-degrees), simplified, so the
                                  base map under the diffusion is the app's own
                                  geometry and not a stranger's coastline file.
  web/public/data/datasets.json   PLACEMAP — 163 named places with lat/lon. Every
                                  place below that the corpus already knows is
                                  taken FROM it, and says so (src: "corpus").
  web/public/data/relations.json  the 20 spreads. Three of the four diffusions
                                  already exist there as a weight curve plus a
                                  footprint; both are carried through so the page
                                  can put "what the corpus has" beside "what a
                                  diffusion would need".

WHAT IS *NOT* FROM THE CORPUS. The diffusions themselves. Four of them, hand
authored below against conventional scholarship, with a note on every hop whose
date is argued about. That is the point of the exercise: the corpus has WHEN and
HOW BIG; it has no WHERE-NEXT, and this file is a proposal for the smallest
shape that would carry one.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def R(p): return os.path.join(ROOT, p)

# ── the atlas ────────────────────────────────────────────────────────────────
# Six snapshots, chosen to cover the span the four diffusions actually run over
# (868 CE → 1995). The base map under the scrubber steps to the nearest one, the
# same way MapView.syncToYear() picks its snapshot in the real app.
SNAPSHOTS = [800, 1000, 1279, 1492, 1600, 1715, 1880, 1994]
EPS       = 0.42   # Douglas–Peucker tolerance, degrees
MIN_SPAN  = 1.3    # drop rings whose bbox is smaller than this, sq. degrees

WORLDS = json.load(open(R('web/public/data/worlds.json')))

def decode(feats):
    """The app's own decoder — render/shared.ts decodeSnapshot(), in Python."""
    out = []
    for f in feats:
        rings = []
        for d in f[2]:
            x, y = d[0], d[1]
            r = [(x / 10, y / 10)]
            for i in range(2, len(d), 2):
                x += d[i]; y += d[i + 1]
                r.append((x / 10, y / 10))
            rings.append(r)
        out.append(rings)
    return out

def rdp(pts, eps):
    if len(pts) < 4: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        nn = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if nn == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / nn
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best: best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]

def span(r):
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))

def encode(rings):
    """Back into the atlas's format: delta decimetre-degrees, ints."""
    out = []
    for r in rings:
        d = [round(r[0][0] * 10), round(r[0][1] * 10)]
        px, py = d[0], d[1]
        for x, y in r[1:]:
            xi, yi = round(x * 10), round(y * 10)
            d.append(xi - px); d.append(yi - py)
            px, py = xi, yi
        out.append(d)
    return out

WORLD = {}
_pts = 0
for yr in SNAPSHOTS:
    keep = []
    for rings in decode(WORLDS[str(yr)]):
        rr = [rdp(r, EPS) for r in rings if span(r) >= MIN_SPAN]
        rr = [r for r in rr if len(r) >= 4]
        if rr: keep.extend(rr)
        _pts += sum(len(r) for r in rr)
    WORLD[yr] = encode(keep)
print(f'atlas: {len(SNAPSHOTS)} snapshots, {_pts} points', file=sys.stderr)

# ── the corpus's places ──────────────────────────────────────────────────────
ds = json.load(open(R('web/public/data/datasets.json')))
CORPUS_PLACES = {}
for ev, v in ds['PLACEMAP'].items():
    lat, lon, name, kind = v
    CORPUS_PLACES.setdefault(name, (lat, lon, kind))
print(f'PLACEMAP: {len(CORPUS_PLACES)} unique named places', file=sys.stderr)

# ── the corpus's own spreads, for the "what exists today" panel ──────────────
rel = json.load(open(R('web/public/data/relations.json')))
SPREADS = {s['id']: s for s in rel['spreads']}

# ═════════════════════════════════════════════════════════════════════════════
# PLACES
#
# A place is an id, a display name and a point. Where the corpus already knows
# the place, the point is READ OUT OF PLACEMAP by name and never retyped — the
# `C(...)` rows below carry the PLACEMAP key, and the build fails loudly if that
# key ever disappears. Everything else is hand-entered, and marked as such, so
# the page can say honestly how much of this an existing dataset already covers.
# ═════════════════════════════════════════════════════════════════════════════
def C(key, label=None):
    if key not in CORPUS_PLACES:
        raise SystemExit(f'PLACEMAP no longer has {key!r} — fix build-data.py')
    lat, lon, kind = CORPUS_PLACES[key]
    return {'name': label or key, 'lat': lat, 'lon': lon, 'src': 'corpus', 'key': key, 'kind': kind}
def H(name, lat, lon, kind='point'):
    return {'name': name, 'lat': lat, 'lon': lon, 'src': 'hand', 'kind': kind}

PLACES = {
    # — from the corpus —
    'kaifeng':      C('Kaifeng'),
    'changan':      C("Chang'an"),
    'dunhuang':     C('Dunhuang'),
    'mainz':        C('Mainz'),
    'venice':       C('Venice'),
    'paris':        C('Paris'),
    'london':       C('London'),
    'rome':         C('Rome'),
    'constantinople': C('Constantinople'),
    'moscow':       C('Moscow'),
    'cairo':        C('Cairo'),
    'damascus':     C('Damascus'),
    'baghdad':      C('Baghdad'),
    'delhi':        C('Delhi'),
    'khanbaliq':    C('Khanbaliq (Beijing)'),
    'kyoto':        C('Kyoto'),
    'edo':          C('Edo (Tokyo)'),
    'mexico':       C('Tenochtitlan', 'Mexico City (Tenochtitlan)'),
    'philadelphia': C('Philadelphia'),
    'cambridge':    C('Cambridge'),
    'berlin':       C('Berlin'),
    'cern':         C('CERN, Geneva'),
    'cupertino':    C('Cupertino'),
    'murrayhill':   C('Murray Hill, New Jersey'),
    'liverpool':    C('Liverpool'),
    'birmingham':   C('Birmingham'),
    'boston':       C('Boston'),
    'nyc':          C('New York'),
    'prague':       C('Prague'),
    'nanjing':      C('Nanjing'),
    'guangzhou':    C('Canton (Guangzhou)'),
    'lyon':         H('Lyon', 45.76, 4.84),
    'warsaw':       C('Warsaw'),
    'sanfrancisco': C('San Francisco'),
    'mali':         C('Mali'),

    # — hand-entered; the corpus has no point for these —
    'cheongju':     H('Cheongju', 36.64, 127.49),
    'ganghwa':      H('Ganghwa Island', 37.75, 126.49),
    'subiaco':      H('Subiaco', 41.92, 13.10),
    'krakow':       H('Kraków', 50.06, 19.94),
    'lisbon':       H('Lisbon', 38.72, -9.14),
    'goa':          H('Goa', 15.50, 73.83),
    'nagasaki':     H('Nagasaki', 32.75, 129.87),
    'cambridgema':  H('Cambridge, Massachusetts', 42.37, -71.11),
    'istanbul':     H('Istanbul', 41.01, 28.98),
    'calcutta':     H('Calcutta (Hooghly)', 22.57, 88.36),
    'tanegashima':  H('Tanegashima', 30.60, 130.95),
    'tondibi':      H('Tondibi', 16.63, -0.05),
    'dean':         H("De'an (Anlu)", 31.26, 113.68),
    'oxford':       H('Oxford', 51.75, -1.26),
    'florence':     H('Florence', 43.77, 11.26),
    'crecy':        H('Crécy', 50.26, 1.90),
    'gulbarga':     H('Gulbarga (Bahmani)', 17.33, 76.83),
    'bury':         H('Bury, Lancashire', 53.59, -2.30),
    'blackburn':    H('Blackburn', 53.75, -2.48),
    'cromford':     H('Cromford', 53.11, -1.56),
    'bolton':       H('Bolton', 53.58, -2.43),
    'doncaster':    H('Doncaster', 53.52, -1.13),
    'derby':        H('Derby', 52.92, -1.48),
    'verviers':     H('Verviers', 50.59, 5.86),
    'pawtucket':    H('Pawtucket, Rhode Island', 41.88, -71.38),
    'waltham':      H('Waltham, Massachusetts', 42.38, -71.24),
    'mulhouse':     H('Mulhouse', 47.75, 7.34),
    'chemnitz':     H('Chemnitz', 50.83, 12.92),
    'barcelona':    H('Barcelona', 41.39, 2.17),
    'bombay':       H('Bombay (Mumbai)', 19.08, 72.88),
    'osaka':        H('Osaka', 34.69, 135.50),
    'lodz':         H('Łódź', 51.76, 19.46),
    'manchester':   H('Manchester', 53.48, -2.24),
    'bletchley':    H('Bletchley Park', 51.99, -0.74),
    'ames':         H('Ames, Iowa', 42.03, -93.62),
    'kyiv':         H('Feofaniya, Kyiv', 50.35, 30.49),
    'dallas':       H('Dallas', 32.78, -96.80),
    'mountainview': H('Mountain View', 37.39, -122.08),
    'santaclara':   H('Santa Clara', 37.35, -121.95),
    'albuquerque':  H('Albuquerque', 35.08, -106.65),
    'bocaraton':    H('Boca Raton', 26.37, -80.10),
    'urbana':       H('Urbana-Champaign', 40.11, -88.23),
    'stanford':     H('SLAC, Stanford', 37.42, -122.20),
    'bangalore':    H('Bangalore', 12.97, 77.59),
    'bologna':      C('Bologna'),
    'ucla':         C('Los Angeles', 'UCLA, Los Angeles'),
    'cologne':      H('Cologne', 50.94, 6.96),
    'seville':      H('Seville', 37.39, -5.99),
    'marrakesh':    H('Marrakesh', 31.63, -7.99),
    'poughkeepsie': H('Poughkeepsie, New York', 41.70, -73.92),
    'ghent':        H('Ghent', 51.05, 3.72),
    'shanghai':     H('Shanghai', 31.23, 121.47),
    'oldham':       H('Oldham', 53.54, -2.12),
    'suzhou':       H('Suzhou', 31.30, 120.58),
}

# ═════════════════════════════════════════════════════════════════════════════
# THE FOUR DIFFUSIONS — hand authored, conventional scholarship, notes where
# the dating or the route is argued about.
#
#   diffusion = { id, name, cat, claim, unit, span,
#                 precursors: [{place, year, note}],
#                 origin:     {place, year, note, contested?},
#                 hops:       [{place, year, via?, from?, note?, contested?,
#                               route?, fate?}] }
#
#   via     one of trade | conquest | migration | print | institution | copy
#           — drawn as a GLYPH on the arc, never as a colour and never as a
#           dash: the eight category hues are the corpus's data system and the
#           dash patterns are already spent on confidence (tokens.css §
#           "Confidence — encoded by FORM, never by hue").
#   from    the place the arc is drawn FROM. Absent = an arrival with no
#           drawable parent, which on this map is a claim in itself.
#   contested   the DATE is argued about → the arrival dot is a slashed ring.
#   route       the PATH is inferred rather than documented → the arc is dashed
#               with --tl-dash-contest. Authoring gunpowder forced this apart
#               from `contested`; they are genuinely different doubts.
#   fate        'faded' = it arrived, it ran, and it stopped. Three of the four
#               diffusions needed this and the corpus's weight curve cannot
#               express it per-place.
# ═════════════════════════════════════════════════════════════════════════════

PRINTING = {
 'id': 'printing', 'name': 'Printing', 'cat': 'sci', 'spread': 'printing',
 'unit': 'a press with movable type, working, producing books for sale or for a patron',
 'claim': 'Arrival = the first press ON THIS SPOT that printed something we can name. '
          'Not first knowledge of printing, not first printed book to reach the city.',
 'span': [820, 1800],
 'precursors': [
   {'place': 'dunhuang', 'year': 868,
    'note': 'The Diamond Sutra scroll, woodblock, colophon dated to the equivalent of 11 May 868 — '
            'the oldest dated printed book. Korea’s Mugujeonggwang dharani (Bulguksa, before 751) is '
            'older still but undated. Woodblock is not movable type; it is the incumbent movable type '
            'had to beat, and in East Asia it never entirely did.'},
 ],
 'origin': {'place': 'kaifeng', 'year': 1040, 'contested': True,
   'note': 'Bi Sheng’s baked-clay movable type, at the Northern Song capital. Everything we know comes '
           'from Shen Kuo’s Mengxi Bitan, written about 1088 — roughly forty years after, by a man who '
           'says his nephews kept the type. No Bi Sheng imprint survives. (The brief said Chang’an: '
           'Chang’an was the TANG capital; 1040 is Song, and Song means Kaifeng.)'},
 'hops': [
  {'place':'ganghwa','year':1234,'via':'institution','from':'kaifeng','contested':True,'route':True,
   'note':'The Sangjeong Gogeum Yemun, said by a 1239 postface to have been cast in metal type by the '
          'Goryeo court in exile on Ganghwa Island. The book does not survive. One later text carries '
          'the whole claim, and the route from Song China is assumed rather than documented.'},
  {'place':'cheongju','year':1377,'via':'institution','from':'ganghwa',
   'note':'The Jikji, printed with cast bronze type at Heungdeok temple — the oldest surviving '
          'metal-type book anywhere, 78 years before the Gutenberg Bible. It is in Paris.'},
  {'place':'mainz','year':1450,
   'note':'Gutenberg’s workshop: screw press, oil-based ink, and the real invention — a hand mould that '
          'casts type on demand in an alphabet of 26 letters rather than a script of thousands. '
          'THE ARC IS DELIBERATELY MISSING. No evidence of transmission from East Asia has ever been '
          'produced; scholarship treats Mainz as independent. Drawing a line from Kaifeng would be the '
          'map making a claim the field refuses to make, and the shape must be able to say so.'},
  {'place':'cologne','year':1465,'via':'migration','from':'mainz',
   'note':'Ulrich Zell, Mainz-trained. The 1462 sack of Mainz scattered its printers; the trade '
          'spreads because its practitioners are displaced.'},
  {'place':'subiaco','year':1465,'via':'migration','from':'mainz',
   'note':'Sweynheym and Pannartz set up in a Benedictine monastery 70 km east of Rome. Italy’s first press.'},
  {'place':'venice','year':1469,'via':'migration','from':'subiaco',
   'note':'Johannes de Spira’s five-year monopoly. By 1500 Venice held some 150 presses and printed '
          'roughly one in seven of all European books.'},
  {'place':'paris','year':1470,'via':'institution','from':'mainz',
   'note':'Three German printers installed INSIDE the Sorbonne by Fichet and Heynlin. Diffusion by '
          'university rather than by market — a different mechanism with the same date range.'},
  {'place':'krakow','year':1473,'via':'migration','from':'mainz',
   'note':'Kasper Straube. Poland’s first press, three years before England’s.'},
  {'place':'london','year':1476,'via':'migration','from':'cologne',
   'note':'Caxton learned the trade in Cologne about 1471, printed first in Bruges, and brought a press '
          'to Westminster in 1476. Displayed at London: the corpus has no Westminster.'},
  {'place':'seville','year':1477,'via':'migration','from':'mainz',
   'note':'The “four German companions”. Seville matters later: it is the house the American press '
          'is a branch of.'},
  {'place':'lisbon','year':1489,'via':'migration','from':'venice',
   'note':'Rabbi Eliezer Toledano’s Hebrew press; Faro had one two years earlier. The first books '
          'printed in Portugal are in Hebrew, and three years later the printers are expelled.'},
  {'place':'constantinople','year':1493,'via':'migration','from':'lisbon',
   'note':'David and Samuel ibn Nahmias, Sephardic refugees of the 1492 expulsion, printing Hebrew. '
          'The carrier here is an expulsion order, not a trade route.'},
  {'place':'mexico','year':1539,'via':'institution','from':'seville',
   'note':'Juan Pablos running a branch of the Cromberger house of Seville under Crown and Church '
          'licence. First press in the Americas — 89 years after Mainz, 21 years after the conquest.'},
  {'place':'goa','year':1556,'via':'institution','from':'lisbon',
   'note':'A Jesuit press bound for Ethiopia that stopped in Goa and stayed. Tamil type was cut at '
          'Quilon in 1578 — the first non-European script printed with movable type in Asia by Europeans.'},
  {'place':'moscow','year':1564,'via':'institution','from':'krakow','fate':'faded',
   'note':'Ivan Fyodorov’s Apostol at the Tsar’s Print Yard. The Yard burned, Fyodorov fled to '
          'Lithuania, and Muscovite printing stalled for a generation.'},
  {'place':'nagasaki','year':1590,'via':'institution','from':'goa','fate':'faded',
   'note':'Valignano’s mission press, with type shipped from Europe. Expelled with the missionaries by '
          '1614; movable type then lapsed in Japan for two and a half centuries in favour of woodblock, '
          'which was cheaper for the script. Arrival is not adoption.'},
  {'place':'cambridgema','year':1638,'via':'migration','from':'london',
   'note':'Stephen Daye’s press at Harvard; the Bay Psalm Book, 1640. First press in English North America.'},
  {'place':'constantinople','year':1727,'via':'institution','from':'venice','fate':'faded',
   'note':'İbrahim Müteferrika’s imperial firman to print in ARABIC SCRIPT — in a city that had had '
          'Hebrew, Armenian and Greek presses since 1493. What arrived in 1727 was permission, not '
          'technology. The press closed in 1742 after seventeen titles. Note the coordinates: this is '
          'the SAME POINT as the 1493 hop, 234 years later.'},
  {'place':'calcutta','year':1778,'via':'institution','from':'london',
   'note':'Charles Wilkins cuts the first Bengali type at Hooghly for Halhed’s grammar: a company '
          'printing the language it has begun to govern in.'},
 ],
}

GUNPOWDER = {
 'id': 'gunpowder', 'name': 'Gunpowder', 'cat': 'war', 'spread': 'gunpowder',
 'unit': 'the nitrate–sulphur–charcoal mixture, then the weapons built on it',
 'claim': 'Arrival = the first firm local evidence of the mixture or a weapon using it. '
          'For most of this map that evidence is a siege, which is a poor instrument.',
 'span': [790, 1620],
 'precursors': [
   {'place':'changan','year':808,
    'note':'The Taishang Shengzu Jindan Mijue, a Daoist alchemical text, gives a sulphur–saltpetre '
           '–carbon mixture. Gunpowder is found by people looking for an elixir of immortality.'},
 ],
 'origin': {'place':'changan','year':850,'contested':True,
   'note':'The Zhenyuan miaodao yaolüe warns alchemists that this mixture has burned hands off and '
          'burned buildings down. The dating of these texts is soft by up to a century; 850 is the '
          'conventional peg, and an honest map has to show that the FIRST dot is the least certain one.'},
 'hops': [
  {'place':'kaifeng','year':1044,'via':'institution','from':'changan',
   'note':'The Wujing Zongyao, a Song military compendium, prints three formulas — the first written '
          'gunpowder recipes in the world. Nitrate around half: incendiary, not yet explosive.'},
  {'place':'dean','year':1132,'via':'institution','from':'kaifeng',
   'note':'Chen Gui defends De’an with “fire lances”: bamboo tubes on poles. The first firearm is a '
          'flamethrower.'},
  {'place':'kaifeng','year':1232,'via':'conquest','from':'dean',
   'note':'The Mongol siege of Kaifeng. Iron-cased “thunder-crash bombs” — the mixture is now '
          'brisant. Second arrival at a point that is already the origin’s first hop.'},
  {'place':'baghdad','year':1258,'via':'conquest','from':'kaifeng','contested':True,
   'note':'Hulagu’s siege. Chinese siege engineers travelled with the Mongol army; whether what they '
          'threw was gunpowder or naphtha is argued, and the sources are later.'},
  {'place':'damascus','year':1280,'via':'conquest','from':'baghdad',
   'note':'Hasan al-Rammah’s al-Furusiyya wa’l-Manasib al-Harbiyya: a saltpetre purification method and '
          'over a hundred recipes. The Arabic for saltpetre — thalj al-Sin, “Chinese snow” — is the '
          'transmission written into the vocabulary.'},
  {'place':'cheongju','year':1377,'via':'trade','from':'kaifeng',
   'note':'Choe Museon’s Hwatong Dogam, after buying the saltpetre-refining method from a Chinese '
          'merchant. The same year, 900 km away, the Jikji is printed — the only date these two maps share.'},
  {'place':'moscow','year':1382,'via':'conquest','from':'kaifeng','route':True,
   'note':'Cannon (tyufyaki) on the walls of Moscow against Tokhtamysh. The carrier is the Horde; the '
          'arc is drawn to Kaifeng because that is where the Horde got it, not because anything travelled '
          'that line.'},
  {'place':'oxford','year':1267,
   'note':'Roger Bacon’s Opus Majus describes a firecracker he has evidently SEEN — in Europe, in the '
          '1260s. (The famous anagram formula is an 18th-century forgery and is not evidence.) '
          'No arc: the thing is already in Europe and nobody can say by what road.'},
  {'place':'florence','year':1326,'via':'trade','from':'damascus','route':True,
   'note':'The Florentine ordinance of 11 February 1326 commissioning brass cannon and iron balls — the '
          'first firm European document. THE ARC IS A GUESS. Everyone agrees gunpowder reached Europe '
          'from the east; nobody can name the carrier. Drawn dashed for exactly that reason, which is '
          'a different doubt from a doubtful date.'},
  {'place':'crecy','year':1346,'via':'conquest','from':'florence',
   'note':'Three ribaldis fired at Crécy: cannon in a field battle twenty years after the first foundry order.'},
  {'place':'gulbarga','year':1442,'via':'trade','from':'damascus','contested':True,
   'note':'Firearms in the Bahmani Deccan. Claims for Delhi in the 1360s rest on chronicles written '
          'much later and are not accepted.'},
  {'place':'constantinople','year':1453,'via':'conquest','from':'florence',
   'note':'Orban’s bombards, cast in Hungary after Constantinople could not pay him. Walls that had '
          'held for eleven centuries.'},
  {'place':'seville','year':1262,'via':'conquest','from':'baghdad','contested':True,'route':True,
   'note':'The siege of Niebla, where the defenders are said to have thrown fire with “thunder and '
          'lightning”. Later Arabic chronicles carry the claim and plenty of scholars will not take it. '
          'IT ALSO BREAKS THE TREE: the natural parent is al-Rammah at Damascus, whose manuscript is '
          '1280 — EIGHTEEN YEARS AFTER THE CHILD. A tree built over “earliest firm local evidence” will '
          'routinely produce parents younger than their children, because evidence and transmission are '
          'not the same sequence. The arc is drawn to Baghdad 1258 to keep time moving forward, and '
          'that choice is a lie of exactly the kind an ETL will make silently.'},
  {'place':'lisbon','year':1385,'via':'conquest','from':'seville',
   'note':'Bombards at Aljubarrota. Portugal will carry these guns down the African coast within a lifetime.'},
  {'place':'goa','year':1510,'via':'conquest','from':'lisbon',
   'note':'Albuquerque takes Goa with shipboard artillery. The Estado da Índia is now a firearms '
          'distribution network — and it is the SAME network that carried the Jesuit press in 1556. '
          'Two of these four maps share a road and neither can see the other.'},
  {'place':'mexico','year':1519,'via':'conquest','from':'seville',
   'note':'Gunpowder reaches the Americas pointed at the people it reaches. “Arrival” here is not '
          'adoption by anyone, and the word does real damage if the map does not say so.'},
  {'place':'tanegashima','year':1543,'via':'trade','from':'goa',
   'note':'Two Portuguese aboard a Chinese junk blown onto the island. Within ten years Japan was '
          'making arquebuses; by Nagashino in 1575, volley fire. The fastest adoption on any of these maps.'},
  {'place':'tondibi','year':1591,'via':'conquest','from':'constantinople','route':True,
   'note':'Judar Pasha’s Moroccan arquebusiers cross the Sahara and break the Songhai army. West '
          'Africa’s introduction to the technology is a defeat; the Ottoman route to Saadi Morocco is '
          'the standard account but the supply chain is inferred.'},
 ],
}

TEXTILE = {
 'id': 'textile', 'name': 'Mechanised spinning & weaving', 'cat': 'society', 'spread': 'industrial-revolution',
 'unit': 'a powered machine that spins or weaves, installed and running in a mill',
 'claim': 'Arrival = the first POWERED mill on this spot. The loom itself has no origin to map — '
          'warp-weighted looms are in the record from Anatolia to Peru before writing — so the honest '
          'subject is mechanisation, and this map says so in its title rather than in a footnote.',
 'span': [1330, 1900],
 'precursors': [
  {'place':'bologna','year':1341,
   'note':'The Bolognese filatoio: a water-powered silk-throwing machine with hundreds of spindles, '
          'four centuries before Lancashire. A guild kept it secret and it did not generalise. '
          'Mechanised spinning has a false start with an excellent claim to being first.'},
  {'place':'derby','year':1721,'note':
          'Lombe’s silk mill. John Lombe copied the Piedmontese throwing machine at Livorno in 1717 by '
          'night, brought the drawings home, and built England’s first true factory. Industrial '
          'espionage is the FIRST link in this chain and it will not be the last.'},
 ],
 'origin': {'place':'bury','year':1733,
   'note':'John Kay’s flying shuttle, patented 1733. It doubles a weaver’s output and thereby creates '
          'the yarn famine that every machine after it is an answer to. Kay was ruined by the cost of '
          'suing infringers and died in France.'},
 'hops': [
  {'place':'blackburn','year':1764,'via':'institution','from':'bury','contested':True,
   'note':'Hargreaves’ spinning jenny. 1764 is the traditional date; the patent is 1770 and the story '
          'is second-hand. Blackburn spinners broke his machines in 1768 — the reception is part of '
          'the arrival and the shape has no field for it.'},
  {'place':'cromford','year':1771,'via':'institution','from':'blackburn',
   'note':'Arkwright’s water frame (patent 1769) in a purpose-built mill on the Derwent. The MILL is '
          'the invention: a building, a wheel, a shift system, and two hundred people including children.'},
  {'place':'bolton','year':1779,'via':'institution','from':'cromford',
   'note':'Crompton’s mule — jenny plus water frame — which he never patented.'},
  {'place':'doncaster','year':1785,'via':'institution','from':'bolton','contested':True,
   'note':'Cartwright’s power-loom patent. THE MACHINE DID NOT WORK: weaving did not actually mechanise '
          'until Roberts’ loom in the 1820s. A patent date is not an arrival date, and this is the '
          'hop where the map would lie loudest if I let a patent stand in for a working thing.'},
  {'place':'manchester','year':1781,'via':'institution','from':'cromford',
   'note':'Arkwright’s Shudehill mill — Manchester’s first cotton factory, steam-assisted by 1783. '
          'Manchester ARRIVES TWICE on this map, forty-one years apart, and the two arrivals are '
          'different technologies (spinning, then weaving) under one place name. Every hop below that '
          'says “from Manchester” means this one.'},
  {'place':'oldham','year':1778,'via':'institution','from':'cromford',
   'note':'Lees Hall, Oldham’s first mill. By 1900 Oldham spun more cotton than any other town on earth '
          'and Platt Brothers sold the machinery that started the industry in Japan, India and Brazil. '
          'A node whose export is MACHINES rather than cloth is a different kind of node, and the shape '
          'has no way to mark it.'},
  {'place':'manchester','year':1822,'via':'institution','from':'doncaster',
   'note':'Richard Roberts’ iron power loom, then the self-acting mule in 1825. This, not 1785, is when '
          'weaving mechanises — and it is why the arc from Doncaster is 37 years long.'},
  {'place':'pawtucket','year':1790,'via':'copy','from':'cromford',
   'note':'Samuel Slater sailed as a farm labourer in defiance of the emigration ban and rebuilt '
          'Arkwright’s machinery from memory. In the United States he is the father of the industrial '
          'revolution; in Britain he is Slater the Traitor. The `via` this forced into the vocabulary '
          'is `copy`, and neither trade nor migration covers it.'},
  {'place':'ghent','year':1800,'via':'copy','from':'bolton',
   'note':'Lieven Bauwens smuggled mule-jennies out of England in pieces, with the workers to run them, '
          'on pain of death. Continental mechanisation begins as a crime.'},
  {'place':'verviers','year':1799,'via':'migration','from':'cromford',
   'note':'William Cockerill, a Lancashire mechanic, builds spinning machinery at Verviers; the family '
          'works at Seraing follow in 1817. Belgium industrialises before France.'},
  {'place':'chemnitz','year':1799,'via':'copy','from':'cromford',
   'note':'Saxony’s first mechanised spinning at Harthau, with English machinery got round the export ban.'},
  {'place':'mulhouse','year':1812,'via':'migration','from':'ghent',
   'note':'Alsatian cotton spinning at scale under the Continental System — a tariff wall, not a market, '
          'is the carrier.'},
  {'place':'waltham','year':1814,'via':'copy','from':'manchester',
   'note':'Francis Cabot Lowell toured British mills in 1810–12, memorised the power loom, and had it '
          'rebuilt at Waltham — the first mill anywhere to put spinning and weaving under one roof.'},
  {'place':'cairo','year':1818,'via':'institution','from':'manchester','fate':'faded',
   'note':'Muhammad Ali’s state mills: around thirty of them and tens of thousands of workers by the '
          '1830s, built by decree with imported machinery and conscripted labour. The 1838 and 1841 '
          'settlements stripped the tariffs and the whole programme collapsed. This is the only '
          'unambiguous case here of a technology that ARRIVED, RAN AT SCALE, AND WENT AWAY — and a '
          'map with no way to draw that is a map that flatters.'},
  {'place':'lodz','year':1825,'via':'institution','from':'chemnitz',
   'note':'Rembieliński plants a textile settlement by administrative fiat; Geyer’s steam mill 1839.'},
  {'place':'barcelona','year':1832,'via':'institution','from':'manchester',
   'note':'Bonaplata’s “El Vapor”, Spain’s first steam-powered factory. Burned by rioters in 1835; '
          'Catalan mechanisation survived it, the building did not.'},
  {'place':'bombay','year':1854,'via':'institution','from':'manchester',
   'note':'Cowasjee Nanabhoy Davar founds the Bombay Spinning and Weaving Company; it starts up in 1856. '
          'Lancashire yarn had already broken the Indian handloom’s export trade by 1830 — so the '
          'MACHINE arrives twenty-five years after the machine’s OUTPUT has done its work. Two '
          'diffusions run on this map at different speeds and the shape can only draw one of them.'},
  {'place':'osaka','year':1883,'via':'institution','from':'oldham',
   'note':'Shibusawa’s Osaka Spinning Mill: 10,500 spindles bought outright from Platt Brothers of '
          'Oldham, electric light, two shifts. Bought, not copied, not carried by a migrant — and by '
          'the 1930s Japan out-exported Lancashire.'},
  {'place':'shanghai','year':1890,'via':'institution','from':'oldham',
   'note':'The Shanghai Machine Weaving Bureau, a self-strengthening-movement project, after a decade '
          'of official obstruction.'},
 ],
}

COMPUTING = {
 'id': 'computing', 'name': 'Computing', 'cat': 'sci', 'spread': 'computing',
 'unit': 'CHANGES THREE TIMES — a machine, then a component, then a protocol. That is the finding.',
 'claim': 'Arrival = the first working machine at this place. The definition survives until 1947 and '
          'then quietly stops being about places at all.',
 'span': [1790, 1998],
 'precursors': [
  {'place':'lyon','year':1804,
   'note':'The Jacquard loom’s punched cards. Babbage took the card for the Analytical Engine’s store, '
          'and Hollerith took it again for the 1890 census. The one point where two of the four '
          'diffusions on this page physically touch — and neither map can express that.'},
 ],
 'origin': {'place':'london','year':1837,
   'note':'Babbage’s Analytical Engine: general-purpose, program-controlled, with a store and a mill — '
          'ON PAPER. It was never built. THE ORIGIN OF THIS DIFFUSION IS A DESIGN, and a design cannot '
          'diffuse the way a press or a mixture can. The shape assumes a working thing exists at the '
          'origin, and computing breaks that on the first row.'},
 'hops': [
  {'place':'berlin','year':1941,
   'note':'Zuse’s Z3: relays, binary floating point, program-controlled, built in his parents’ flat '
          'and destroyed by a bomb in 1943. Zuse had not read Babbage. No arc, because there is no line.'},
  {'place':'ames','year':1942,
   'note':'The Atanasoff–Berry Computer at Iowa State: electronic, binary, regenerative memory — and '
          'not programmable. Independent again.'},
  {'place':'bletchley','year':1944,'fate':'faded',
   'note':'Colossus: ten of them, electronic, running by 1944. Then dismantled, and the whole thing '
          'classified until 1975. A NODE THAT WORKED AND TRANSMITTED NOTHING. Every arc that should '
          'leave this dot was legally forbidden to exist, and a diffusion map that cannot draw a '
          'secret is missing one of the main ways technology fails to spread.'},
  {'place':'philadelphia','year':1945,'via':'migration','from':'ames','contested':True,'route':True,
   'note':'ENIAC at the Moore School. The arc to Ames is a COURT’S finding: Honeywell v. Sperry Rand '
          '(1973) voided the ENIAC patent as derived from Atanasoff’s machine, which Mauchly had visited '
          'in 1941. The builders denied it their whole lives. The map has to pick one, or say both.'},
  {'place':'manchester','year':1948,'via':'print','from':'philadelphia',
   'note':'The Small-Scale Experimental Machine ran the first stored program on 21 June 1948. The '
          'carrier is a document: von Neumann’s First Draft of a Report on the EDVAC, an unfinished '
          'internal memo circulated in June 1945 that thereby put the architecture in the public '
          'domain. The clearest single instance of `via: print` on any of these four maps.'},
  {'place':'cambridge','year':1949,'via':'print','from':'philadelphia',
   'note':'EDSAC. Wilkes read the EDVAC report, crossed the Atlantic for the 1946 Moore School lectures, '
          'and had a working service machine before anyone else.'},
  {'place':'kyiv','year':1951,
   'note':'Lebedev’s MESM at Feofaniya outside Kyiv — continental Europe’s first stored-program computer, '
          'built with no access to Western designs. Independent, and for thirty years barely visible '
          'to the literature that wrote the history.'},
  {'place':'murrayhill','year':1947,
   'note':'The transistor at Bell Labs, 23 December 1947. THE UNIT OF DIFFUSION CHANGES HERE. From this '
          'point what spreads is not a machine at a place but a COMPONENT, a design rule and a '
          'fabrication process — and the places that matter become fabs and patent pools.'},
  {'place':'dallas','year':1958,'via':'institution','from':'murrayhill',
   'note':'Kilby’s integrated circuit at Texas Instruments, 12 September 1958.'},
  {'place':'mountainview','year':1959,'via':'institution','from':'murrayhill','contested':True,
   'note':'Noyce’s planar IC at Fairchild, four months later. Ten years of litigation and a 1966 '
          'cross-licence; priority was never cleanly settled, so the map shows two origins for one thing.'},
  {'place':'poughkeepsie','year':1964,'via':'institution','from':'murrayhill',
   'note':'IBM System/360, 7 April 1964: not a machine but a compatible FAMILY — an architecture, which '
          'is a thing that can be copied without anything physical moving.'},
  {'place':'moscow','year':1969,'via':'copy','from':'poughkeepsie',
   'note':'The ES EVM decision: the USSR abandoned its own architectures to clone System/360 from '
          'documentation and smuggled machines. `copy` again — the second time this vocabulary needed '
          'a word for a transfer with no willing sender.'},
  {'place':'santaclara','year':1971,'via':'institution','from':'mountainview',
   'note':'The Intel 4004, November 1971. A computer becomes a part you can buy.'},
  {'place':'ucla','year':1969,
   'note':'ARPANET’s first host-to-host message, 29 October 1969, UCLA to SRI. Its parent is not a '
          'machine somewhere else; it is a funding programme. No field in the shape holds that.'},
  {'place':'albuquerque','year':1975,'via':'print','from':'santaclara',
   'note':'The MITS Altair 8800 on the January 1975 Popular Electronics cover. A magazine is the carrier, '
          'again — 500 years after Mainz the mechanism has not changed.'},
  {'place':'cupertino','year':1977,'via':'migration','from':'albuquerque',
   'note':'The Apple II. From here “arrival at a place” starts to mean a distribution channel.'},
  {'place':'bocaraton','year':1981,'via':'institution','from':'cupertino',
   'note':'The IBM PC, 12 August 1981 — an open bus and a BIOS that could be legally re-implemented. '
          'The clone industry that followed is the point at which counting arrivals by city stops '
          'measuring anything.'},
  {'place':'bangalore','year':1985,'via':'institution','from':'dallas',
   'note':'Texas Instruments opens in Bangalore with a satellite link. PRODUCTION, not use: a computer '
          'had reached India thirty years earlier, an HEC-2M at the Indian Statistical Institute in '
          '1955. Which of those two is “arrival”? The shape needs the question answered before it can '
          'hold either.'},
  {'place':'cern','year':1989,'via':'institution','from':'ucla',
   'note':'“Information Management: A Proposal”, March 1989; first server December 1990. The web is '
          'software running on a network that already reached everywhere the network reached — so the '
          'arc from UCLA is about lineage, not about anything travelling.'},
  {'place':'stanford','year':1991,'via':'institution','from':'cern',
   'note':'SLAC, December 1991: the first web server outside Europe. The last hop on this map that a '
          'PLACE genuinely carries.'},
  {'place':'urbana','year':1993,'via':'print','from':'cern',
   'note':'NCSA Mosaic, April 1993. After this the thing arrives everywhere a wire goes, at once, and '
          'the sentence “printing reached Venice in 1469” has no 1995 equivalent. The map should stop '
          'here and say why rather than fake a dot in every capital.'},
 ],
}

DIFFUSIONS = [PRINTING, GUNPOWDER, TEXTILE, COMPUTING]

# ═════════════════════════════════════════════════════════════════════════════
# VALIDATE — the cheapest ETL in the world, run against the hand-authored rows.
# Every complaint printed here is a constraint a real pipeline would have to
# satisfy, discovered by writing 82 rows by hand.
# ═════════════════════════════════════════════════════════════════════════════
VIA = {'trade', 'conquest', 'migration', 'print', 'institution', 'copy'}
problems, stats = [], {}
for d in DIFFUSIONS:
    seen = {d['origin']['place']: d['origin']['year']}
    for p in d.get('precursors', []):
        if p['place'] not in PLACES: problems.append(f"{d['id']}: unknown place {p['place']}")
    if d['origin']['place'] not in PLACES: problems.append(f"{d['id']}: unknown origin place")
    orphan = 0; back = 0
    for h in d['hops']:
        if h['place'] not in PLACES: problems.append(f"{d['id']}: unknown place {h['place']}")
        if h.get('via') and h['via'] not in VIA: problems.append(f"{d['id']}: unknown via {h['via']}")
        if not h.get('from'):
            orphan += 1
        else:
            if h['from'] not in seen:
                problems.append(f"{d['id']}: {h['place']} {h['year']} cites {h['from']}, which has no earlier arrival")
            elif seen[h['from']] > h['year']:
                back += 1
                problems.append(f"{d['id']}: {h['place']} {h['year']} descends from {h['from']} ({seen[h['from']]}) — later than the child")
        seen.setdefault(h['place'], h['year'])
    yrs = [h['year'] for h in d['hops']] + [d['origin']['year']]
    stats[d['id']] = {
        'hops': len(d['hops']),
        'orphans': orphan,
        'contested': sum(1 for h in d['hops'] if h.get('contested')),
        'routed': sum(1 for h in d['hops'] if h.get('route')),
        'faded': sum(1 for h in d['hops'] if h.get('fate') == 'faded'),
        'places': len({h['place'] for h in d['hops']} | {d['origin']['place']}),
        'revisits': len(d['hops']) + 1 - len({h['place'] for h in d['hops']} | {d['origin']['place']}),
        'span': [min(yrs), max(yrs)],
        'noted': sum(1 for h in d['hops'] if h.get('note')),
    }
for p in problems: print('  ! ' + p, file=sys.stderr)

used = {d['origin']['place'] for d in DIFFUSIONS}
for d in DIFFUSIONS:
    used |= {h['place'] for h in d['hops']} | {p['place'] for p in d.get('precursors', [])}
PLACES = {k: v for k, v in PLACES.items() if k in used}
n_corpus = sum(1 for v in PLACES.values() if v['src'] == 'corpus')
print(f'places used: {len(PLACES)}  from PLACEMAP: {n_corpus}  hand: {len(PLACES)-n_corpus}', file=sys.stderr)
print(f'hops: {sum(s["hops"] for s in stats.values())}  problems: {len(problems)}', file=sys.stderr)

# ── the corpus spreads these four correspond to ─────────────────────────────
CORPUS = {}
for d in DIFFUSIONS:
    s = SPREADS.get(d['spread'])
    if not s: continue
    CORPUS[d['id']] = {
        'id': s['id'], 'name': s['name'], 'kind': s.get('kind'),
        'start': s.get('start'), 'end': s.get('end'),
        'weight': s.get('weight', []), 'footprint': s.get('footprint', []),
        'note': s.get('note', ''), 'from': s.get('from', []), 'to': s.get('to', []),
    }

OUT = {
    'world': WORLD,
    'snapshots': SNAPSHOTS,
    'places': PLACES,
    'diffusions': DIFFUSIONS,
    'corpus': CORPUS,
    'stats': stats,
    'problems': problems,
    'via': sorted(VIA),
    'meta': {
        'placesTotal': len(CORPUS_PLACES),
        'placesUsed': len(PLACES),
        'placesFromCorpus': n_corpus,
        'spreadsInCorpus': len(SPREADS),
        'atlasEps': EPS,
        'atlasYears': SNAPSHOTS,
    },
}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.js')
with open(dst, 'w') as f:
    f.write('/* GENERATED by build-data.py. The atlas, the places and the corpus spreads are read\n')
    f.write('   out of web/public/data/*; the four diffusions are hand authored in build-data.py.\n')
    f.write('   Do not hand-edit this file — edit the generator. */\n')
    f.write('window.TM = ')
    json.dump(OUT, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(f'wrote {dst} — {os.path.getsize(dst)//1024} KB', file=sys.stderr)
