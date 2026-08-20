/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= MAP · PEOPLE =================
// Replaces the "breathing cartogram" (one circle per macro-region). A circle over
// "the Americas" tells you nothing about WHERE the people are, so this draws a coarse
// density field over the land instead.
//
// WHAT IS DATA AND WHAT IS MODEL — read this before trusting a pixel.
//   DATA  : the eight macro-region totals per time slice (POPDATA in datasets.json,
//           after McEvedy & Jones / Biraben / UN). Every region's field is normalised
//           so it sums back to exactly that published number. The macro totals on
//           screen are the scholarly estimates, unaltered.
//   MODEL : the distribution INSIDE each region. It is a hand-written table of 101
//           population centres (§ CENTRES) plus a physical-geography field (§ ZONES:
//           deserts, ice, rainforest, altitude, latitude). Nobody measured this. It is
//           an illustration of concentration, drawn to be honest about shape — the
//           Nile as a thread, the Gangetic plain and the North China plain as the two
//           heaviest patches on Earth, the Sahara and Siberia as blanks — not a source.
//   The caption says all of this on screen, every frame. Do not remove that sentence.
//
// The grid is deliberately visible (discrete cells, "Plate") so the reader can see the
// resolution of the claim. "Field" smooths it for legibility; it is the same numbers.
//
// DOM ids: popCanvas / popCap / popPanel / popYear / popSlider / popPlay, with the
// legacy carto* ids accepted as a fallback so this survives the shell rewrite either way.

import {
  $, GEO, POPS, clamp, fitCanvas, fmtY, fontMono, fontUI, hideTip, reduceMotion, repaintOnFonts, showTip,
  tokens, type Tokens,
} from './shared';

// ---------------------------------------------------------------- geography model
// A population centre. `w0` is its weight in the agrarian world (~1 CE), `w1` its
// weight in the industrial one; the view interpolates between them. Weights are
// RELATIVE WITHIN A REGION only — they are normalised away against the published
// regional total, so a "100" in Europe and a "100" in Oceania are not comparable.
// `lo2`/`la2` make a kernel a river reach rather than a blob.
interface Centre { n: string; lo: number; la: number; lo2?: number; la2?: number; r: number; w0: number; w1: number }

