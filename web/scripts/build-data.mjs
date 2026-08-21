// Converts the prototype's JS data files into plain JSON served from public/data/.
// worlds.js   ->  public/data/worlds.json    (packed historical border geometry)
// datasets.js ->  public/data/datasets.json  ({LIVES, CATMAP, POLIS, BELIEF, POPDATA, PLACEMAP})
//
// Run:  npm run data
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const proto = path.resolve(here, '../../prototypes');
const out = path.resolve(here, '../public/data');
fs.mkdirSync(out, { recursive: true });

/** strip `const NAME=` ... `;` and JSON.parse the body */
function unwrap(src, name) {
  const re = new RegExp('^\\s*const\\s+' + name + '\\s*=');
  const m = src.match(re);
  if (!m) throw new Error(`could not find "const ${name}=" declaration`);
  let body = src.slice(m[0].length).trim();
  body = body.replace(/;\s*$/, '');
  return JSON.parse(body);
}

// ---- worlds ----
const worldsSrc = fs.readFileSync(path.join(proto, 'worlds.js'), 'utf8');
const WORLDS = unwrap(worldsSrc, 'WORLDS');
fs.writeFileSync(path.join(out, 'worlds.json'), JSON.stringify(WORLDS));

// ---- datasets (one `const X=...;` per line) ----
const dsSrc = fs.readFileSync(path.join(proto, 'datasets.js'), 'utf8');
const NAMES = ['LIVES', 'CATMAP', 'POLIS', 'BELIEF', 'POPDATA', 'PLACEMAP'];
const lines = dsSrc.split('\n').filter((l) => l.trim());
const datasets = {};
for (const name of NAMES) {
  const line = lines.find((l) => new RegExp('^\\s*const\\s+' + name + '\\s*=').test(l));
  if (!line) throw new Error(`datasets.js has no "const ${name}="`);
  datasets[name] = unwrap(line, name);
}
fs.writeFileSync(path.join(out, 'datasets.json'), JSON.stringify(datasets));

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('worlds.json  ', Object.keys(WORLDS).length, 'snapshots,', kb(path.join(out, 'worlds.json')));
console.log('datasets.json', NAMES.map((n) => `${n}:${Array.isArray(datasets[n]) ? datasets[n].length : Object.keys(datasets[n]).length}`).join(' '), kb(path.join(out, 'datasets.json')));

// ---- relations (spreads + weighted links) ----
// Prefer the curated files; fall back to the seeds so the Connections tab always boots.
const relDir = path.resolve(here, '../../data/relations');
const pick = (real, seed) => {
  const a = path.join(relDir, real), b = path.join(relDir, seed);
  return fs.existsSync(a) ? a : fs.existsSync(b) ? b : null;
};
const readRel = (file, key) => {
  if (!file) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j) ? j : (j[key] || []);
};
const spreadsFile = pick('spreads.json', 'spreads.seed.json');
const linksFile = pick('links.json', 'links.seed.json');
const relations = {
  spreads: readRel(spreadsFile, 'spreads'),
  links: readRel(linksFile, 'links'),
  _source: {
    spreads: spreadsFile ? path.basename(spreadsFile) : null,
    links: linksFile ? path.basename(linksFile) : null,
  },
};
fs.writeFileSync(path.join(out, 'relations.json'), JSON.stringify(relations));
console.log(
  'relations.json',
  `spreads:${relations.spreads.length} links:${relations.links.length}`,
  `(${relations._source.spreads || 'none'} + ${relations._source.links || 'none'})`,
  kb(path.join(out, 'relations.json')),
);

// ---- curated lanes (the lane registry + its members) ----
// data/lanes.json is authored with {id,label,members:[{name,type,start,end,cat,imp,
// sharpness,tags,note,lat,lon,place}]}. Normalize to the runtime shape the loader
// expects — key/si/default on lanes, id/lvl on members — and ALWAYS write a file
// (boot must never break on a missing registry).
const lanesSrc = path.resolve(here, '../../data/lanes.json');
const laneOut = { lanes: [] };
const LANE_KEYS = {
  arts: ['AR', 'Arts', 4, true],
  design: ['DS', 'Design', 3, false],
};
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
if (!fs.existsSync(lanesSrc)) {
  console.warn('lanes.json: data/lanes.json missing — writing an empty registry');
} else {
  const raw = JSON.parse(fs.readFileSync(lanesSrc, 'utf8'));
  // the three built-in curated lanes first: their members remain the EVENTS rows with
  // that band key — unification without data migration.
  laneOut.lanes.push(
    { key: 'MU', label: 'Music', si: 4, default: false, members: [] },
    { key: 'SC', label: 'Science & ideas', si: 5, default: false, members: [] },
    { key: 'MZ', label: 'Mozart', si: 6, default: false, members: [] },
  );
  for (const L of raw.lanes || []) {
    const fall = LANE_KEYS[L.id] || [String(L.key || (L.id || 'xx').slice(0, 2)).toUpperCase(), L.label || L.id, null, false];
    const laneKey = String(L.key || fall[0]).toUpperCase();
    const existing = laneOut.lanes.findIndex((x) => x.key === laneKey);
    const lane = {
      key: laneKey,
      label: L.label || fall[1],
      si: L.si ?? fall[2],
      default: !!(L.default ?? fall[3]),
      members: (L.members || []).map((m) => ({
        id: m.id || slug(m.name),
        name: m.name,
        start: m.start,
        end: m.end,
        type: m.type === 'spread' ? 'movement' : (m.type || 'movement'),
        cat: m.cat || 'art',
        lvl: m.lvl ?? m.imp ?? 3,
        sharpness: m.sharpness ?? 0.5,
        note: m.note || '',
        tags: m.tags || '',
        ...(m.lat != null && m.lon != null ? { lat: m.lat, lon: m.lon, place: m.place || '' } : {}),
      })),
    };
    if (existing >= 0) laneOut.lanes[existing] = lane; else laneOut.lanes.push(lane);
  }
  // validate HARD — a bad registry must fail the build, not the boot
  const seenKeys = new Set();
  for (const lane of laneOut.lanes) {
    if (['CO', 'EU', 'ME', 'AS', 'AM'].includes(lane.key)) throw new Error(`lanes.json: lane key ${lane.key} collides with a band`);
    if (seenKeys.has(lane.key)) throw new Error(`lanes.json: duplicate lane key ${lane.key}`);
    seenKeys.add(lane.key);
    if (!(lane.si === null || (Number.isInteger(lane.si) && lane.si >= 0 && lane.si <= 7))) throw new Error(`lanes.json: lane ${lane.key} si out of range`);
    const ids = new Set();
    for (const m of lane.members) {
      if (ids.has(m.id)) throw new Error(`lanes.json: duplicate member id ${lane.key}:${m.id}`);
      ids.add(m.id);
      if (!(m.end === 0 || m.start < m.end)) throw new Error(`lanes.json: ${lane.key}:${m.id} has start >= end`);
      if (!(m.sharpness >= 0 && m.sharpness <= 1)) throw new Error(`lanes.json: ${lane.key}:${m.id} sharpness out of [0,1]`);
      if (!(Number.isInteger(m.lvl) && m.lvl >= 1 && m.lvl <= 5)) throw new Error(`lanes.json: ${lane.key}:${m.id} lvl out of 1..5`);
    }
  }
}
fs.writeFileSync(path.join(out, 'lanes.json'), JSON.stringify(laneOut));
console.log(
  'lanes.json   ',
  laneOut.lanes.map((l) => `${l.key}:${l.members.length}`).join(' ') || 'empty',
  kb(path.join(out, 'lanes.json')),
);
