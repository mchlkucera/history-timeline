/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= FLOW ENGINE (empires + braided rivers) + ③ FLOW OF EMPIRES =================
// Ported from prototypes/partB.html. Ribbons() is shared with ⑥a braid.ts, exactly as in
// the original. Only change: `cv` is resolved in init().
import {
  $, POLITIES, clamp, fitCanvas, fmtY, fontMono, fontUI, hideTip, reduceMotion, repaintOnFonts, showTip,
  tokens, yearPill, type Tokens,
} from './shared';

// Lineage-ordered stacked ribbons: children sit next to their parent, so a split
// renders as a fork. Thickness = weight. This is the Histomap mechanic.
export function flowLayout(items: any[], W: number, H: number, d0: number, d1: number, mode: string) {
  const set = new Map(items.map(i => [i.id, i]));
  const kids = new Map<string, string[]>(), pars = new Map<string, string[]>();
  for (const it of items) { kids.set(it.id, []); pars.set(it.id, []); }
  for (const it of items) {
    for (const t of (it.to || [])) if (set.has(t) && t !== it.id) kids.get(it.id)!.push(t);
    for (const f of (it.from || [])) if (set.has(f) && f !== it.id) pars.get(it.id)!.push(f);
  }
  const REG = ['EU', 'ME', 'AS', 'AM', 'AF'];
  const roots = items.filter(i => pars.get(i.id)!.length === 0)
    .sort((a, b) => {
      const ra = REG.indexOf(a.region), rb = REG.indexOf(b.region);
      return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || a.start - b.start;
    });
  const order = new Map<string, number>(); let n = 0;
  const visit = (id: string) => {
    if (order.has(id)) return; order.set(id, n++);
    for (const k of kids.get(id)!.slice().sort((a, b) => set.get(a).start - set.get(b).start)) visit(k);
  };
  roots.forEach(r => visit(r.id));
  items.slice().sort((a, b) => a.start - b.start).forEach(i => visit(i.id));
  const ord = [...items].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const wAt = (p: any, y: number) => {
    if (y < p.start || y > p.end) return 0;
    const Wt = p.weight;
    if (!Wt || !Wt.length) return 1;
    if (y <= Wt[0][0]) return Wt[0][1];
    if (y >= Wt[Wt.length - 1][0]) return Wt[Wt.length - 1][1];
    for (let i = 1; i < Wt.length; i++) {
      if (y <= Wt[i][0]) {
        const [ya, wa] = Wt[i - 1], [yb, wb] = Wt[i]; const t = (y - ya) / ((yb - ya) || 1); return wa + (wb - wa) * t;
      }
    }
    return 0;
  };
  const STEP = Math.max(2, (d1 - d0) / Math.max(W, 1) * 2);
  const cols: any[] = []; let maxTotal = 0;
  for (let y = d0; y <= d1; y += STEP) {
    const act: any[] = []; let tot = 0;
    for (const p of ord) { const w = wAt(p, y); if (w > 0.001) { act.push([p, w]); tot += w; } }
    if (tot > maxTotal) maxTotal = tot;
    cols.push({ y, act, tot });
  }
  const paths = new Map<string, any>();
  for (const c of cols) {
    const scale = mode === 'norm' ? (c.tot > 0 ? H / c.tot : 0) : (maxTotal > 0 ? H * 0.94 / maxTotal : 0);
    let acc = mode === 'norm' ? 0 : (H - c.tot * scale) / 2;
    for (const [p, w] of c.act) {
      const h = w * scale;
      let a = paths.get(p.id); if (!a) { a = { p, top: [], bot: [] }; paths.set(p.id, a); }
      a.top.push([c.y, acc]); a.bot.push([c.y, acc + h]);
      acc += h;
    }
  }
  return { paths, cols, order, kids, pars, set, maxTotal };
}