const CENTRES: Centre[] = [
  // ---- East Asia
  { n: 'North China plain', lo: 115, la: 35.5, r: 3.2, w0: 100, w1: 88 },
  { n: 'Yellow River', lo: 110, la: 37.5, lo2: 118, la2: 37.5, r: 1.4, w0: 40, w1: 30 },
  { n: 'Yangtze delta', lo: 120, la: 31.3, r: 2.2, w0: 62, w1: 100 },
  { n: 'Yangtze', lo: 106, la: 30, lo2: 120, la2: 31.5, r: 1.2, w0: 30, w1: 42 },
  { n: 'Sichuan basin', lo: 105, la: 30.4, r: 1.9, w0: 36, w1: 46 },
  { n: 'Pearl River delta', lo: 113.3, la: 23.2, r: 1.6, w0: 16, w1: 72 },
  { n: 'Middle Yangtze', lo: 113, la: 30, r: 2.3, w0: 34, w1: 48 },
  { n: 'Wei valley', lo: 109, la: 34.3, r: 1.4, w0: 30, w1: 18 },
  { n: 'Japan', lo: 137, la: 35.5, r: 2.4, w0: 26, w1: 68 },
  { n: 'Korea', lo: 127.5, la: 36.8, r: 1.7, w0: 15, w1: 36 },
  { n: 'Manchuria', lo: 125, la: 44, r: 3, w0: 4, w1: 34 },
  { n: 'Yunnan', lo: 103, la: 25, r: 2.4, w0: 8, w1: 18 },
  { n: 'Taiwan', lo: 121, la: 23.8, r: 0.9, w0: 2, w1: 12 },
  // ---- South Asia
  { n: 'Gangetic plain', lo: 79, la: 27.2, lo2: 87, la2: 25, r: 2.2, w0: 100, w1: 100 },
  { n: 'Bengal delta', lo: 89.5, la: 23.6, r: 1.9, w0: 68, w1: 96 },
  { n: 'Indus valley', lo: 73, la: 32, lo2: 68.5, la2: 25.5, r: 1.5, w0: 46, w1: 58 },
  { n: 'Deccan', lo: 76, la: 18, r: 3, w0: 34, w1: 46 },
  { n: 'Tamil country', lo: 79, la: 11.5, r: 1.9, w0: 34, w1: 40 },
  { n: 'Gujarat', lo: 72.3, la: 22.3, r: 1.6, w0: 20, w1: 30 },
  { n: 'Malabar', lo: 76, la: 10.5, r: 1.3, w0: 16, w1: 20 },
  { n: 'Sri Lanka', lo: 80.7, la: 7.6, r: 1.1, w0: 10, w1: 12 },
  { n: 'Terai', lo: 85, la: 27, r: 1.4, w0: 8, w1: 12 },
  // ---- Southeast Asia
  { n: 'Java', lo: 110, la: -7.2, r: 2.2, w0: 46, w1: 100 },
  { n: 'Red River delta', lo: 105.8, la: 20.8, r: 1.3, w0: 36, w1: 46 },
  { n: 'Mekong delta', lo: 106, la: 10.4, r: 1.3, w0: 15, w1: 46 },
  { n: 'Chao Phraya', lo: 100.4, la: 15, r: 1.8, w0: 21, w1: 40 },
  { n: 'Irrawaddy', lo: 96, la: 19, r: 2.2, w0: 21, w1: 30 },
  { n: 'Luzon & Visayas', lo: 122, la: 13, r: 2, w0: 15, w1: 46 },
  { n: 'Sumatra', lo: 101, la: 0, r: 3, w0: 10, w1: 26 },
  { n: 'Malaya', lo: 102, la: 4, r: 1.4, w0: 6, w1: 18 },
  { n: 'Borneo & Sulawesi', lo: 117, la: -1, r: 3.4, w0: 5, w1: 12 },
  // ---- Europe
  { n: 'Po valley', lo: 10, la: 45.2, r: 1.6, w0: 46, w1: 44 },
  { n: 'Central Italy', lo: 12.6, la: 42, r: 1.4, w0: 30, w1: 26 },
  { n: 'Aegean & S Italy', lo: 20, la: 39, r: 2.8, w0: 36, w1: 24 },
  { n: 'Iberia', lo: -4, la: 39.5, r: 3.2, w0: 30, w1: 42 },
  { n: 'Paris basin', lo: 2.3, la: 48.5, r: 2.3, w0: 30, w1: 56 },
  { n: 'Rhine & Low Countries', lo: 7.5, la: 47, lo2: 4.5, la2: 52, r: 1.5, w0: 26, w1: 82 },
  { n: 'England', lo: -1.4, la: 52.3, r: 1.8, w0: 15, w1: 76 },
  { n: 'Central Germany', lo: 11, la: 51, r: 2.3, w0: 15, w1: 54 },
  { n: 'Danube basin', lo: 22, la: 46, r: 2.8, w0: 18, w1: 34 },
  { n: 'Vistula plain', lo: 20, la: 52, r: 2.4, w0: 12, w1: 40 },
  { n: 'Dnipro & Ukraine', lo: 32, la: 49.5, r: 2.8, w0: 12, w1: 40 },
  { n: 'Volga-Oka', lo: 40, la: 55.5, r: 3.2, w0: 8, w1: 46 },
  { n: 'Volga', lo: 44, la: 48, lo2: 48, la2: 56, r: 1.4, w0: 5, w1: 18 },
  { n: 'S Scandinavia', lo: 14, la: 58, r: 2.4, w0: 6, w1: 18 },
  { n: 'W Balkans', lo: 19, la: 44, r: 1.9, w0: 10, w1: 14 },
  { n: 'Urals', lo: 62, la: 56, r: 3.6, w0: 2, w1: 14 },
  { n: 'Trans-Siberian ribbon', lo: 75, la: 55, lo2: 113, la2: 53, r: 2.2, w0: 1, w1: 8 },
  { n: 'Fergana & Tashkent', lo: 69, la: 41, r: 2.2, w0: 11, w1: 18 },
  { n: 'Caucasus', lo: 45, la: 41.5, r: 1.7, w0: 9, w1: 15 },
  // ---- Middle East & North Africa
  { n: 'Nile delta', lo: 31, la: 30.8, r: 1.1, w0: 62, w1: 94 },
  { n: 'Nile valley', lo: 31.2, la: 30, lo2: 32.9, la2: 24, r: 0.55, w0: 100, w1: 82 },
  { n: 'Nubian Nile', lo: 32.9, la: 24, lo2: 32.6, la2: 15.5, r: 0.6, w0: 26, w1: 34 },
  { n: 'Mesopotamia', lo: 44.5, la: 33.5, lo2: 47, la2: 30.5, r: 1.5, w0: 72, w1: 46 },
  { n: 'Levant', lo: 35.5, la: 33, r: 1.4, w0: 42, w1: 46 },
  { n: 'W Anatolia', lo: 29, la: 39.5, r: 2.3, w0: 36, w1: 54 },
  { n: 'E Anatolia', lo: 39, la: 38.5, r: 2.3, w0: 15, w1: 24 },
  { n: 'Iranian plateau', lo: 51, la: 35, r: 2.4, w0: 30, w1: 56 },
  { n: 'Maghreb coast', lo: 1, la: 35.5, r: 3.4, w0: 30, w1: 56 },
  { n: 'Yemen highlands', lo: 44, la: 15, r: 1.4, w0: 16, w1: 22 },
  { n: 'Gulf coast', lo: 50, la: 26.5, r: 1.5, w0: 4, w1: 22 },
  { n: 'Hejaz', lo: 40, la: 21.5, r: 1.5, w0: 7, w1: 12 },
  { n: 'Khorasan', lo: 61, la: 35, r: 2.3, w0: 13, w1: 24 },
  // ---- Sub-Saharan Africa
  { n: 'Nigeria & Sahel farms', lo: 7.5, la: 9.5, r: 2.8, w0: 46, w1: 100 },
  { n: 'Ethiopian highlands', lo: 38.5, la: 9.5, r: 2.4, w0: 40, w1: 62 },
  { n: 'African Great Lakes', lo: 31, la: -2, r: 2.1, w0: 36, w1: 56 },
  { n: 'Congo & Kasai', lo: 22, la: -5, r: 3, w0: 9, w1: 15 },
  { n: 'Guinea coast', lo: -3, la: 7, r: 2.4, w0: 26, w1: 46 },
  { n: 'Niger bend', lo: -2, la: 14, r: 3.2, w0: 20, w1: 26 },
  { n: 'Kenya highlands', lo: 37, la: -1.5, r: 2.2, w0: 20, w1: 40 },
  { n: 'Zambezi plateau', lo: 29, la: -17, r: 2.8, w0: 15, w1: 26 },
  { n: 'Highveld & Cape', lo: 27, la: -27, r: 2.8, w0: 12, w1: 30 },
  { n: 'Madagascar', lo: 47, la: -19, r: 2.2, w0: 8, w1: 18 },
  { n: 'Angolan highlands', lo: 15, la: -11, r: 2.4, w0: 10, w1: 18 },
  { n: 'Chad & Kordofan', lo: 20, la: 12.5, r: 3, w0: 10, w1: 16 },
  // ---- Americas
  { n: 'Basin of Mexico', lo: -99, la: 19.4, r: 1.8, w0: 100, w1: 74 },
  { n: 'Maya lowlands', lo: -90, la: 16, r: 1.7, w0: 46, w1: 30 },
  { n: 'Central Andes', lo: -73, la: -13, r: 2.4, w0: 92, w1: 40 },
  { n: 'Northern Andes', lo: -75.5, la: 4, r: 2.3, w0: 40, w1: 48 },
  { n: 'Caribbean', lo: -74, la: 19, r: 2.4, w0: 20, w1: 26 },
  { n: 'Mississippi woodlands', lo: -88, la: 34, r: 2.8, w0: 12, w1: 54 },
  { n: 'Northeast seaboard', lo: -74.5, la: 40.6, r: 1.9, w0: 5, w1: 92 },
  { n: 'Great Lakes', lo: -85, la: 42, r: 2.8, w0: 5, w1: 70 },
  { n: 'California', lo: -120, la: 36, r: 2.4, w0: 6, w1: 56 },
  { n: 'Texas & the Gulf', lo: -96.5, la: 30.5, r: 2.4, w0: 4, w1: 42 },
  { n: 'Pacific Northwest', lo: -122, la: 47.5, r: 1.9, w0: 3, w1: 26 },
  { n: 'St Lawrence', lo: -75, la: 45.5, r: 2.3, w0: 3, w1: 34 },
  { n: 'São Paulo & Rio', lo: -46, la: -23, r: 2.3, w0: 8, w1: 92 },
  { n: 'Brazilian northeast', lo: -38, la: -9, r: 2.4, w0: 10, w1: 46 },
  { n: 'Río de la Plata', lo: -58.5, la: -34.5, r: 1.9, w0: 5, w1: 42 },
  { n: 'Central Chile', lo: -71, la: -34, r: 1.4, w0: 8, w1: 26 },
  { n: 'Amazonia', lo: -60, la: -4, r: 3, w0: 3, w1: 5 },
  { n: 'Pueblo southwest', lo: -110, la: 35, r: 1.9, w0: 8, w1: 15 },
  { n: 'Great Plains', lo: -100, la: 42, r: 2.8, w0: 5, w1: 15 },
  // ---- Oceania
  { n: 'Southeast Australia', lo: 148, la: -35, r: 2.4, w0: 8, w1: 100 },
  { n: 'New Guinea highlands', lo: 144, la: -6, r: 1.9, w0: 46, w1: 42 },
  { n: 'New Zealand', lo: 174, la: -40, r: 1.9, w0: 8, w1: 36 },
  { n: 'Southwest Australia', lo: 116, la: -32, r: 1.4, w0: 4, w1: 30 },
  { n: 'Queensland coast', lo: 147, la: -21, r: 2.4, w0: 6, w1: 20 },
  { n: 'Australian north', lo: 133, la: -18, r: 5, w0: 11, w1: 4 },
  { n: 'Pacific islands', lo: 178, la: -18, r: 3, w0: 9, w1: 9 },
];

