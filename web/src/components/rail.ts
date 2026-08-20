/* =============================================================================
   rail.ts — ONE scale mapping for the whole application.

   The time rail is shared chrome, but "time" means three different things
   across the eleven views: a moment you drag (map, people, horizon), a window
   you zoom (timeline, flow, connections), and an axis you read (cube). All
   three read their position off THIS function. Two independent mappings is how
   the rail and the canvas drift apart.

   The stops are preview.html's piecewise ladder: deep time is compressed so
   recent centuries get room, because that is where the events are.
   ============================================================================= */

export const STOPS: [number, number][] = [
  [0, -3000], [16, -1000], [30, 1], [46, 1000], [60, 1500], [76, 1800], [86, 1900], [100, 2060],
];

const FIRST = STOPS[0];
const LAST = STOPS[STOPS.length - 1];

/** year -> percentage along the scale (0..100), clamped to the scale's extent. */
export function railPos(year: number): number {
  if (year <= FIRST[1]) return FIRST[0];
  if (year >= LAST[1]) return LAST[0];
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i];
    if (year <= b[1]) {
      const a = STOPS[i - 1];
      return a[0] + (year - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
    }
  }
  return LAST[0];
}

/** percentage along the scale (0..100) -> year. The inverse of railPos. */
export function railYear(pct: number): number {
  if (pct <= FIRST[0]) return FIRST[1];
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i];
    if (pct <= b[0]) {
      const a = STOPS[i - 1];
      return Math.round(a[1] + (pct - a[0]) / (b[0] - a[0]) * (b[1] - a[1]));
    }
  }
  return LAST[1];
}

/** The 18 world snapshots, engraved on the scale as stops in the map and cube views. */
export const SNAPSHOTS = [
  -3000, -1000, -323, 1, 400, 800, 1000, 1279, 1492, 1600, 1715, 1783, 1815, 1880, 1914, 1938, 1960, 1994,
];

/** "1776" / "3000" — the numeral alone, NO thousands separator (a year is not a
 *  quantity); the era caption carries BCE/CE. */
export const railNum = (y: number) => String(Math.abs(Math.round(y)));
export const railEraOf = (y: number) => (y < 0 ? 'BCE' : 'CE');
