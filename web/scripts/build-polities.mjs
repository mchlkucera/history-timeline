/**
 * build-polities.mjs — join the curated polity table (../data/polities-*.json)
 * onto the free-text sovereign strings that actually appear in worlds.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * worlds.js labels each patch of territory with whatever string the source map
 * used at that date: "Rome" at 323 BC, "Roman Empire" at 1 BC, "Eastern Roman
 * Empire" at 400, "Byzantine Empire" at 800. Nothing in the file says those are
 * the same polity, so tracing by string gives you a single 6-unit-thick disc.
 * The polity table has stable ids and a lineage graph but no geometry. This
 * script is the join: polity id -> {snapshot year -> [sovereign strings]}.
 *
 * Reads public/data/world-block.json, so build-cube-data.mjs must run first.
 * Emits public/data/polities.json.
 *
 * MATCHING LAYER (three rules, in order, all time-gated)
 *   1. exact  — normalised strings identical
 *   2. core   — token sets identical after dropping {empire, kingdom, dynasty,
 *               of, the, and}. Catches "Empire of Ghana" == "Ghana Empire",
 *               "Song Empire" == "Song Dynasty".
 *   3. alias  — a hand-written table below, because "Persi", "Manchu Empire"
 *               and "USSR" are never going to fall out of an algorithm.
 *
 * TIME GATE. Names are reused across millennia ("Egypt", "Russia", "France",
 * "China"). A match only counts if the snapshot year is inside the polity's
 * own [start, end]. Rules 1-2 get 200 years of slack, because the 18 snapshot
 * dates are arbitrary and often sit just outside a span (the Inca Empire is
 * labelled at the 1600 snapshot though it fell in 1533). Aliases get 60 years
 * by default, or an explicit window when the same string has to be split
 * between two polities ("Russia" -> Russian Empire before 1917, Russian
 * Federation after 1991).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.resolve(ROOT, '../data');
const BLOCK = path.resolve(ROOT, 'public/data/world-block.json');
const OUT = path.resolve(ROOT, 'public/data/polities.json');

const FILES = ['polities-eu.json', 'polities-me.json', 'polities-as.json', 'polities-am.json'];
const CORE_SLACK = 200;   // years, rules 1-2
const ALIAS_SLACK = 60;   // years, rule 3 default

// ── the hand-written half of the join ────────────────────────────────────────
// value: 'String'  |  ['String', firstSnapshotYear, lastSnapshotYear]
const ALIAS = {
  // ---- Rome and its heirs (the canonical chain) ----
  'roman-republic': ['Rome', 'Roman Republic'],
  'roman-empire': ['Roman Empire'],
  'western-roman-empire': ['Western Roman Empire', 'Visigoths'],
  'byzantine-empire': ['Eastern Roman Empire', 'Byzantine Empire', 'Trebizond'],
  'ottoman-empire': ['Ottoman Empire'],
  // ---- Europe ----
  'greek-city-states': ['Greek city-states'],
  'macedon': ['Empire of Alexander', 'Macedon'],
  'celtic-culture': ['Celtic kingdoms', 'Celts'],
  'visigothic-kingdom': ['Visigoths'],
  'frankish-empire': ['Carolingian Empire', 'Franks'],
  'holy-roman-empire': ['Holy Roman Empire'],
  'papal-states': ['Papal States'],
  'republic-of-venice': ['Venice'],
  'norse-vikings': ['Northmen', 'Danes', 'Swedes and Goths', 'Swedes'],
  'kievan-rus': ['Kyivan Rus', "Rus' Khaganate", 'Kievan Rus'],
  'england': ['England', 'England and Ireland'],
  'british-empire': ['United Kingdom', 'United Kingdom of Great Britain and Ireland', 'Great Britain', 'UK'],
  'kingdom-of-france': [['France', -3000, 1783]],
  'french-empire': [['France', 1815, 1994]],
  'spanish-empire': ['Spain', 'Castille', 'Castile', 'Castilla'],
  'portuguese-empire': ['Portugal'],
  'dutch-empire': ['Netherlands', 'Habsburg Netherlands', 'United Provinces'],
  'polish-lithuanian-commonwealth': ['Poland-Lithuania', 'Poland-Llituania', 'Polish–Lithuanian Commonwealth'],
  'swedish-empire': [['Sweden', 1600, 1783]],
  'habsburg-monarchy': ['Austrian Empire', 'Imperial Hungary'],
  'austria-hungary': ['Austria Hungary', 'Austro-Hungarian Empire'],
  'prussia': ['Prussia'],
  'german-empire': [['Germany', 1871, 1918], 'German Empire'],
  'nazi-germany': [['Germany', 1933, 1945]],
  'germany': [['Germany', 1949, 2026], ['West Germany', 1949, 2026], ['East Germany', 1949, 1990]],
  'muscovy': ['Tsardom of Muscovy', 'Grand Duchy of Moscow', 'Muscovy'],
  'russian-empire': [['Russia', 1721, 1917], 'Russian Empire'],
  'soviet-union': ['USSR'],
  'russian-federation': [['Russia', 1991, 2026]],
  'italy': ['Italy'],
  // ---- Middle East and Africa ----
  'ancient-egypt': [['Egypt', -3100, -30]],
  'assyria': ['Assyria', 'Assyrians'],
  'babylonia': ['Babylonia', 'Babylon'],
  'hittite-empire': ['Hittites'],
  'phoenicia-carthage': ['Carthaginian Empire', 'Carthage', 'Phoenicians'],
  'parthian-empire': ['Parthian Empire', 'Suren Kingdom'],
  'sassanid-persia': ['Persi', 'Sassanid Empire'],
  'safavid-persia': ['Safavid Empire'],
  'iran': [['Persia', 1796, 2026], 'Iran'],
  'seleucid-empire': ['Seleucid Empire', 'Seleucids'],
  'rashidun-caliphate': ['Rashidun Caliphate'],
  'umayyad-caliphate': ['Umayyad Caliphate', 'Caliphate of Córdoba', 'Emirate of Córdoba'],
  'abbasid-caliphate': ['Abbasid Caliphate'],
  'fatimid-caliphate': ['Fatimid Caliphate'],
  'seljuk-empire': ['Seljuk Empire', 'Seljuks', 'Sultanate of Rum'],
  'ayyubid-sultanate': ['Ayyubid Sultanate'],
  'mamluk-sultanate': ['Mamluke Sultanate', 'Mamluk Sultanate'],
  'aksum': ['Axum', 'Aksum'],
  'kingdom-of-kush': ['Kush', 'Meroe'],
  'ghana-empire': ['Ghana', 'Empire of Ghana'],
  'mali-empire': [['Mali', 1235, 1670]],
  'songhai-empire': ['Songhai'],
  'great-zimbabwe': ['Great Zimbabwe', 'Mwenemutapa'],
  'kingdom-of-kongo': [['Congo', 1390, 1914]],
  'ethiopian-empire': ['Ethiopia', 'Shoa', 'Abyssinia'],
  'zulu-kingdom': ['Zulu', 'Zululand'],
  'turkey': ['Turkey'],
  'saudi-arabia': ['Saudi Arabia', 'Arabia (Nejd)'],
  'israel': [['Israel', 1948, 2026]],
  'south-africa': ['South Africa', 'Union of South Africa'],
  // ---- Asia ----
  'indus-valley-civilization': ['Indus valley civilization'],
  'shang-dynasty': ['Shang'],
  'zhou-dynasty': ['Zhou', 'Chou', 'Zhoa'],
  'qin-dynasty': ['Qin'],
  'han-dynasty': ['Han'],
  'three-kingdoms': ['Three Kingdoms'],
  'jin-dynasty': ['Jin'],
  'sui-dynasty': ['Sui'],
  'tang-dynasty': ['Tang Empire'],
  'song-dynasty': ['Song Empire'],
  'yuan-dynasty': [['Mongol Empire', 1271, 1368]],
  'ming-dynasty': ['Ming Empire', 'Ming Chinese Empire'],
  'qing-dynasty': ['Qing Empire', 'Manchu Empire'],
  'republic-of-china': ['Chinese warlords', 'Taiwan'],
  'peoples-republic-of-china': [['China', 1949, 2026]],
  'xiongnu': ['Xiongnu'],
  'gokturk-khaganate': ['Turkish Khanate', 'Gokturks'],
  'maurya-empire': ['Maurya Empire', 'Mauryan Empire'],
  'gupta-empire': ['Gupta Empire'],
  'delhi-sultanate': ['Sultanate of Delhi'],
  'mughal-empire': ['Mughal Empire'],
  'british-raj': ['British East India Company', ['India', 1858, 1947]],
  'republic-of-india': [['India', 1947, 2026]],
  'timurid-empire': ['Timurid Emirates', 'Timurid Empire'],
  'mongol-empire': [['Mongol Empire', 1206, 1300]],
  'khmer-empire': ['Khmer Empire'],
  'srivijaya': ['Srivijaya Empire'],
  'majapahit': ['Majapahit'],
  'dai-viet': ['Đại Việt', 'Dai Viet', 'Annam'],
  'goryeo': [['Korea', 918, 1392]],
  'joseon': [['Korea', 1392, 1910]],
  'yamato-japan': [['Japan', 300, 794]],
  'heian-japan': ['Imperial Japan (Fujiwara)'],
  'kamakura-shogunate': ['Shogun Japan (Kamakura)'],
  'ashikaga-shogunate': [['Japan', 1336, 1573]],
  'tokugawa-shogunate': [['Japan', 1603, 1868], 'Japan (Warring States)'],
  'empire-of-japan': ['Empire of Japan', 'Imperial Japan'],
  'japan': [['Japan', 1947, 2026]],
  // ---- Americas and Oceania ----
  'olmec-civilization': ['Olmec'],
  'zapotec-civilization': ['Monte Albán', 'Monte Alb�n', 'Zapotec Empire'],
  'teotihuacan': ['Teotihuacán', 'Teotihuac�n'],
  'maya-city-states': ['Maya city-states', 'Maya chiefdoms and states', 'Mayas'],
  'toltec-empire': ['Toltec Empire'],
  'aztec-empire': ['Mexihcah (Triple Alliance)', 'Aztec Empire'],
  'chavin-culture': ['Chavin'],
  'moche-civilization': ['Moche'],
  'tiwanaku-empire': ['Tiahuanaco Empire'],
  'wari-empire': ['Huari Empire'],
  'inca-empire': ['Inca Empire'],
  'ancestral-puebloans': ['Anasazi', 'Pueblos'],
  'mississippian-culture': ['Hopewell Culture', 'Mississippian culture'],
  'iroquois-confederacy': ['Iroquois', 'Ho-de-no-sau-nee-ga (Haudenosaunee)'],
  'comanche-empire': ['Comanche', 'Nʉmʉnʉʉ (Comanche)'],
  'new-spain': ['New Spain', 'Viceroyalty of New Spain', 'Vice Royalty of New Spain', 'Cuba (Spain)', 'Hispaniola (Spain)'],
  'viceroyalty-of-peru': ['Viceroyalty of Peru'],
  'portuguese-brazil': [['Brazil', 1500, 1822], 'Kingdom of Brazil'],
  'new-france': ['New France'],
  'british-america': ['British America', 'Thirteen Colonies'],
  'united-states': ['United States', 'United States of America'],
  'canada': ['Canada'],
  'mexico': ['Mexico'],
  'brazil': [['Brazil', 1822, 2026], 'Kingdom of Brazil'],
  'argentina': ['Argentina'],
  'gran-colombia': ['Gran Colombia'],
  'aboriginal-australian-nations': ['Australian aboriginal hunter-gatherers', 'Aboriginal tribes'],
  'maori-aotearoa': ['Maori', 'Maoris'],
  'australia': ['Australia'],
  'hawaiian-kingdom': ['Hawaii', 'Hawaiian Kingdom']
};

// ── normalisation ────────────────────────────────────────────────────────────
const GENERIC = new Set(['empire', 'kingdom', 'dynasty', 'of', 'the', 'and']);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const coreKey = (s) => norm(s).split(' ').filter(w => w && !GENERIC.has(w)).sort().join(' ');

// ── load ─────────────────────────────────────────────────────────────────────
const block = JSON.parse(fs.readFileSync(BLOCK, 'utf8'));
const YEARS = block.years;

const polities = [];
for (const f of FILES) {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) { console.error(`  !! missing ${p}`); continue; }
  polities.push(...JSON.parse(fs.readFileSync(p, 'utf8')).polities);
}
if (!polities.length) throw new Error('no polity table found — expected ' + DATA);

const byId = new Map(polities.map(p => [p.id, p]));

// integrity re-check (the table was audited upstream; verify it here too)
let dangling = 0, asym = 0;
for (const p of polities) {
  for (const t of p.to) { if (!byId.has(t)) dangling++; else if (!byId.get(t).from.includes(p.id)) asym++; }
  for (const f of p.from) { if (!byId.has(f)) dangling++; }
}

// per-snapshot sovereign strings + their area, so we can rank
const yearSovs = YEARS.map(y => {
  const m = new Map();
  for (const f of block.byYear[y]) m.set(f.s, (m.get(f.s) ?? 0) + f.a);
  return m;
});
const universe = new Set();
for (const m of yearSovs) for (const k of m.keys()) universe.add(k);

// normalised lookup: normalised string -> [actual sovereign strings]
const byNorm = new Map(), byCore = new Map();
for (const s of universe) {
  (byNorm.get(norm(s)) ?? byNorm.set(norm(s), []).get(norm(s))).push(s);
  (byCore.get(coreKey(s)) ?? byCore.set(coreKey(s), []).get(coreKey(s))).push(s);
}

// ── the join ─────────────────────────────────────────────────────────────────
const RULE = { exact: 1, core: 2, alias: 3 };
let nExact = 0, nCore = 0, nAlias = 0;

for (const p of polities) {
  /** sovereign string -> { rule, y0, y1 } */
  const claims = new Map();
  const add = (s, rule, y0, y1) => {
    const prev = claims.get(s);
    if (!prev || prev.rule > rule) claims.set(s, { rule, y0, y1 });
  };

  for (const s of byNorm.get(norm(p.name)) ?? []) { add(s, RULE.exact, p.start - CORE_SLACK, p.end + CORE_SLACK); nExact++; }
  for (const s of byCore.get(coreKey(p.name)) ?? []) { add(s, RULE.core, p.start - CORE_SLACK, p.end + CORE_SLACK); nCore++; }
  for (const a of ALIAS[p.id] ?? []) {
    const [name, y0, y1] = Array.isArray(a) ? a : [a, p.start - ALIAS_SLACK, p.end + ALIAS_SLACK];
    for (const s of byNorm.get(norm(name)) ?? []) { add(s, RULE.alias, y0, y1); nAlias++; }
  }

  // resolve against the snapshots
  const match = {};
  let area = 0, span = 0;
  YEARS.forEach((y, i) => {
    const hit = [];
    for (const [s, g] of claims) if (y >= g.y0 && y <= g.y1 && yearSovs[i].has(s)) hit.push(s);
    if (hit.length) { match[y] = hit; span++; for (const s of hit) area += yearSovs[i].get(s); }
  });
  p.match = match;
  p.span = span;
  p.area = Math.round(area);
  p.possible = YEARS.filter(y => y >= p.start && y <= p.end).length;
  p.claims = [...claims.keys()];
}