// Physical-geography suppressors. `f` is the multiplier at the centre of the ellipse;
// it relaxes to 1 outward. Deserts, ice, high plateau, closed rainforest.
interface Zone { lo: number; la: number; rx: number; ry: number; f: number }
const ZONES: Zone[] = [
  // `f` is roughly (that zone's real people per km2) / (good farmland's), so the ratios
  // are steep on purpose: the deep Sahara is not "a bit emptier" than the Nile bank, it
  // is three orders of magnitude emptier, and a timid multiplier here is what makes a
  // density map lie by inking a whole desert mid-grey.
  // rx/ry are the HALF-WIDTH of the zone, not a Gaussian sigma — the falloff is
  // flat-topped (see zoneG), so the interior is uniformly dead and the shoulder is short.
  { lo: 10, la: 24, rx: 22, ry: 8, f: 0.006 },      // Sahara
  { lo: -8, la: 22, rx: 8, ry: 5, f: 0.008 },       // Mauritania / western Sahara
  { lo: 46, la: 21, rx: 8, ry: 6, f: 0.004 },       // Arabian / Rub al Khali
  { lo: 71, la: 27, rx: 4, ry: 3, f: 0.45 },        // Thar — arid but heavily farmed
  { lo: 57, la: 32, rx: 6, ry: 3, f: 0.02 },        // Dasht-e Lut / Kavir
  { lo: 61, la: 42, rx: 8, ry: 4, f: 0.04 },        // Karakum / Kyzylkum
  { lo: 85, la: 39.5, rx: 8, ry: 3.5, f: 0.006 },   // Taklamakan / Tarim
  { lo: 105, la: 43, rx: 11, ry: 4, f: 0.012 },     // Gobi
  { lo: 88, la: 33, rx: 9, ry: 3.5, f: 0.02 },      // Tibetan plateau
  { lo: 21, la: -23, rx: 7, ry: 6, f: 0.02 },       // Kalahari / Namib
  { lo: 133, la: -25, rx: 12, ry: 7, f: 0.004 },    // Australian interior
  { lo: -69, la: -22, rx: 3, ry: 7, f: 0.01 },      // Atacama
  { lo: -69, la: -46, rx: 6, ry: 5, f: 0.02 },      // Patagonia
  { lo: -115, la: 39, rx: 6, ry: 6, f: 0.04 },      // Great Basin / Sonora
  { lo: -42, la: 73, rx: 20, ry: 8, f: 0.001 },     // Greenland ice
  { lo: -95, la: 66, rx: 24, ry: 6, f: 0.004 },     // Canadian arctic
  { lo: 100, la: 70, rx: 48, ry: 7, f: 0.004 },     // Siberian arctic
  { lo: -63, la: -4, rx: 10, ry: 6, f: 0.012 },     // Amazon rainforest
  { lo: 20, la: -1, rx: 8, ry: 4.5, f: 0.05 },      // Congo rainforest
  { lo: 132, la: -4, rx: 9, ry: 4, f: 0.12 },       // Maluku / inner New Guinea
  { lo: -112, la: 44, rx: 4, ry: 6, f: 0.06 },      // Rockies
  { lo: -60, la: 3, rx: 6, ry: 3, f: 0.05 },        // Guiana shield
];

// Flat-topped ellipse. A plain Gaussian has shoulders so soft that at half a radius out
// it has already given back two thirds of its suppression — which inked the whole Sahara
// grey. Cubing the radial term gives a zone a real, uniformly dead interior and a short
// shoulder, which is how a desert actually behaves.
const zoneG = (q: number) => Math.exp(-(q * q * q));

// Nearest-seed Voronoi maps every land cell to one of the eight POPDATA regions.
// Seeds sit in empty country too (Siberia, the Sahara, the Canadian shield) so the
// boundaries land in the right place rather than being dragged by the dense kernels.
// Judgement calls baked in here: Siberia and Central Asia count as "europe" (the
// dataset's Europe total matches Europe-including-Russia), Turkey and Iran count as
// "mena", western New Guinea as "southeast-asia", Hawaii as "americas".
const SEEDS: [number, number, string][] = [
  [116, 40, 'east-asia'], [121, 31, 'east-asia'], [104, 31, 'east-asia'], [113, 23, 'east-asia'],
  [87, 44, 'east-asia'], [91, 30, 'east-asia'], [127, 46, 'east-asia'], [139, 36, 'east-asia'],
  [127, 37, 'east-asia'], [107, 48, 'east-asia'], [100, 25, 'east-asia'], [121, 24, 'east-asia'],
  [77, 29, 'south-asia'], [73, 19, 'south-asia'], [88, 23, 'south-asia'], [80, 13, 'south-asia'],
  [67, 25, 'south-asia'], [69, 34, 'south-asia'], [80, 7, 'south-asia'], [85, 28, 'south-asia'], [90, 24, 'south-asia'],
  [100, 14, 'southeast-asia'], [107, -6, 'southeast-asia'], [121, 15, 'southeast-asia'], [106, 21, 'southeast-asia'],
  [104, 1, 'southeast-asia'], [96, 17, 'southeast-asia'], [119, -5, 'southeast-asia'], [99, 3, 'southeast-asia'],
  [114, 0, 'southeast-asia'], [126, -9, 'southeast-asia'], [140, -3, 'southeast-asia'],
  [0, 51, 'europe'], [2, 47, 'europe'], [13, 52, 'europe'], [12, 42, 'europe'], [-4, 40, 'europe'],
  [37, 56, 'europe'], [31, 50, 'europe'], [21, 52, 'europe'], [18, 60, 'europe'], [24, 38, 'europe'],
  [-8, 40, 'europe'], [20, 45, 'europe'], [-19, 65, 'europe'], [33, 68, 'europe'], [45, 62, 'europe'],
  [62, 57, 'europe'], [83, 55, 'europe'], [104, 52, 'europe'], [130, 62, 'europe'], [151, 62, 'europe'],
  [132, 44, 'europe'], [71, 48, 'europe'], [66, 41, 'europe'], [50, 46, 'europe'], [90, 66, 'europe'],
  [31, 30, 'mena'], [44, 33, 'mena'], [51, 36, 'mena'], [47, 25, 'mena'], [33, 39, 'mena'],
  [-8, 33, 'mena'], [3, 36, 'mena'], [14, 31, 'mena'], [33, 17, 'mena'], [44, 15, 'mena'],
  [35, 32, 'mena'], [5, 23, 'mena'], [20, 24, 'mena'], [58, 23, 'mena'], [60, 34, 'mena'], [43, 41, 'mena'],
  [3, 6, 'subsaharan-africa'], [15, -4, 'subsaharan-africa'], [37, -1, 'subsaharan-africa'],
  [39, 9, 'subsaharan-africa'], [28, -26, 'subsaharan-africa'], [-16, 15, 'subsaharan-africa'],
  [13, -9, 'subsaharan-africa'], [47, -19, 'subsaharan-africa'], [31, -18, 'subsaharan-africa'],
  [-6, 13, 'subsaharan-africa'], [12, 12, 'subsaharan-africa'], [45, 2, 'subsaharan-africa'],
  [17, -22, 'subsaharan-africa'], [25, 8, 'subsaharan-africa'],
  [-74, 41, 'americas'], [-88, 42, 'americas'], [-118, 34, 'americas'], [-99, 19, 'americas'],
  [-74, 5, 'americas'], [-77, -12, 'americas'], [-47, -24, 'americas'], [-58, -35, 'americas'],
  [-82, 23, 'americas'], [-150, 62, 'americas'], [-97, 50, 'americas'], [-114, 63, 'americas'],
  [-60, -3, 'americas'], [-35, -8, 'americas'], [-71, -33, 'americas'], [-90, 15, 'americas'],
  [-45, 72, 'americas'], [-158, 21, 'americas'], [-105, 40, 'americas'], [-68, -48, 'americas'],
  [151, -34, 'oceania'], [116, -32, 'oceania'], [134, -24, 'oceania'], [175, -37, 'oceania'],
  [147, -9, 'oceania'], [131, -12, 'oceania'], [178, -18, 'oceania'], [145, -20, 'oceania'],
];

