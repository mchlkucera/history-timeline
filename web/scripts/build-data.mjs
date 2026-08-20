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