// ── report ───────────────────────────────────────────────────────────────────
const good = polities.filter(p => p.span >= 2);
const one = polities.filter(p => p.span === 1);
const zeroStructural = polities.filter(p => p.span === 0 && p.possible <= 1);
const zeroMiss = polities.filter(p => p.span === 0 && p.possible >= 2);

console.log('── build-polities ─────────────────────────────');
console.log(`  table        ${polities.length} polities  (dangling links ${dangling}, asymmetric ${asym})`);
console.log(`  forks        ${polities.filter(p => p.to.length > 1).length} polities with >1 successor`);
console.log(`  claims       exact ${nExact}  core ${nCore}  alias ${nAlias}`);
console.log(`  RESOLVED >=2 snapshots : ${good.length}/${polities.length}  (${(100 * good.length / polities.length).toFixed(0)}%)`);
console.log(`  resolved  1 snapshot   : ${one.length}`);
console.log(`  0, span covers <2 snaps: ${zeroStructural.length}  (structural — the 18 dates cannot show it)`);
console.log(`  0, span covers >=2     : ${zeroMiss.length}  (real matching misses)`);
if (zeroMiss.length) console.log('    misses: ' + zeroMiss.map(p => `${p.id}(${p.possible})`).join(', '));
if (one.length) console.log('    single: ' + one.map(p => p.id).join(', '));
const chain = ['roman-republic', 'roman-empire', 'western-roman-empire', 'byzantine-empire', 'ottoman-empire'];
console.log('  canonical chain:');
for (const id of chain) {
  const p = byId.get(id);
  console.log(`    ${id.padEnd(22)} ${String(p.span).padStart(2)} snaps  ${Object.keys(p.match).join(',') || '—'}`);
}

const payload = {
  years: YEARS,
  polities: polities.map(p => ({
    id: p.id, name: p.name, note: p.note, region: p.region,
    start: p.start, end: p.end, from: p.from, to: p.to,
    weight: Math.max(0, ...p.weight.map(w => w[1])),
    span: p.span, area: p.area, possible: p.possible, match: p.match
  })),
  stats: {
    total: polities.length, resolved2: good.length, resolved1: one.length,
    zeroStructural: zeroStructural.length, zeroMiss: zeroMiss.length,
    misses: zeroMiss.map(p => p.id)
  }
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`  wrote        ${OUT}  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