// ---------------------------------------------------------------- helpers
const D2R = Math.PI / 180;
// How much weight the thin, everywhere-people residual carries against the named
// centres. Turn it up and the world looks evenly settled; turn it down and only the
// river valleys exist. 1.0 is the calibration that puts ~half of humanity on a few
// percent of the land, which is what the real distribution does.
const BASE_W = 1;
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// how "industrial" a year is: 0 in the agrarian world, 1 by the late 20th century.
const modernity = (y: number) => smooth((y - 1650) / 320);
// how "farmed" a year is: 0 deep in the Palaeolithic, 1 by the late Bronze Age.
// Before farming there are no river-valley cities to concentrate into, so the field
// falls back to raw habitability and people read as thinly spread.
const agrarian = (y: number) => smooth((y + 12000) / 11000);

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
type RGB = [number, number, number];
function parseRGB(c: string, fb: RGB): RGB {
  if (!c) return fb;
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return fb;
  }
  const m = c.match(/-?[\d.]+/g);
  return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : fb;
}
const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// point-to-segment distance in degrees, longitude scaled by cos(lat) so a kernel is
// round on the ground rather than round on the plate.
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number, kx: number) {
  const dx = (bx - ax) * kx, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 1e-9) t = clamp((((px - ax) * kx) * dx + (py - ay) * dy) / l2, 0, 1);
  const ex = (px - (ax + (bx - ax) * t)) * kx, ey = py - (ay + (by - ay) * t);
  return Math.sqrt(ex * ex + ey * ey);
}

// ---------------------------------------------------------------- land mask
// One high-resolution raster of present-day land (4 px per degree), built once from the
// 1994 border geometry and box-downsampled to whatever grid the reader asks for. Coasts
// come out as partial coverage, which is what we want — a coastal cell is half land.
const MPD = 4, MASK_W = 360 * MPD, MASK_H = 145 * MPD;
let MASK: Uint8Array | null = null;
function buildMask(): Uint8Array | null {
  if (MASK) return MASK;
  const geo = GEO[1994]; if (!geo || !geo.length) return null;
  const c = document.createElement('canvas'); c.width = MASK_W; c.height = MASK_H;
  const x = c.getContext('2d', { willReadFrequently: true }); if (!x) return null;
  x.fillStyle = '#fff';
  const px = (lo: number) => (lo + 180) * MPD, py = (la: number) => (85 - la) * MPD;
  x.beginPath();
  for (const f of geo) for (const r of f.rings) {
    x.moveTo(px(r[0]), py(r[1]));
    for (let i = 2; i < r.length; i += 2) x.lineTo(px(r[i]), py(r[i + 1]));
    x.closePath();
  }
  x.fill();
  const d = x.getImageData(0, 0, MASK_W, MASK_H).data;
  const m = new Uint8Array(MASK_W * MASK_H);
  for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j];
  return MASK = m;
}

// ---------------------------------------------------------------- the field
// Everything is computed once on a FIXED 0.5-degree lattice and then box-summed into
// whatever cell size the reader picked. That matters more than it looks: sampling a
// kernel at the centre of a 2-degree cell throws away most of a narrow one — the Nile
// reach is 0.55 degrees wide — and because each region is normalised to a fixed total,
// every person the Nile loses gets handed to the Sahara. Integrating on a fine lattice
// keeps narrow valleys intact and makes Coarse/Medium/Fine show the SAME totals.
const FINE = 0.5;
interface Field {
  nx: number; ny: number;
  lf: Float32Array; reg: Int8Array;
  B: Float32Array; K0: Float32Array; K1: Float32Array;
  SB: Float64Array; SK0: Float64Array; SK1: Float64Array;
}
let FIELD: Field | null = null;

function buildField(): Field | null {
  if (FIELD) return FIELD;
  const mask = buildMask(); if (!mask || !POPS) return null;
  const nx = Math.round(360 / FINE), ny = Math.round(145 / FINE), n = nx * ny;
  const blk = Math.round(FINE * MPD);
  const lf = new Float32Array(n), reg = new Int8Array(n).fill(-1);
  const B = new Float32Array(n), K0 = new Float32Array(n), K1 = new Float32Array(n);
  const clim = new Float32Array(n);

  const rIndex: Record<string, number> = {};
  POPS.regions.forEach((r: any, i: number) => { rIndex[r.id] = i; });
  const seeds = SEEDS.map(s => [s[0], s[1], rIndex[s[2]] ?? -1] as [number, number, number]).filter(s => s[2] >= 0);

  // ---- land fraction + latitude climate, and region on a coarse 2-degree Voronoi
  // that the fine cells inherit (region borders do not need half-degree precision).
  const RS = 4;                                   // 4 fine cells = 2 degrees
  const rnx = Math.ceil(nx / RS), rny = Math.ceil(ny / RS);
  const rgC = new Int8Array(rnx * rny).fill(-1);
  for (let ry = 0; ry < rny; ry++) {
    const la = 85 - (ry + 0.5) * FINE * RS, kx = Math.max(Math.cos(la * D2R), 0.04);
    for (let rx = 0; rx < rnx; rx++) {
      const lo = -180 + (rx + 0.5) * FINE * RS;
      let best = 1e9, br = -1;
      for (const s of seeds) {
        let dl = lo - s[0]; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
        const d = (dl * kx) ** 2 + (la - s[1]) ** 2;
        if (d < best) { best = d; br = s[2]; }
      }
      rgC[ry * rnx + rx] = br;
    }
  }

  for (let iy = 0; iy < ny; iy++) {
    const la = 85 - (iy + 0.5) * FINE;
    const al = Math.abs(la);
    const cold = al > 45 ? Math.exp(-(((al - 45) / 13) ** 2)) : 1;
    const y0 = iy * blk;
    for (let ix = 0; ix < nx; ix++) {
      const i = iy * nx + ix;
      let acc = 0, cnt = 0;
      const x0 = ix * blk;
      for (let yy = y0; yy < y0 + blk && yy < MASK_H; yy++) {
        const row = yy * MASK_W;
        for (let xx = x0; xx < x0 + blk && xx < MASK_W; xx++) { acc += mask[row + xx]; cnt++; }
      }
      const f = cnt ? acc / (cnt * 255) : 0;
      if (f < 0.02) continue;
      lf[i] = f;
      clim[i] = cold;
      reg[i] = rgC[((iy / RS) | 0) * rnx + ((ix / RS) | 0)];
    }
  }

  // ---- climate suppressors, zone-outer over their own bounding boxes
  for (const z of ZONES) {
    const laLo = z.la - z.ry * 2, laHi = z.la + z.ry * 2;
    const iy0 = Math.max(0, Math.floor((85 - laHi) / FINE)), iy1 = Math.min(ny - 1, Math.ceil((85 - laLo) / FINE));
    const ix0 = Math.floor((z.lo - z.rx * 2 + 180) / FINE), ix1 = Math.ceil((z.lo + z.rx * 2 + 180) / FINE);
    for (let iy = iy0; iy <= iy1; iy++) {
      const la = 85 - (iy + 0.5) * FINE;
      for (let jx = ix0; jx <= ix1; jx++) {
        const ix = ((jx % nx) + nx) % nx, i = iy * nx + ix;
        if (!lf[i]) continue;
        const lo = -180 + (ix + 0.5) * FINE;
        let dl = lo - z.lo; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
        clim[i] *= 1 - (1 - z.f) * zoneG((dl / z.rx) ** 2 + ((la - z.la) / z.ry) ** 2);
      }
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    const kx = Math.max(Math.cos((85 - (iy + 0.5) * FINE) * D2R), 0.04);
    for (let ix = 0; ix < nx; ix++) { const i = iy * nx + ix; if (lf[i]) B[i] = lf[i] * kx * clim[i] * BASE_W; }
  }

  // ---- population centres, kernel-outer over their own bounding boxes
  for (const c of CENTRES) {
    const la2 = c.la2 ?? c.la, lo2 = c.lo2 ?? c.lo;
    const kx = Math.max(Math.cos(((c.la + la2) / 2) * D2R), 0.05);
    const reach = c.r * 3.2, loPad = reach / kx;
    const laLo = Math.min(c.la, la2) - reach, laHi = Math.max(c.la, la2) + reach;
    const loLo = Math.min(c.lo, lo2) - loPad, loHi = Math.max(c.lo, lo2) + loPad;
    const iy0 = Math.max(0, Math.floor((85 - laHi) / FINE)), iy1 = Math.min(ny - 1, Math.ceil((85 - laLo) / FINE));
    const ix0 = Math.floor((loLo + 180) / FINE), ix1 = Math.ceil((loHi + 180) / FINE);
    for (let iy = iy0; iy <= iy1; iy++) {
      const la = 85 - (iy + 0.5) * FINE;
      for (let jx = ix0; jx <= ix1; jx++) {
        const ix = ((jx % nx) + nx) % nx, i = iy * nx + ix;
        if (!lf[i]) continue;
        const lo = -180 + (ix + 0.5) * FINE;
        let dlo = lo - c.lo; if (dlo > 180) dlo -= 360; else if (dlo < -180) dlo += 360;
        const g = Math.exp(-((segDist(c.lo + dlo, la, c.lo, c.la, lo2, la2, kx) / c.r) ** 2));
        if (g < 0.004) continue;
        // A centre keeps its full weight at its core whatever the climate — that is the
        // whole point of the Nile — but its TAIL is damped by the local climate, so a
        // heavy kernel cannot smear a city's worth of people across the next desert.
        const kc = clim[i] + (1 - clim[i]) * g;
        K0[i] += c.w0 * g * lf[i] * kc;
        K1[i] += c.w1 * g * lf[i] * kc;
      }
    }
  }

  // ---- regional sums, taken on the fine lattice so every detail level agrees
  const SB = new Float64Array(8), SK0 = new Float64Array(8), SK1 = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const r = reg[i]; if (r < 0 || !lf[i]) continue;
    SB[r] += B[i]; SK0[r] += K0[i]; SK1[r] += K1[i];
  }
  return FIELD = { nx, ny, lf, reg, B, K0, K1, SB, SK0, SK1 };
}