// great traditions / ideological trunks → a stable hue each, matched against stream ids
export const TRUNKS: [RegExp, number][] = [
  [/christian|catholic|orthodox|protestant|luther|calvin|anglic|methodis|baptist|pentecost|mormon|anabapt|chalcedon/, 268],
  [/islam|sunni|shia|sufi|wahhab/, 145],
  [/buddh|theravada|mahayana|vajrayana|zen/, 38],
  [/hindu|vedic|jain|sikh|sramana/, 12],
  [/jud(a|e)|hebrew|israelite/, 205],
  [/chinese|confucian|dao|tao|shinto/, 325],
  [/zoroastr|manich|persia/, 186],
  [/secular|nonreligious|atheis|humanis/, 240],
  [/folk|indigenous|animism|shaman|pagan|norse|celtic|slavic|near-eastern|greco-roman/, 58],
  [/marx|commun|social|labour/, 355],
  [/liberal|enlightenment|classical-econom|neoliberal/, 212],
  [/conservat|reaction|monarch/, 28],
  [/fasci|nazi|authoritarian/, 275],
  [/anarch/, 0],
  [/national|populis/, 300],
  [/environment|green|ecolog/, 132]];

export interface RibbonCfg {
  canvas: string; d0: number; d1: number; height?: number; mode?: string; colorBy?: string;
  onRender?: (r: any) => void;
}

