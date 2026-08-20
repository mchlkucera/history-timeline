/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑤ CORE SAMPLE =================
// Ported verbatim from prototypes/partB.html.
import { $, YEARS, featureAt, fmtY, sovColor } from './shared';

export const Core = {
  PRESETS: [['Prague', 14.42, 50.09], ['Philadelphia', -75.16, 39.95], ['Rome', 12.5, 41.9], ['Istanbul', 28.97, 41.01],
  ['Jerusalem', 35.22, 31.78], ['Cairo', 31.24, 30.05], ['Beijing', 116.4, 39.9], ['Mexico City', -99.13, 19.43]] as [string, number, number][],
  init() {
    const row = $('#corePresets')!;
    for (const [n, lon, lat] of this.PRESETS) {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = n;
      b.addEventListener('click', () => this.drill(lon, lat, n)); row.appendChild(b);
    }
    this.drill(14.42, 50.09, 'Prague');
  },
  drill(lon: number, lat: number, label: string) {
    $('#coreWhere')!.innerHTML = `<b>Drilling at ${label}</b> (${lat.toFixed(2)}°, ${lon.toFixed(2)}°) — newest layer on top, dig down into the past.`;
    const box = $('#strata')!; box.innerHTML = '';
    const rows: { y: number; f: any }[] = [];
    for (const y of YEARS) rows.push({ y, f: featureAt(y, lon, lat) });
    rows.reverse();
    for (let i = 0; i < rows.length; i++) {
      const { y, f } = rows[i];
      const until = i === 0 ? 'now' : fmtY(rows[i - 1].y);
      const div = document.createElement('div'); div.className = 'stratum';
      const name = f ? (f.name === '?' ? '(unnamed in source atlas)' : f.name) : '— beyond the mapped world —';
      const sov = f && f.sov !== f.name ? `<span class="of">part of ${f.sov}</span>` : '';
      const col = f ? sovColor(f.sov) : 'transparent';
      div.innerHTML = `<div class="era mono">${fmtY(y)} → ${until}</div><div class="sw" style="background:${col}"></div><div class="who"><b>${name}</b> ${sov}</div>`;
      box.appendChild(div);
    }
  },
};
