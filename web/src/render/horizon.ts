/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ⑥b INFORMATION HORIZON =================
// Ported from prototypes/partB.html. Only change: `cv` is resolved in init().
import {
  $, EVENTS, GEO, YEARS, catColor, fitCanvas, fmtY, fontMono, fontUI, repaintOnFonts,
  TimeStore, tokens,
} from './shared';

export const Horizon = {
  cv: null as unknown as HTMLCanvasElement, H: 420, city: null as any, year: 1776,
  CITIES: [['Prague', 50.09, 14.42], ['Philadelphia', 39.95, -75.16], ['London', 51.51, -0.13], ['Vienna', 48.21, 16.37],
  ['Rome', 41.90, 12.50], ['Beijing', 39.90, 116.40], ['Delhi', 28.61, 77.21], ['Cairo', 30.05, 31.24], ['Lima', -12.05, -77.04]] as [string, number, number][],
  // Calibrated against known cases: news of the Declaration (4 Jul 1776) was printed in
  // London on 17 Aug — ~5,900 km in 44 days, so ~130 km/day for an important dispatch in 1776.
  speed(y: number) { // km/day that news actually travelled, as one global average over all routes
    if (y < -500) return 25; if (y < 500) return 40; if (y < 1500) return 30; if (y < 1750) return 60;
    if (y < 1830) return 110; if (y < 1860) return 300; if (y < 1900) return 4000; return 1e6;
  },
  speedLabel(y: number) {
    if (y < 1830) return 'horse, ship and foot'; if (y < 1860) return 'railway and optical semaphore';
    if (y < 1900) return 'electric telegraph'; return 'near-instant';
  },
  dist(a: number, b: number, c: number, d: number) { // great circle km
    const R = 6371, r = Math.PI / 180;
    const dLat = (c - a) * r, dLon = (d - b) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  },
  nearestYear(y: number) { let best = YEARS[0]; for (const Y of YEARS) if (Math.abs(Y - y) < Math.abs(best - y)) best = Y; return best; },

  /* ── THE STANDPOINT IS THE GLOBAL MOMENT ──────────────────────────────────
     "?v=horizon&y=1620 renders 1776."

     A city AND a year are the standpoint this view answers from, so its year is
     not a private setting like the map's zoom — it is the app's one "where you
     are in time", drawn from a different place. It used to be neither read nor
     published: booting from a URL, or arriving from the map at 1621, left the
     rings around whatever the input had last been set to, and scrubbing here
     moved nothing anywhere else.

     Two methods, and between them the store and this view can never disagree:

     syncToYear() ADOPTS without writing back — the same contract, and the same
     name, as WorldMap.syncToYear. Called on every arrival (renderTab), so
     boot-from-URL and a tab switch are the one code path.

     setYear() PUBLISHES — every user gesture that changes the year lands here,
     which is the whole of the anti-loop discipline shared.ts asks for: stores
     are written from input handlers only. The subscriber side is syncToYear's
     early return, so a year we set ourselves cannot come back as a change. */

  /** The extent this view can actually stand in — the number field's own guard. */
  clampYear(y: number) { return Math.max(-2999, Math.min(2026, Math.round(y))); },

  /** Put the year on the field, unless the reader is mid-keystroke in it — an
   *  assignment while it has focus eats the caret. */
  showYear() {
    const inp = $<HTMLInputElement>('#hzYear');
    if (inp && document.activeElement !== inp) inp.value = String(this.year);
  },

  /** Adopt the global moment, NEAREST this view can serve it. Writes nothing. */
  syncToYear(y: number) {
    const v = this.clampYear(y);
    if (v === this.year) return;
    this.year = v;
    this.showYear();
  },

  /** The reader moved the standpoint. The moment moves with it, app-wide. */
  setYear(y: number) {
    this.year = this.clampYear(y);
    this.showYear();
    TimeStore.set(this.year, 'ui');
    this.render();
  },

  render() {
    if (!this.cv) return;
    const d = fitCanvas(this.cv, this.H); if (!d) return;
    const { cw, ctx } = d; const T = tokens(); const H = this.H;
    const c = this.city || this.CITIES[0];
    ctx.fillStyle = T.sea; ctx.fillRect(0, 0, cw, H);
    const MW = cw, MH = H;
    const px = (lon: number) => (lon + 180) / 360 * MW, py = (lat: number) => (85 - lat) / 145 * MH;
    const snap = this.nearestYear(this.year);
    ctx.globalAlpha = .30; ctx.fillStyle = T.ink2;
    for (const f of GEO[snap]) {
      if (f.area < 3) continue;
      ctx.beginPath();
      for (const r of f.rings) {
        for (let i = 0; i < r.length; i += 2) { const X = px(r[i]), Y = py(r[i + 1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sp = this.speed(this.year);
    const rings: [number, string][] = [[7, '1 week'], [30, '1 month'], [182, '6 months']];
    const cxp = px(c[2]), cyp = py(c[1]);
    // The rings measure REACH — how far word had physically got — so they take the reach
    // hue from the data palette (CATS 'reach', si 1). They were minium, which by doctrine
    // means only "where you are"; a ring is a distance, not a location.
    const reach = T.s[1];
    ctx.textAlign = 'center';
    for (const [days, lab] of rings) {
      const km = sp * days; const degLat = km / 111;
      if (degLat > 210) continue;
      const degLon = Math.min(degLat / Math.max(Math.cos(c[1] * Math.PI / 180), 0.25), 180);
      ctx.strokeStyle = reach; ctx.globalAlpha = .5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(cxp, cyp, degLon / 360 * MW, degLat / 145 * MH, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = .85; ctx.fillStyle = reach; ctx.font = fontMono(10.5);   // "1 week" is a measurement
      ctx.fillText(lab, cxp, cyp - degLat / 145 * MH - 4);
      ctx.globalAlpha = 1;
    }
    // the city itself — the neutral ramp, stated outright rather than borrowed from an
    // accent alias, so a future re-skin of --accent2 cannot leak minium back onto the map
    ctx.fillStyle = T.ink; ctx.beginPath(); ctx.arc(cxp, cyp, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = .6;
    ctx.beginPath(); ctx.arc(cxp, cyp, 9, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = T.ink; ctx.font = fontUI(12, 600);                 // a city name is language
    ctx.fillText(c[0], cxp, cyp + 22);
    ctx.textAlign = 'left';
    // news in flight
    const feed: any[] = [];
    for (const ev of EVENTS) {
      const pl = ev[8]; if (!pl) continue;
      const y = ev[0]; if (y > this.year || y < this.year - 12) continue;
      const km = this.dist(c[1], c[2], pl[0], pl[1]);
      const days = km / sp;
      const arrive = y + days / 365;
      feed.push({ ev, km, days, arrive, known: arrive <= this.year, place: pl[2] });
      const p = [px(pl[1]), py(pl[0])];
      ctx.strokeStyle = arrive <= this.year ? T.ink3 : T.ink;
      ctx.globalAlpha = arrive <= this.year ? .28 : .7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = catColor(ev[6], T);
      ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill();
    }
    feed.sort((a, b) => b.arrive - a.arrive);
    $('#hzFeed')!.innerHTML = feed.length ? feed.map(f => {
      const lag = f.days < 1.5 ? 'same day' : (f.days < 45 ? `${Math.round(f.days)} days` : `${(f.days / 30.4).toFixed(1)} months`);
      return `<div class="newsitem ${f.known ? 'known' : ''}">
        <div class="h">${f.ev[2]}</div>
        <div class="d">${fmtY(f.ev[0])} · ${f.place} · ${Math.round(f.km).toLocaleString()} km</div>
        <div class="lag">${f.known ? `news took ${lag} — already known here` : `STILL IN TRANSIT · ${lag} away`}</div></div>`;
    }).join('') : '<div class="note">No located events in the twelve years before this date.</div>';
    $('#hzSpeed')!.textContent = `news moves ~${sp >= 1e6 ? 'instantly' : Math.round(sp) + ' km/day'} · ${this.speedLabel(this.year)}`;
    $('#hzCap')!.innerHTML = `<b>Standing in ${c[0]} in ${fmtY(this.year)}.</b> Rings show how far word had spread after a week, a month, six months. ` +
      // wording has to hold in both themes: in-transit spokes are full-strength ink, which
      // is dark on the light plate and light on the dark one. "Bold" is true of both.
      `Each spoke is one event reporting back to you. A bold spoke is still on the road — it had already happened, ` +
      `but word had not arrived; those are the ones marked <b>STILL IN TRANSIT</b> in the panel. The faded spokes had been heard here already.`;
  },
  init() {
    this.cv = $<HTMLCanvasElement>('#hzCanvas')!;
    const sel = $<HTMLSelectElement>('#hzCity')!;
    this.CITIES.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c[0]; sel.appendChild(o); });
    this.city = this.CITIES[0];
    sel.addEventListener('change', () => { this.city = this.CITIES[+sel.value]; this.render(); });
    // Both year controls go through setYear, so every route into this view's
    // standpoint — typing, the three chips, and the time rail's drag, which
    // dispatches `input` on this very field — publishes the same moment.
    $('#hzYear')!.addEventListener('input', (e: any) => {
      const v = +e.target.value;
      if (v > -3000 && v < 2027) this.setYear(v);
    });
    document.querySelectorAll<HTMLElement>('[data-hz]').forEach(
      b => b.addEventListener('click', () => this.setYear(+b.dataset.hz!)));
    repaintOnFonts(() => this.render());
  },
};