export function Ribbons(cfg: RibbonCfg) {
  return {
    cv: null as unknown as HTMLCanvasElement, items: [] as any[], lay: null as any, d0: cfg.d0, d1: cfg.d1, mode: cfg.mode || 'norm',
    hover: null as string | null, hoverX: null as number | null, q: '', off: new Set<string>(), H: cfg.height || 560, colorBy: cfg.colorBy || 'region',
    bands: null as any[] | null,
    // Side inset, in px. This used to be a bare 10 and the canvas used to sit inside a
    // padded card that supplied the rest; full-bleed, 10px put centred axis labels and
    // edge-most ribbon names half off the plate. Paint, hit-test, wheel and drag all read
    // it from here so they cannot drift apart again.
    PAD: 22,
    hues: { EU: 210, ME: 35, AS: 52, AM: 150, AF: 0 } as Record<string, number>,
    colorOf(p: any, T: Tokens) {
      void T;
      if (this.colorBy === 'region') {
        const h = this.hues[p.region] !== undefined ? this.hues[p.region] : 280;
        let s = 0; for (let i = 0; i < p.id.length; i++) s = (s * 31 + p.id.charCodeAt(i)) >>> 0;
        return `hsl(${(h + (s % 26) - 13 + 360) % 360} ${38 + s % 20}% ${46 + ((s >> 3) % 18)}%)`;
      }
      // Hue = the great tradition a stream belongs to, found by walking up the ancestry to the
      // first recognised trunk. Family-head alone is too coarse: Christianity, Islam and
      // Zoroastrianism all descend from Near Eastern polytheism and would share one colour.
      const chain = [p.id]; let q = p.id, guard = 0;
      while (this.lay && this.lay.pars.get(q) && this.lay.pars.get(q).length && guard++ < 40) {
        q = this.lay.pars.get(q)[0]; chain.push(q);
      }
      for (let d = 0; d < chain.length; d++) {
        for (const [re, hue] of TRUNKS) if (re.test(chain[d]))
          return `hsl(${hue} ${44 - Math.min(d, 4) * 3}% ${36 + Math.min(d, 5) * 7}%)`;
      }
      const fam = chain[chain.length - 1];
      let s = 0; for (let i = 0; i < fam.length; i++) s = (s * 31 + fam.charCodeAt(i)) >>> 0;
      return `hsl(${(s * 47) % 360} 30% ${44 + Math.min(chain.length, 5) * 5}%)`;
    },
    kin(id: string) {
      const out = new Set([id]); if (!this.lay) return out;
      const up = [id], dn = [id];
      while (up.length) { const c = up.pop()!; for (const p of (this.lay.pars.get(c) || [])) if (!out.has(p)) { out.add(p); up.push(p); } }
      while (dn.length) { const c = dn.pop()!; for (const k of (this.lay.kids.get(c) || [])) if (!out.has(k)) { out.add(k); dn.push(k); } }
      return out;
    },
    render() {
      if (!this.cv) return;
      const d = fitCanvas(this.cv, this.H); if (!d) return;
      const { cw, ctx } = d; const T = tokens(); const H = this.H;
      ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
      const G = this.PAD, Wp = cw - G * 2, TOP = 26, BOT = H - 30, PH = BOT - TOP;
      const vis = this.items.filter(i => !this.off.has(i.region));
      if (!vis.length) {
        // "None" is now a button, so an empty canvas is usually the reader's own doing —
        // saying "no data loaded" there would be a lie and a dead end.
        ctx.fillStyle = T.ink3; ctx.font = fontUI(13);
        ctx.fillText(this.items.length
          ? 'Every region is hidden. Press ALL, or pick one, to bring the ribbons back.'
          : 'No data loaded for this view.', G + 10, H / 2);
        return;
      }
      this.lay = flowLayout(vis, Wp, PH, this.d0, this.d1, this.mode);
      const X = (y: number) => G + (y - this.d0) / (this.d1 - this.d0) * Wp;
      const q = this.q.toLowerCase();
      const kin = this.hover ? this.kin(this.hover) : null;
      this.bands = [];
      const labels: { text: string; x: number; y: number; min: number; max: number; size: number }[] = [];
      for (const [id, a] of this.lay.paths) {
        if (a.top.length < 2) continue;
        const p = a.p, col = this.colorOf(p, T);
        const dim = (kin && !kin.has(id)) || (q && !p.name.toLowerCase().includes(q));
        ctx.globalAlpha = dim ? 0.13 : (kin && kin.has(id) ? 0.98 : 0.86);
        ctx.beginPath();
        ctx.moveTo(X(a.top[0][0]), TOP + a.top[0][1]);
        for (let i = 1; i < a.top.length; i++) ctx.lineTo(X(a.top[i][0]), TOP + a.top[i][1]);
        for (let i = a.bot.length - 1; i >= 0; i--) ctx.lineTo(X(a.bot[i][0]), TOP + a.bot[i][1]);
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        if (kin && kin.has(id)) { ctx.strokeStyle = T.ink; ctx.lineWidth = 1.1; ctx.globalAlpha = .5; ctx.stroke(); }
        // label inside the ribbon at its thickest point
        let bi = 0, bt = 0;
        for (let i = 0; i < a.top.length; i++) { const t = a.bot[i][1] - a.top[i][1]; if (t > bt) { bt = t; bi = i; } }
        const bx = X(a.top[bi][0]), by = TOP + (a.top[bi][1] + a.bot[bi][1]) / 2;
        const x0 = X(a.top[0][0]), x1 = X(a.top[a.top.length - 1][0]);
        if (bt >= 11 && x1 - x0 > 44 && !dim)
          labels.push({ text: p.name, x: bx, y: by, min: x0, max: x1, size: clamp(bt * 0.55, 10, 13) });
        this.bands.push({ id, a, p, col });
        ctx.globalAlpha = 1;
      }
      // lineage links across gaps (conquests, revivals)
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
      for (const b of this.bands) {
        for (const k of (this.lay.kids.get(b.id) || [])) {
          const kb = this.lay.paths.get(k); if (!kb || !kb.top.length) continue;
          const ax = X(b.a.top[b.a.top.length - 1][0]), ay = TOP + (b.a.top[b.a.top.length - 1][1] + b.a.bot[b.a.bot.length - 1][1]) / 2;
          const bx = X(kb.top[0][0]), by = TOP + (kb.top[0][1] + kb.bot[0][1]) / 2;
          if (Math.abs(bx - ax) < 3 && Math.abs(by - ay) < 26) continue;
          ctx.globalAlpha = (kin && (kin.has(b.id) && kin.has(k))) ? .75 : .16;
          ctx.strokeStyle = T.ink2; ctx.beginPath(); ctx.moveTo(ax, ay);
          ctx.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by); ctx.stroke();
        }
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // axis
      ctx.strokeStyle = T.line; ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
      const span = this.d1 - this.d0;
      const steps = [2000, 1000, 500, 250, 100, 50, 25, 10, 5];
      const step = steps.find(s => span / s >= 6) || 5;
      ctx.beginPath();
      for (let y = Math.ceil(this.d0 / step) * step; y <= this.d1; y += step) {
        const x = X(y); ctx.moveTo(x, TOP - 6); ctx.lineTo(x, BOT + 4);
        // the tick keeps its exact x; only the centred label is nudged in, because a
        // first or last tick landing on the inset used to render as "00 BCE"
        const hw = ctx.measureText(fmtY(y)).width / 2;
        ctx.fillText(fmtY(y), clamp(x, hw + 3, cw - hw - 3), BOT + 20);
      }
      ctx.globalAlpha = .3; ctx.stroke(); ctx.globalAlpha = 1; ctx.textAlign = 'left';

      // ---- ribbon names, in one pass, on top of everything they name ----
      // Ribbons are filled in lineage order, so a name painted the instant its own ribbon
      // was filled got buried under every ribbon filled after it. That — not the canvas
      // edge — is where "Qing Dynast", "Portu…" and "Ancien(t Egypt)" came from. Same
      // two-pass shape connections.ts already uses for its labels.
      //
      // Thickest ribbon first, so when two names want the same patch of canvas the bigger
      // power keeps it, and the loser is simply absent rather than half-legible on top of
      // its neighbour.
      ctx.textAlign = 'center';
      const placed: number[][] = [];
      for (const L of labels.slice().sort((a, b) => b.size - a.size)) {
        ctx.font = fontUI(L.size, 600);                    // a polity name is language
        const half = ctx.measureText(L.text).width / 2;
        if (half * 2 > L.max - L.min - 8) continue;        // will not fit inside its own ribbon
        let lx = clamp(L.x, L.min + half + 4, L.max - half - 4);
        lx = clamp(lx, half + 3, cw - half - 3);           // ...and never off the plate
        if (lx - half < L.min || lx + half > L.max) continue;
        const box = [lx - half - 2, L.y - L.size * 0.7, lx + half + 2, L.y + L.size * 0.55];
        if (placed.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
        placed.push(box);
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,.34)';
        ctx.fillText(L.text, lx + 0.7, L.y + 4.4);
        ctx.fillStyle = '#fff'; ctx.fillText(L.text, lx, L.y + 3.8);
      }
      ctx.textAlign = 'left';
      if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
        const yr = this.d0 + (this.hoverX - G) / Wp * span;
        ctx.strokeStyle = T.accent; ctx.globalAlpha = .5; ctx.beginPath();
        ctx.moveTo(this.hoverX, TOP - 6); ctx.lineTo(this.hoverX, BOT + 2); ctx.stroke(); ctx.globalAlpha = 1;
        yearPill(ctx, T, this.hoverX, 2, fmtY(yr));
      }
      if (cfg.onRender) cfg.onRender(this);
    },
    at(mx: number, my: number) {
      const G = this.PAD, Wp = this.cv.clientWidth - G * 2, TOP = 26;
      if (!this.bands) return null;
      for (const b of this.bands) {
        const a = b.a; const n = a.top.length;
        const x0 = G + (a.top[0][0] - this.d0) / (this.d1 - this.d0) * Wp;
        const x1 = G + (a.top[n - 1][0] - this.d0) / (this.d1 - this.d0) * Wp;
        if (mx < x0 - 2 || mx > x1 + 2) continue;
        const t = clamp(Math.round((mx - x0) / Math.max(x1 - x0, 1) * (n - 1)), 0, n - 1);
        if (my >= TOP + a.top[t][1] - 1 && my <= TOP + a.bot[t][1] + 1) return b;
      }
      return null;
    },
    init() {
      const cv = this.cv = $<HTMLCanvasElement>(cfg.canvas)!;
      cv.addEventListener('pointermove', e => {
        const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        this.hoverX = mx;
        const b = this.at(mx, my);
        const id = b ? b.id : null;
        this.hover = id; this.render();
        if (b) {
          const p = b.p;
          const par = (this.lay.pars.get(p.id) || []).map((i: string) => this.lay.set.get(i).name);
          const kid = (this.lay.kids.get(p.id) || []).map((i: string) => this.lay.set.get(i).name);
          showTip(e.clientX, e.clientY, `<div class=t>${p.name}</div><div class=m>${fmtY(p.start)} – ${fmtY(p.end)}${p.region ? ' · ' + p.region : ''}</div>` +
            (p.note ? `<div class=m>${p.note}</div>` : '') +
            (par.length ? `<div class=m>← from ${par.join(', ')}</div>` : '') +
            (kid.length ? `<div class=m>→ becomes ${kid.join(', ')}</div>` : ''));
          cv.style.cursor = 'pointer';
        } else { hideTip(); cv.style.cursor = 'crosshair'; }
      });
      cv.addEventListener('pointerleave', () => { hideTip(); this.hover = null; this.hoverX = null; this.render(); });
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect(); const G = this.PAD, Wp = cv.clientWidth - G * 2;
        const yc = this.d0 + (e.clientX - r.left - G) / Wp * (this.d1 - this.d0);
        const f = Math.pow(1.0018, e.deltaY); const s = clamp((this.d1 - this.d0) * f, 60, 16000);
        const frac = (yc - this.d0) / (this.d1 - this.d0);
        this.d0 = yc - frac * s; this.d1 = this.d0 + s; this.render();
      }, { passive: false });
      let drag: any = null;
      cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, d0: this.d0, d1: this.d1 }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointerup', () => { drag = null; });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const G = this.PAD, Wp = cv.clientWidth - G * 2;
        const dy = (e.clientX - drag.x) / Wp * (drag.d1 - drag.d0);
        this.d0 = drag.d0 - dy; this.d1 = drag.d1 - dy; this.render();
      });
      repaintOnFonts(() => this.render());
    },
    animTo(a: number, b: number) {
      if (reduceMotion()) { this.d0 = a; this.d1 = b; this.render(); return; }
      const A = this.d0, B = this.d1, t0 = performance.now();
      const step = (t: number) => {
        const p = clamp((t - t0) / 620, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        this.d0 = A + (a - A) * e; this.d1 = B + (b - B) * e; this.render(); if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };
}

// ================= ③ FLOW OF EMPIRES =================
export const Flow = Ribbons({
  canvas: '#flowCanvas', d0: -1200, d1: 2026, height: 600, mode: 'norm', colorBy: 'region',
  onRender(r) {
    const n = r.items.length;
    $('#flowCap')!.innerHTML = `<b>${n} polities, ${r.mode === 'norm' ? 'share of world weight' : 'absolute weight'}.</b> ` +
      `Thickness is an editorial estimate of scale and influence (10 = the dominant power on Earth of its era, 1 = a small local culture) — an argument, not a measurement. ` +
      `Dashed curves are lineage links that jump across the stack: a conquest, a partition, a revival.`;
  },
});

export const REGIONNAMES: Record<string, string> = { EU: 'Europe', ME: 'MidEast & Africa', AS: 'Asia', AM: 'Americas & Oceania', AF: 'Africa' };

// ================= region filter — All / None / only =================
// "Disable/enable all categories so I can choose just specific ones" shipped for the
// timeline's #catRow and stopped there; these chips are the same need, so they get the
// same three verbs, the same words and the same restore-what-I-had behaviour. Flow.off is
// the single source of truth — everything below is only a different way of writing it.
let REGIONS: string[] = [];
// what the reader was looking at before they isolated one region, so "back" can restore it
let regionPrevOff: Set<string> | null = null;
const regionIsSolo = (rg?: string) =>
  REGIONS.length > 1 && Flow.off.size === REGIONS.length - 1 && (rg === undefined || !Flow.off.has(rg));

function regionAll() { Flow.off.clear(); regionPrevOff = null; syncRegionChips(); Flow.render(); }
function regionNone() {
  if (Flow.off.size !== REGIONS.length) regionPrevOff = new Set(Flow.off);
  Flow.off = new Set(REGIONS);
  syncRegionChips(); Flow.render();
}
function regionToggle(rg: string) {
  if (Flow.off.has(rg)) Flow.off.delete(rg); else Flow.off.add(rg);
  syncRegionChips(); Flow.render();
}
function regionSolo(rg: string) {
  if (regionIsSolo(rg)) {
    Flow.off = regionPrevOff ? new Set(regionPrevOff) : new Set<string>();
    regionPrevOff = null;
  } else {
    if (!regionIsSolo()) regionPrevOff = new Set(Flow.off);   // don't clobber it while hopping solo→solo
    Flow.off = new Set(REGIONS.filter(r => r !== rg));
  }
  syncRegionChips(); Flow.render();
}
function syncRegionChips() {
  document.querySelectorAll<HTMLElement>('#flowRegionRow .chip[data-region]').forEach(ch => {
    const rg = ch.dataset.region!, name = REGIONNAMES[rg] || rg;
    const shown = !Flow.off.has(rg), solo = regionIsSolo(rg);
    ch.classList.toggle('on', shown);
    ch.setAttribute('aria-pressed', String(shown));
    const only = ch.querySelector<HTMLElement>('.only');
    if (only) only.textContent = solo ? 'back' : 'only';
    ch.title = solo
      ? `${name} is the only region showing. BACK (or ⌥/Alt-click, or Alt+Enter) restores the set you had before.`
      : `${name} — click to show or hide. ONLY (or ⌥/Alt-click, or Alt+Enter) isolates this region.`;
  });
  const cnt = $('#flowRegionCount');
  if (cnt) cnt.textContent = `${REGIONS.length - Flow.off.size} of ${REGIONS.length}`;
}
// Appends into the EXISTING #flowRegionRow (Lab.tsx owns that element) — append only,
// never restructure.
function buildRegionRow() {
  const row = $('#flowRegionRow'); if (!row) return;
  REGIONS = [...new Set(POLITIES.map(p => p.region))].filter(Boolean) as string[];
  if (row.querySelector('[data-region]')) { syncRegionChips(); return; }   // already built (HMR / re-init)
  const OFF = '.45';                                             // resting opacity of the "only" affordance

  // All / None are VERBS, not filters — .chip.catall in globals.css deliberately gives
  // them no swatch and no pressed state, so nothing is set inline. The live state they act
  // on is carried by the "n of 5" readout instead.
  const master = (kind: 'all' | 'none', label: string, hint: string) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip catall'; b.dataset.regionall = kind;
    b.textContent = label; b.title = hint;
    b.addEventListener('click', () => (kind === 'all' ? regionAll() : regionNone()));
    row.appendChild(b);
  };
  master('all', 'All', 'Show every region');
  master('none', 'None', 'Hide every region — then click the one or two you want');

  const cnt = document.createElement('span');
  cnt.className = 'note'; cnt.id = 'flowRegionCount';
  cnt.style.cssText = 'font-variant-numeric:tabular-nums';
  row.appendChild(cnt);

  const sep = document.createElement('span');
  sep.setAttribute('aria-hidden', 'true');
  sep.style.cssText = 'flex:none;align-self:center;width:1px;height:15px;background:var(--line)';
  row.appendChild(sep);

  for (const rg of REGIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip on'; b.dataset.region = rg;
    b.setAttribute('aria-pressed', 'true');
    // the "only" tag is a mouse target INSIDE the button, so it must not be focusable
    // itself (interactive content may not nest). aria-keyshortcuts is the keyboard route
    // and, unlike a title tooltip, screen readers announce it.
    b.setAttribute('aria-keyshortcuts', 'Alt+Enter');
    const hue = Flow.hues[rg] !== undefined ? Flow.hues[rg] : 280;
    b.innerHTML = `<span class="dot" style="background:hsl(${hue} 45% 52%)"></span>${REGIONNAMES[rg] || rg}` +
      `<span class="only" aria-hidden="true" style="padding-left:7px;` +
      `border-left:1px solid var(--line);font-size:var(--tl-text-2xs,10px);` +
      `letter-spacing:var(--tl-track-caps,.06em);text-transform:uppercase;` +
      `opacity:${OFF}">only</span>`;
    b.addEventListener('click', e => {
      const t = e.target as HTMLElement | null;
      if ((t && t.closest && t.closest('.only')) || e.altKey || e.metaKey) regionSolo(rg);
      else regionToggle(rg);
    });
    // a keyboard-activated click carries no modifier state in Chromium, so Alt+Enter /
    // Alt+Space must be caught here or the isolate has no keyboard route at all
    b.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); regionSolo(rg); }
    });
    const only = b.querySelector<HTMLElement>('.only')!;
    const fade = (v: string) => { only.style.opacity = v; };
    b.addEventListener('pointerenter', () => fade('1'));
    b.addEventListener('pointerleave', () => fade(OFF));
    b.addEventListener('focus', () => fade('1'));
    b.addEventListener('blur', () => fade(OFF));
    row.appendChild(b);
  }
  syncRegionChips();
}

export function initFlow() {
  Flow.items = POLITIES;
  Flow.init();
  buildRegionRow();
  $('#flowRome')!.addEventListener('click', () => { Flow.q = ''; ($('#flowSearch') as HTMLInputElement).value = ''; Flow.animTo(-300, 900); });
  $('#flowSplit')!.addEventListener('click', () => Flow.animTo(180, 820));
  $('#flowAll')!.addEventListener('click', () => Flow.animTo(-1200, 2026));
  $('#flowMode')!.addEventListener('click', (e: any) => {
    Flow.mode = Flow.mode === 'norm' ? 'abs' : 'norm';
    e.target.textContent = Flow.mode === 'norm' ? 'Absolute scale' : 'Share of world';
    Flow.render();
  });
  $('#flowSearch')!.addEventListener('input', (e: any) => {
    Flow.q = e.target.value.trim(); Flow.render();
    const n = Flow.q ? POLITIES.filter(p => p.name.toLowerCase().includes(Flow.q.toLowerCase())).length : 0;
    $('#flowCnt')!.textContent = Flow.q ? `${n} hits` : '';
  });
}