// ---------------------------------------------------------------- display grids
interface Grid {
  step: number; nx: number; ny: number;
  reg: Int8Array;
  B: Float32Array; K0: Float32Array; K1: Float32Array;
  cells: Int32Array;       // grid indices worth drawing
  area: Float32Array;      // real land area weight per drawn cell
  dens: Float64Array;      // scratch: people in that cell, this frame
  SB: Float64Array; SK0: Float64Array; SK1: Float64Array;
}
const GRIDS: Record<number, Grid> = {};

function buildGrid(step: number): Grid | null {
  if (GRIDS[step]) return GRIDS[step];
  const F = buildField(); if (!F) return null;
  const k = Math.round(step / FINE);
  const nx = Math.round(360 / step), ny = Math.ceil(145 / step), n = nx * ny;
  const reg = new Int8Array(n).fill(-1);
  const B = new Float32Array(n), K0 = new Float32Array(n), K1 = new Float32Array(n);
  const lfSum = new Float32Array(n);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iy * nx + ix;
      let b = 0, k0 = 0, k1 = 0, lfs = 0, bestReg = -1, bestLf = -1;
      for (let fy = iy * k; fy < (iy + 1) * k && fy < F.ny; fy++) {
        for (let fx = ix * k; fx < (ix + 1) * k && fx < F.nx; fx++) {
          const j = fy * F.nx + fx;
          if (!F.lf[j]) continue;
          b += F.B[j]; k0 += F.K0[j]; k1 += F.K1[j]; lfs += F.lf[j];
          if (F.lf[j] > bestLf) { bestLf = F.lf[j]; bestReg = F.reg[j]; }
        }
      }
      if (bestReg < 0) continue;
      reg[i] = bestReg; B[i] = b; K0[i] = k0; K1[i] = k1; lfSum[i] = lfs;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (reg[i] >= 0) idx.push(i);
  const cells = Int32Array.from(idx);
  const area = new Float32Array(cells.length);
  for (let q = 0; q < cells.length; q++) {
    const i = cells[q];
    const la = 85 - (Math.floor(i / nx) + 0.5) * step;
    area[q] = lfSum[i] * Math.max(Math.cos(la * D2R), 0.04);
  }
  return GRIDS[step] = {
    step, nx, ny, reg, B, K0, K1, cells, area,
    dens: new Float64Array(cells.length), SB: F.SB, SK0: F.SK0, SK1: F.SK1,
  };
}

// ---------------------------------------------------------------- the view
const NB = 32;                       // colour buckets, so playback is not a fillStyle storm
// Per-frame scratch, hoisted: a 60fps scrub should not hand the GC 200 objects a second.
const POPV = new Float64Array(8), INV = new Float64Array(8);
const HIST = new Float64Array(64), HAREA = new Float64Array(64);
let CREG: Int8Array | null = null;                       // region of each centre, fixed
const CMASS = new Float64Array(CENTRES.length);
const CORDER = new Int32Array(CENTRES.length);
const bucketIdx: Int32Array[] = [];
const bucketLen = new Int32Array(NB);

