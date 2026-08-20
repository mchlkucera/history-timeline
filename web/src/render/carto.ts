// ================= ⑥c BREATHING CARTOGRAM — RETIRED =================
// One circle per macro-region could not answer "where are the people", so this view was
// replaced by the density field in ./population.ts (MAP · PEOPLE).
//
// This module is now a compatibility shim and nothing else. It exists so that a
// `import { Carto } from '@/render/carto'` left anywhere in the app keeps resolving to a
// live renderer while Lab.tsx is being rewritten. `Carto` and `Pop` are the SAME object,
// and Pop.init() is idempotent, so calling both costs nothing.
// Safe to delete once nothing imports './carto'.
export { Pop, Pop as Carto, loadPopulation } from './population';