export const Pop = {
  cv: null as unknown as HTMLCanvasElement,
  H: 440,
  ix: 13,
  step: 2,
  style: 'plate' as 'plate' | 'field',
  names: true,
  playing: null as any,
  _init: false,
  _path: null as Path2D | null, _pw: 0, _ph: 0,
  proj: { ox: 0, oy: 0, mw: 1, mh: 1 },
  _capAt: 0, _capNamed: true,
  _off: null as HTMLCanvasElement | null,
  _hover: null as { lo: number; la: number } | null,

  slices(): any[] { return POPS ? POPS.slices : []; },
  year(): number {
    const S = this.slices(); if (!S.length) return 2025;
    const i0 = clamp(Math.floor(this.ix), 0, S.length - 1), i1 = clamp(i0 + 1, 0, S.length - 1);
    return S[i0].year + (S[i1].year - S[i0].year) * (this.ix - i0);
  },

  // -------------------------------------------------- DOM (new ids, legacy fallback)
  // Everything is resolved lazily and re-checked until wired, because the shell may
  // mount #popSlider / #popPlay (they live in the shared time rail) after the canvas.
  el(a: string, b: string) { return $<HTMLElement>(a) || $<HTMLElement>(b); },
  _wired: { cv: false, slider: false, sliderEvt: false, play: false, panel: false },
  ensureDom() {
    const w = this._wired;
    if (w.cv && this.cv.isConnected && w.slider && w.play && w.panel) return true;
    if (!w.cv || !this.cv || !this.cv.isConnected) {
      const cv = this.el('#popCanvas', '#cartoCanvas') as HTMLCanvasElement | null;
      if (!cv) return false;
      if (cv !== this.cv) {
        this.cv = cv; this._path = null;
        cv.addEventListener('mousemove', (e: MouseEvent) => this.onMove(e));
        cv.addEventListener('mouseleave', () => { this._hover = null; hideTip(); });
      }
      w.cv = true;
    }
    if (!w.slider) {
      const sl = this.el('#popSlider', '#cartoSlider') as HTMLInputElement | null;
      if (sl) {
        if (!w.sliderEvt) {
          sl.setAttribute('aria-label', 'Year');
          sl.addEventListener('input', (e: any) => { this.stop(); this.ix = +e.target.value; this.render(); });
          w.sliderEvt = true;
        }
        // The range depends on POPDATA, which may not have landed yet. Do not latch the
        // slider as wired until the slice count is real, or an early render pins max=1
        // and the reader can never scrub past the second slice.
        const S = this.slices();
        if (S.length > 1) {
          sl.min = '0'; sl.max = String(S.length - 1); sl.step = '0.02';
          sl.value = String(this.ix);
          w.slider = true;
        }
      }
    }
    if (!w.play) {
      const pl = this.el('#popPlay', '#cartoPlay');
      if (pl) {
        pl.setAttribute('aria-pressed', 'false');
        pl.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
        w.play = true;
      }
    }
    if (!w.panel) w.panel = this.buildPanel(this.el('#popPlay', '#cartoPlay'));
    return true;
  },
  // The label text of #popPlay is ours, but only if it is a text button. If the shell
  // ever puts an <svg> in there, leave the icon alone and speak through aria-pressed.
  setPlayLabel(on: boolean) {
    const pl = this.el('#popPlay', '#cartoPlay'); if (!pl) return;
    pl.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!pl.firstElementChild) pl.textContent = on ? 'Pause' : 'Play';
  },
  buildPanel(playBtn: HTMLElement | null): boolean {
    const host = $('#popPanel') || (playBtn ? playBtn.parentElement : null);
    if (!host) return false;
    if (host.querySelector('[data-pop]')) return true;
    const row = (label: string, opts: [string, string, string][], get: () => string, set: (v: string) => void) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px';
      const l = document.createElement('span');
      l.className = 'note'; l.textContent = label; l.style.cssText = 'min-width:44px';
      d.appendChild(l);
      for (const [val, txt, title] of opts) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip' + (get() === val ? ' on' : '');
        b.textContent = txt; b.title = title; b.dataset.pop = label;
        b.addEventListener('click', () => {
          set(val);
          d.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
          b.classList.add('on');
          this.render();
        });
        d.appendChild(b);
      }
      host.appendChild(d);
    };
    row('Detail', [['4', 'Coarse', '4° cells'], ['2', 'Medium', '2° cells'], ['1', 'Fine', '1° cells']],
      () => String(this.step), v => { this.step = +v; });
    row('Style', [['plate', 'Plate', 'One square per cell — the resolution of the claim is visible'], ['field', 'Field', 'The same numbers, smoothed']],
      () => this.style, v => { this.style = v as any; });
    row('Names', [['1', 'On', ''], ['0', 'Off', '']],
      () => (this.names ? '1' : '0'), v => { this.names = v === '1'; });
    return true;
  },

  // Read-only probe: no repaint, so hovering a 15,000-cell field stays free.
  onMove(e: MouseEvent) {
    const r = this.cv.getBoundingClientRect();
    const { ox, oy, mw, mh } = this.proj;
    const kx = r.width / (this.cv.clientWidth || r.width);
    const mx = (e.clientX - r.left) / kx - ox, my = (e.clientY - r.top) / kx - oy;
    if (mx < 0 || my < 0 || mx > mw || my > mh) { this._hover = null; hideTip(); return; }
    this._hover = { lo: mx / mw * 360 - 180, la: 85 - my / mh * 145 };
    const g = GRIDS[this.step];
    if (!g) return;
    const ix = clamp(Math.floor((this._hover.lo + 180) / g.step), 0, g.nx - 1);
    const iy = clamp(Math.floor((85 - this._hover.la) / g.step), 0, g.ny - 1);
    const i = iy * g.nx + ix;
    const k = g.cells.indexOf(i);
    const rg = g.reg[i] >= 0 && POPS ? POPS.regions[g.reg[i]].name : null;
    if (k < 0 || !rg) { hideTip(); return; }
    const p = g.dens[k] * 1e6;
    showTip(e.clientX, e.clientY,
      `<div class="t">${fmtPeople(p)} people</div>` +
      `<div class="m">${g.step}° cell · ${fmtDeg(this._hover.la, 'NS')} ${fmtDeg(this._hover.lo, 'EW')}</div>` +
      `<div class="m">${rg} · modelled, not measured</div>`);
  },

  // -------------------------------------------------- paint
  render() {
    if (!this.ensureDom()) return;
    const d = fitCanvas(this.cv, this.H); if (!d) return;
    const { cw, ctx } = d; const H = this.H; const T = tokens();
    const dark = lum(parseRGB(T.bg, [245, 247, 246])) < 0.4;
    const land = parseRGB(css('--tl-land') || css('--land'), dark ? [30, 42, 44] : [237, 239, 233]);
    const lowC = parseRGB(T.s[3], dark ? [210, 166, 60] : [138, 107, 21]);   // society ochre
    const hiC = parseRGB(T.ink, dark ? [222, 230, 228] : [18, 24, 26]);

    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, cw, H);

    const S = this.slices();
    if (!POPS || !S.length) {
      ctx.fillStyle = T.ink3; ctx.font = fontUI(13);
      ctx.fillText('Population data not loaded.', 20, H / 2);
      return;
    }

    // The plate keeps the 360x145 equirectangular aspect and letterboxes inside whatever
    // height the shell gives us. Stretching it to fill would put Siberia and the Sahara
    // at the wrong shape, which is precisely what this view is supposed to be read for.
    const ASP = 360 / 145;
    let mw = cw, mh = cw / ASP;
    if (mh > H) { mh = H; mw = H * ASP; }
    const ox = Math.round((cw - mw) / 2), oy = Math.round((H - mh) / 2);
    this.proj = { ox, oy, mw, mh };
    ctx.fillStyle = T.sea; ctx.fillRect(ox, oy, mw, mh);

    // land silhouette (present-day coastline; coastlines are the one thing that barely moves)
    if (!this._path || this._pw !== mw || this._ph !== mh) {
      const p = new Path2D(); const geo = GEO[1994] || [];
      const px = (lo: number) => (lo + 180) / 360 * mw, py = (la: number) => (85 - la) / 145 * mh;
      for (const f of geo) for (const r of f.rings) {
        p.moveTo(px(r[0]), py(r[1]));
        for (let i = 2; i < r.length; i += 2) p.lineTo(px(r[i]), py(r[i + 1]));
        p.closePath();
      }
      this._path = p; this._pw = mw; this._ph = mh;
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.beginPath(); ctx.rect(0, 0, mw, mh); ctx.clip();
    ctx.strokeStyle = T.line; ctx.globalAlpha = .45; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lo = -180; lo <= 180; lo += 30) { const x = (lo + 180) / 360 * mw; ctx.moveTo(x, 0); ctx.lineTo(x, mh); }
    for (let la = -60; la <= 85; la += 30) { const y = (85 - la) / 145 * mh; ctx.moveTo(0, y); ctx.lineTo(mw, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${land[0]},${land[1]},${land[2]})`;
    ctx.fill(this._path!);
    ctx.strokeStyle = T.stroke; ctx.globalAlpha = .55; ctx.lineWidth = .7; ctx.stroke(this._path!);
    ctx.globalAlpha = 1;

    const g = buildGrid(this.step);
    const yr = this.year();
    if (!g) { ctx.restore(); return; }

    // ---- the field: regional totals (data) x within-region shape (model)
    const i0 = clamp(Math.floor(this.ix), 0, S.length - 1), i1 = clamp(i0 + 1, 0, S.length - 1);
    const fr = this.ix - i0;
    const m = modernity(yr), a = agrarian(yr);
    let total = 0;
    POPS.regions.forEach((rg: any, k: number) => {
      const p = (S[i0].pop[rg.id] || 0) + ((S[i1].pop[rg.id] || 0) - (S[i0].pop[rg.id] || 0)) * fr;
      POPV[k] = p; total += p;
    });
    for (let r = 0; r < 8; r++) {
      const sm = g.SB[r] + a * (g.SK0[r] * (1 - m) + g.SK1[r] * m);
      INV[r] = sm > 0 ? POPV[r] / sm : 0;
    }
    const { cells, dens, reg, B, K0, K1, nx, step } = g;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      dens[k] = (B[i] + a * (K0[i] * (1 - m) + K1[i] * m)) * INV[reg[i]];
    }

    // absolute log scale, rebased so a 4° cell is not four times "denser" than a 1° one
    const sc = (step / 2) ** 2;
    const LO = Math.log10(1000 * sc), SPAN = 4.5;
    const cellW = step / 360 * mw, cellH = step / 145 * mh;

    if (this.style === 'field') {
      if (!this._off) this._off = document.createElement('canvas');
      const off = this._off; off.width = nx; off.height = g.ny;
      const octx = off.getContext('2d')!;
      const img = octx.createImageData(nx, g.ny);
      const px = img.data;
      for (let k = 0; k < cells.length; k++) {
        const t = clamp((Math.log10(Math.max(dens[k] * 1e6, 1)) - LO) / SPAN, 0, 1);
        const c = mix(lowC, hiC, t), o = (0.14 + 0.86 * t) * 255;
        const j = cells[k] * 4;
        px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = o;
      }
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.clip(this._path!);
      ctx.imageSmoothingEnabled = true; (ctx as any).imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, nx * cellW, g.ny * cellH);
      ctx.restore();
    } else {
      // bucketed so we set fillStyle 32 times, not 15,000 times
      for (let b = 0; b < NB; b++) { if (!bucketIdx[b]) bucketIdx[b] = new Int32Array(0); bucketLen[b] = 0; }
      for (let b = 0; b < NB; b++) if (bucketIdx[b].length < cells.length) bucketIdx[b] = new Int32Array(cells.length);
      for (let k = 0; k < cells.length; k++) {
        const t = clamp((Math.log10(Math.max(dens[k] * 1e6, 1)) - LO) / SPAN, 0, 1);
        const b = Math.min(NB - 1, (t * NB) | 0);
        bucketIdx[b][bucketLen[b]++] = k;
      }
      // One path + one fill per bucket, not one fillRect per cell. At 1-degree detail
      // that is 32 draw calls instead of 17,000, and it is the difference between a
      // 2ms frame and a 20ms one whenever the canvas flushes its command buffer.
      for (let b = 0; b < NB; b++) {
        const len = bucketLen[b]; if (!len) continue;
        const t = (b + 0.5) / NB;
        const c = mix(lowC, hiC, t);
        ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(0.16 + 0.84 * t).toFixed(3)})`;
        const sz = (0.13 + 0.87 * t);
        const w = Math.max(cellW * sz, 0.6), h = Math.max(cellH * sz, 0.6);
        const cx = (cellW - w) / 2, cy = (cellH - h) / 2;
        const arr = bucketIdx[b];
        ctx.beginPath();
        for (let q = 0; q < len; q++) {
          const i = cells[arr[q]];
          ctx.rect(((i % nx) * cellW) + cx, (((i / nx) | 0) * cellH) + cy, w, h);
        }
        ctx.fill();
      }
    }

    // ---- concentration statistic (a real property of the field on screen)
    HIST.fill(0); HAREA.fill(0);
    let areaTot = 0;
    for (let k = 0; k < cells.length; k++) {
      const t = clamp((Math.log10(Math.max(dens[k] * 1e6, 1)) - LO) / SPAN, 0, 1);
      const b = Math.min(63, (t * 64) | 0);
      HIST[b] += dens[k]; HAREA[b] += g.area[k]; areaTot += g.area[k];
    }
    let acc = 0, accA = 0, half = 0;
    for (let b = 63; b >= 0; b--) {
      if (acc + HIST[b] >= total / 2) { const need = (total / 2 - acc) / (HIST[b] || 1); accA += HAREA[b] * need; half = accA / areaTot * 100; break; }
      acc += HIST[b]; accA += HAREA[b];
    }

    // ---- named clusters, ranked by how many people the model puts under them.
    // Mass ~ peak weight x kernel footprint; river reaches are long, so their length
    // counts as well as their width or the Ganges never outranks a compact city blob.
    if (!CREG) {
      CREG = new Int8Array(CENTRES.length);
      for (let q = 0; q < CENTRES.length; q++) CREG[q] = regionAt(CENTRES[q].lo, CENTRES[q].la);
    }
    for (let q = 0; q < CENTRES.length; q++) {
      const c = CENTRES[q], rr = CREG[q];
      const w = a * (c.w0 * (1 - m) + c.w1 * m);
      const kx = Math.max(Math.cos(((c.la + (c.la2 ?? c.la)) / 2) * D2R), 0.05);
      const len = Math.hypot(((c.lo2 ?? c.lo) - c.lo) * kx, (c.la2 ?? c.la) - c.la);
      CMASS[q] = rr < 0 ? 0 : w * c.r * (c.r * 1.77 + len) * INV[rr];
      CORDER[q] = q;
    }
    CORDER.sort((p, q) => CMASS[q] - CMASS[p]);

    // Before farming the centre table is switched almost all the way off (see `agrarian`),
    // so the field is habitability alone and there are no dense places to point at. Naming
    // "the Gangetic plain" over a Mesolithic map would be the model claiming something it
    // is not saying, so the labels and the "heaviest ground" line both stand down.
    const named = a >= 0.35;
    if (this.names && named) {
      // A small cartouche, not bare text — these labels sit on top of the darkest
      // squares on the plate, where plain ink would be invisible.
      ctx.font = fontUI(10, 600);                  // a place name is language, even in caps
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const placed: number[][] = [];
      let shown = 0;
      for (let q = 0; q < CORDER.length; q++) {
        const c = CENTRES[CORDER[q]];
        if (shown >= 7 || CMASS[CORDER[q]] <= 0) break;
        const midLo = (c.lo + (c.lo2 ?? c.lo)) / 2, midLa = (c.la + (c.la2 ?? c.la)) / 2;
        const ax = (midLo + 180) / 360 * mw, ay = (85 - midLa) / 145 * mh;
        const label = c.n.toUpperCase();
        const tw = ctx.measureText(label).width;
        const x = clamp(ax - tw / 2 - 4, 2, mw - tw - 10);
        let y = ay - 16;
        if (y < 4) y = ay + 8;
        const box = [x, y, tw + 8, 13];
        if (placed.some(p => box[0] < p[0] + p[2] + 4 && p[0] < box[0] + box[2] + 4 && box[1] < p[1] + p[3] + 3 && p[1] < box[1] + box[3] + 3)) continue;
        placed.push(box); shown++;
        ctx.fillStyle = T.panel; ctx.globalAlpha = .9;
        ctx.fillRect(box[0], box[1], box[2], box[3]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.line; ctx.lineWidth = 1;
        ctx.strokeRect(box[0] + .5, box[1] + .5, box[2] - 1, box[3] - 1);
        ctx.fillStyle = T.ink;
        ctx.fillText(label, box[0] + 4, box[1] + 10);
        // leader from the cartouche to the actual ground it names
        ctx.strokeStyle = T.ink3; ctx.globalAlpha = .7;
        ctx.beginPath(); ctx.moveTo(ax, y > ay ? y : y + 13); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.fillStyle = T.ink3; ctx.fillRect(ax - 1, ay - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();   // out of the map's translate + clip, back into canvas space
    this.legend(ctx, ox + mw, oy + mh, T, lowC, hiC, sc);

    // ---- rail / readout / caption
    const yEl = this.el('#popYear', '#cartoYear'); if (yEl) yEl.textContent = fmtY(yr);
    const sl = this.el('#popSlider', '#cartoSlider') as HTMLInputElement | null;
    if (sl && Math.abs(+sl.value - this.ix) > 1e-6) sl.value = String(this.ix);
    if (sl) sl.setAttribute('aria-valuetext', fmtY(yr));

    // The caption is a paragraph of prose in a floating panel. Rewriting its innerHTML
    // every animation frame costs a full parse plus a layout pass for text nobody can
    // read at that speed, and it measured as ~85% of the frame. So it is split in three:
    // the standing warning is built once, the headline number is a textContent write
    // every frame (cheap, and it must never disagree with the year on the rail), and the
    // two derived statistics are throttled because they are prose, not a readout.
    const cap = this.el('#popCap', '#cartoCap');
    if (cap) {
      let live = cap.querySelector('.popcap-live') as HTMLElement | null;
      if (!live) {
        cap.innerHTML =
          `<b class="popcap-live"></b> <span class="popcap-read"></span> ` +
          `<b>Illustrative distribution, not measured data.</b> The eight regional totals are scholarly estimates ` +
          `(McEvedy &amp; Jones · Biraben · UN; the error bars before 1500 are wide, and the Americas figure for 1500 is itself an argument), ` +
          `and each region's field sums back to exactly that published number. Where the people sit <i>inside</i> a region is a model: ` +
          `a hand-written table of ${CENTRES.length} population centres plus desert, ice, altitude and latitude rules. ` +
          `Read it for shape and concentration. Never read a local figure off it.`;
        live = cap.querySelector('.popcap-live') as HTMLElement;
      }
      const shown = total >= 1000 ? (total / 1000).toFixed(2) + ' billion'
        : (total >= 10 ? Math.round(total) : total.toFixed(1)) + ' million';
      live.textContent = `World population ≈ ${shown} in ${capYear(yr)}.`;

      // The throttle must not be allowed to straddle the pre-agrarian boundary, or the
      // canvas shows named centres for a moment while the caption still says there are none.
      const now = performance.now();
      if (!this.playing || named !== this._capNamed || now - this._capAt > 200) {
        this._capAt = now; this._capNamed = named;
        const read = cap.querySelector('.popcap-read') as HTMLElement | null;
        if (read) {
          const top: string[] = [];
          if (named) for (let q = 0; q < CORDER.length && top.length < 3; q++) {
            if (CMASS[CORDER[q]] > 0) top.push(CENTRES[CORDER[q]].n);
          }
          read.textContent =
            (named
              ? (top.length ? `Heaviest ground: ${top.join(', ')}. ` : '')
              : 'Before farming there are no dense centres to name: the model spreads people by habitability alone, along coasts, rivers and savanna. ') +
            (half > 0 ? `Half of everyone alive is on ${half < 1 ? half.toFixed(1) : Math.round(half)}% of the inhabited land. ` : '');
        }
      }
    }
  },

  // anchored to the bottom-right corner of the map plate, which is not the canvas corner
  legend(ctx: CanvasRenderingContext2D, cw: number, H: number, T: Tokens, lowC: RGB, hiC: RGB, sc: number) {
    const n = 7, sw = 15, sh = 9, w = n * sw + 22, h = 44;
    const x = cw - w - 12, y = H - h - 12;
    ctx.fillStyle = T.panel; ctx.globalAlpha = .93; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    ctx.fillStyle = T.ink3; ctx.font = fontMono(9, 600);           // a scale header is a measurement
    ctx.fillText(`PEOPLE PER ${this.step}° CELL`, x + 11, y + 14);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), c = mix(lowC, hiC, t);
      ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(0.3 + 0.7 * t).toFixed(3)})`;
      ctx.fillRect(x + 11 + i * sw, y + 20, sw - 2, sh);
    }
    ctx.fillStyle = T.ink3; ctx.font = fontMono(9);
    ctx.fillText(fmtPeople(1000 * sc), x + 11, y + 39);
    ctx.textAlign = 'right';
    ctx.fillText(fmtPeople(1000 * sc * 10 ** 4.5), x + 11 + n * sw - 2, y + 39);
    ctx.textAlign = 'left';
  },

  // -------------------------------------------------- lifecycle
  init() {
    if (this._init) return;
    this._init = true;
    this.ensureDom();
    this.render();
    repaintOnFonts(() => this.render());
  },
  play() {
    const S = this.slices(); if (!S.length) return;
    this.setPlayLabel(true);
    if (this.ix >= S.length - 1) this.ix = 0;
    // Time-based, not frame-based: the old cartogram advanced a fixed amount per frame,
    // so the same run took half as long on a 120Hz screen. RATE is slices per second.
    const RATE = (S.length - 1) / 8;
    const stepped = reduceMotion();
    let last = performance.now(), acc = 0;
    const tick = () => {
      const now = performance.now(), dt = Math.min(now - last, 100); last = now;
      if (stepped) {
        // Reduced motion means no continuous movement, so hold each slice and then cut
        // to the next. (The version this replaced advanced a whole slice per FRAME,
        // which made "reduce motion" the fastest and most violent setting in the app.)
        acc += dt;
        if (acc < 900) { this.playing = requestAnimationFrame(tick); return; }
        acc = 0; this.ix = Math.floor(this.ix) + 1;
      } else {
        this.ix += dt / 1000 * RATE;
      }
      if (this.ix >= S.length - 1) { this.ix = S.length - 1; this.render(); this.stop(); return; }
      this.render();
      this.playing = requestAnimationFrame(tick);
    };
    this.playing = requestAnimationFrame(tick);
  },
  stop() {
    this.setPlayLabel(false);
    if (this.playing) cancelAnimationFrame(this.playing);
    this.playing = null;
  },
};

// nearest-seed region for an arbitrary point, used to rank the named clusters
let SEEDCACHE: [number, number, number][] | null = null;
function regionAt(lo: number, la: number) {
  if (!POPS) return -1;
  if (!SEEDCACHE) {
    const rIndex: Record<string, number> = {};
    POPS.regions.forEach((r: any, i: number) => { rIndex[r.id] = i; });
    SEEDCACHE = SEEDS.map(s => [s[0], s[1], rIndex[s[2]] ?? -1] as [number, number, number]).filter(s => s[2] >= 0);
  }
  const kx = Math.max(Math.cos(la * D2R), 0.04);
  let best = 1e9, br = -1;
  for (const s of SEEDCACHE) {
    let dl = lo - s[0]; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    const d = (dl * kx) ** 2 + (la - s[1]) ** 2;
    if (d < best) { best = d; br = s[2]; }
  }
  return br;
}

const capYear = (y: number) => { const r = Math.round(y); return r > 0 && r < 1000 ? r + ' CE' : fmtY(r); };

function fmtPeople(p: number) {
  if (p >= 1e6) return (p / 1e6 >= 10 ? Math.round(p / 1e6) : (p / 1e6).toFixed(1)) + 'M';
  if (p >= 1e3) return Math.round(p / 1e3) + 'k';
  return String(Math.max(Math.round(p), 0));
}
function fmtDeg(v: number, ax: string) {
  const h = v >= 0 ? ax[0] : ax[1];
  return Math.abs(v).toFixed(1) + '°' + h;
}

// Contract: SHELL calls this at boot and it must never reject, exactly like loadRelations().
//
// There is no separate population dataset today. The regional totals ride along in
// datasets.json (POPDATA, loaded by initData) and the centre table above is compiled in,
// so there is nothing to fetch and this resolves immediately. Fetching /data/population.json
// "just in case" was tried and removed: the file does not exist, so every boot logged a
// 404 in the console, and a renderer that cries wolf on every page load is worse than one
// that is honest about shipping its model in the bundle.
//
// When a build script starts generating web/public/data/population.json — a finer-grained
// centre table, or per-slice centre weights instead of the two-point w0/w1 interpolation —
// flip EXTERNAL_DATASET to true and this picks it up with no change anywhere else.
const EXTERNAL_DATASET = false;

export async function loadPopulation(): Promise<void> {
  if (!EXTERNAL_DATASET) return;
  try {
    const r = await fetch('/data/population.json', { cache: 'force-cache' });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j?.centres) && j.centres.length) { CENTRES.length = 0; CENTRES.push(...j.centres); }
    if (Array.isArray(j?.zones) && j.zones.length) { ZONES.length = 0; ZONES.push(...j.zones); }
    CREG = null; FIELD = null;
    for (const k of Object.keys(GRIDS)) delete GRIDS[+k];
  } catch { /* the compiled-in table stays the source */ }
}

