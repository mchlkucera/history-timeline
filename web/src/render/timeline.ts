/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ② ZOOMABLE TIMELINE =================
// Ported from prototypes/partB.html. Only change: `cv` is resolved in init().
import {
  $, EVENTS, CATS, CATBY, catColor, clamp, fitCanvas, fmtBig, fmtY, fontMono, fontUI, hideTip, reduceMotion,
  repaintOnFonts, showTip, tokens, yearPill,
} from './shared';

export const TL = {
  cv: null as unknown as HTMLCanvasElement, d0: -3000, d1: 2026, log: false,
  lens: { MU: false, SC: false, MZ: true } as Record<string, boolean>, q: '', hoverX: null as number | null, off: new Set<string>(),
  THR: { 1: Infinity, 2: 40000, 3: 2400, 4: 650, 5: 170 } as Record<number, number>,
  bands(): [string, string, number, number | null][] {
    const b: [string, string, number, number | null][] = [['CO', 'Deep time', 34, null], ['EU', 'Europe', 86, 0], ['ME', 'MidEast & Africa', 86, 1], ['AS', 'Asia', 86, 2], ['AM', 'Americas', 86, 3]];
    if (this.lens.MU) b.push(['MU', 'Music', 88, 4]); if (this.lens.SC) b.push(['SC', 'Science & ideas', 88, 5]); if (this.lens.MZ) b.push(['MZ', 'Mozart', 88, 6]);
    return b;
  },
  span() { return this.d1 - this.d0; },
  LMAX: 10.2,
  x(y: number, G: number, Wp: number) {
    if (!this.log) return G + (y - this.d0) / this.span() * Wp;
    const ya = Math.max(2026.5 - y, 0.6); return G + (1 - Math.log10(ya) / this.LMAX) * Wp;
  },
  ix(x: number, G: number, Wp: number) {
    if (!this.log) return this.d0 + (x - G) / Wp * this.span();
    return 2026.5 - Math.pow(10, (1 - (x - G) / Wp) * this.LMAX);
  },
  levelFor(S: number) { if (S <= this.THR[5]) return 5; if (S <= this.THR[4]) return 4; if (S <= this.THR[3]) return 3; if (S <= this.THR[2]) return 2; return 1; },
  alphaFor(lvl: number, S: number, isLens: boolean) {
    const t = this.THR[lvl] * (isLens ? 2.5 : 1); if (!isFinite(t)) return 1;
    if (S <= t) return 1; if (S <= t * 1.6) return 1 - (S - t) / (t * .6); return 0;
  },
  size() {
    if (!this.cv) return null;
    const H = this.bands().reduce((a, b) => a + b[2], 0) + 34;
    const d = fitCanvas(this.cv, H); return d ? { cw: d.cw, H, ctx: d.ctx } : null;
  },
  boxes: [] as any[],
  render() {
    const dim = this.size(); if (!dim) return;
    const { cw, H, ctx } = dim; const T = tokens();
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    const G = 118, Wp = cw - G - 10;
    const bands = this.bands(); this.boxes = [];
    const q = this.q.toLowerCase();
    let hitCount = 0;
    if (!this.log) {
      const eras: [number, number, string][] = [[-800, 476, 'Antiquity'], [476, 1453, 'Middle Ages'], [1453, 1789, 'Early Modern'], [1789, 2026, 'Modern']];
      ctx.textAlign = 'left'; ctx.font = fontUI(10);                 // an era name is language
      for (const [a, b, n] of eras) {
        const xa = clamp(this.x(a, G, Wp), G, cw - 10), xb = clamp(this.x(b, G, Wp), G, cw - 10);
        if (xb - xa < 4) continue;
        ctx.fillStyle = T.ink; ctx.globalAlpha = .055; ctx.fillRect(xa, 0, xb - xa, H - 30);
        if (xb - xa > 70) { ctx.globalAlpha = .75; ctx.fillStyle = T.ink3; ctx.fillText(n, xa + 5, 12); }
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.font = fontMono(11); ctx.fillStyle = T.ink2; ctx.textAlign = 'center';   // years are measurements
    if (!this.log) {
      const steps = [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
      const step = steps.find(s => this.span() / s <= 14) || 1;
      const start = Math.ceil(this.d0 / step) * step;
      ctx.beginPath();
      for (let y = start; y <= this.d1; y += step) {
        const x = this.x(y, G, Wp);
        ctx.moveTo(x, 0); ctx.lineTo(x, H - 30);
        ctx.fillText(fmtY(y), x, H - 10);
      }
      ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      const labs: [number, string][] = [[1e10, '10 Gya'], [1e9, '1 Gya'], [1e8, '100 Mya'], [1e7, '10 Mya'], [1e6, '1 Mya'], [1e5, '100 kya'], [1e4, '10 kya'], [1e3, '1,000 ya'], [100, '100 ya'], [10, '10 ya']];
      ctx.beginPath();
      for (const [ya, lab] of labs) {
        const x = this.x(2026.5 - ya, G, Wp);
        if (x < G) continue;
        ctx.moveTo(x, 0); ctx.lineTo(x, H - 30); ctx.fillText(lab, x, H - 10);
      }
      ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
    }
    const xn = this.x(2026, G, Wp);
    if (xn >= G && xn <= cw) { ctx.strokeStyle = T.accent2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xn, 0); ctx.lineTo(xn, H - 30); ctx.stroke(); ctx.setLineDash([]); }
    let yTop = 0;
    const baseL = this.log ? 2 : this.levelFor(this.span());
    for (const [key, label, bh, si] of bands) {
      ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(0, yTop + bh); ctx.lineTo(cw, yTop + bh); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = si === null ? T.ink2 : T.s[si]; ctx.beginPath(); ctx.arc(10, yTop + 13, 4, 0, 7); ctx.fill();
      ctx.fillStyle = T.ink2; ctx.font = fontUI(10.5, 600); ctx.textAlign = 'left';   // a band name is language
      ctx.fillText(label.toUpperCase(), 20, yTop + 17);
      const isLens = ['MU', 'SC', 'MZ'].includes(key);
      const evs = EVENTS.filter(e => e[3] === key && !this.off.has(e[6])).sort((a, b) => a[0] - b[0]);
      const laneH = 17, maxLanes = Math.max(1, Math.floor((bh - 24) / laneH));
      const laneEnd = new Array(maxLanes).fill(-1e18);
      ctx.font = fontUI(11.5);                                       // event titles are language
      for (const ev of evs) {
        const [y0, y1, title, , lvl] = ev; const cat = ev[6], typ = ev[7];
        let a = this.log ? (key === 'CO' ? 1 : (lvl <= 2 ? 1 : 0)) : this.alphaFor(lvl, this.span(), isLens);
        if (a <= 0.02) continue;
        const x0 = this.x(y0, G, Wp); const xe = y1 ? this.x(y1, G, Wp) : x0;
        if (xe < G - 40 || x0 > cw) continue;
        const isMatch = q && ((title.toLowerCase().includes(q)) || ev[5].includes(q));
        if (q) { if (isMatch) { hitCount++; } else a *= .12; }
        const col = catColor(cat, T);
        const labelW = ctx.measureText(title).width;
        let lane = laneEnd.findIndex(le => le < x0 - 4), noLabel = false;
        if (lane < 0) {
          lane = 0; let m = 1e18; laneEnd.forEach((le, i) => { if (le < m) { m = le; lane = i; } });
          if (laneEnd[lane] >= x0 - 4) noLabel = true;
        }
        const prevEnd = laneEnd[lane];
        const rightX = (y1 ? Math.max(xe, x0) : x0) + 7;
        let mode = noLabel ? 'none' : 'right';
        if (mode === 'right' && rightX + labelW >= cw - 4)
          mode = (x0 - 9 - labelW > Math.max(G, prevEnd + 4)) ? 'left' : 'none';
        laneEnd[lane] = Math.max(prevEnd, Math.max(xe, x0) + 8 + (mode === 'right' ? labelW : 0));
        const yy = yTop + 26 + lane * laneH;
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.strokeStyle = col;
        const w = Math.max(xe - x0, 6);
        if (typ === 'era') {                                   // translucent swath
          ctx.globalAlpha = a * .22; ctx.fillRect(x0, yTop + 22, w, bh - 26);
          ctx.globalAlpha = a * .9; ctx.fillRect(x0, yy - 1, w, 2);
        } else if (typ === 'zone') {                            // thick tapered ribbon
          const th = Math.max(5, 12 - lvl * 1.2);
          ctx.beginPath();
          ctx.moveTo(x0, yy); ctx.lineTo(x0 + Math.min(9, w * .28), yy - th / 2);
          ctx.lineTo(x0 + w - Math.min(9, w * .28), yy - th / 2); ctx.lineTo(x0 + w, yy);
          ctx.lineTo(x0 + w - Math.min(9, w * .28), yy + th / 2); ctx.lineTo(x0 + Math.min(9, w * .28), yy + th / 2);
          ctx.closePath(); ctx.fill();
        } else if (typ === 'life') {                            // capsule with birth dot + death cap
          ctx.globalAlpha = a * .55; ctx.beginPath(); ctx.roundRect(x0, yy - 3.5, w, 7, 3.5); ctx.fill();
          ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x0, yy, 3.4, 0, 7); ctx.fill();
          ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + w, yy - 5); ctx.lineTo(x0 + w, yy + 5); ctx.stroke();
        } else if (y1 || typ === 'episode') {                     // bar
          ctx.beginPath(); ctx.roundRect(x0, yy - 4, w, 8, 4); ctx.fill();
        } else {                                            // moment — a quiet point
          ctx.beginPath(); ctx.arc(x0, yy, 3.2, 0, 7); ctx.fill();
        }
        if (isMatch) { ctx.strokeStyle = T.accent2; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x0, yy, 7, 0, 7); ctx.stroke(); }
        ctx.fillStyle = T.ink;
        if (a > 0.25) {
          if (mode === 'right') ctx.fillText(title, rightX, yy + 4);
          else if (mode === 'left') ctx.fillText(title, x0 - 9 - labelW, yy + 4);
        }
        ctx.globalAlpha = 1;
        this.boxes.push({ x: (mode === 'left' ? x0 - 11 - labelW : x0 - 8), y: yy - 9, w: (y1 ? xe - x0 : 0) + 16 + (mode === 'none' ? 4 : labelW), h: 18, ev, band: label });
      }
      yTop += bh;
    }
    // hover crosshair + year readout
    if (this.hoverX !== null && this.hoverX > G && this.hoverX < cw) {
      const yr = this.ix(this.hoverX, G, Wp);
      ctx.strokeStyle = T.accent; ctx.globalAlpha = .55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hoverX, 0); ctx.lineTo(this.hoverX, H - 30); ctx.stroke();
      ctx.globalAlpha = 1;
      yearPill(ctx, T, this.hoverX, H - 26, this.log ? fmtBig(yr) : fmtY(yr));
    }
    $('#zoomReadout')!.textContent = this.log ? 'log scale · Big Bang → now' :
      `showing importance ≤ ${baseL} of 5 · span ${Math.round(this.span()).toLocaleString()} yrs`;
    $('#searchCnt')!.textContent = q ? `${hitCount} hits` : '';
  },
  animTo(a: number, b: number) {
    if (reduceMotion()) { this.d0 = a; this.d1 = b; this.render(); return; }
    const A0 = this.d0, B0 = this.d1, t0 = performance.now();
    const step = (t: number) => {
      const p = clamp((t - t0) / 650, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.d0 = A0 + (a - A0) * e; this.d1 = B0 + (b - B0) * e; this.render();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#zoomCanvas')!;
    // his own life events, plus the music row so his lifespan sits beside Bach's and Beethoven's
    $('#btnMozart')!.addEventListener('click', () => {
      this.log = false; this.lens.MZ = true; this.lens.MU = true;
      this.syncChips(); this.animTo(1735, 1835);
    });
    $('#btn1776z')!.addEventListener('click', () => { this.log = false; this.animTo(1746, 1806); });
    $('#btnDeep')!.addEventListener('click', () => { this.log = !this.log; this.render(); });
    $('#btnResetZ')!.addEventListener('click', () => { this.log = false; this.animTo(-3000, 2026); });
    $('#searchBox')!.addEventListener('input', (e: any) => { this.q = e.target.value.trim(); this.render(); });
    document.querySelectorAll<HTMLElement>('#lensRow .chip').forEach(ch => ch.addEventListener('click', () => {
      const k = ch.dataset.lens!; this.lens[k] = !this.lens[k]; ch.classList.toggle('on', this.lens[k]); this.render();
    }));
    this.buildCatRow();
    buildGrammarLegend();
    repaintOnFonts(() => this.render());
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (this.log) return;
      const r = cv.getBoundingClientRect(); const G = 118, Wp = cv.clientWidth - G - 10;
      const yc = this.ix(e.clientX - r.left, G, Wp);
      const f = Math.pow(1.0018, e.deltaY); const s = clamp(this.span() * f, 8, 80000);
      const frac = (yc - this.d0) / this.span();
      this.d0 = yc - frac * s; this.d1 = this.d0 + s; this.render();
    }, { passive: false });
    let drag: any = null;
    cv.addEventListener('pointerdown', e => { if (!this.log) { drag = { x: e.clientX, d0: this.d0, d1: this.d1, moved: false }; cv.setPointerCapture(e.pointerId); } });
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.hoverX = mx;
      if (drag) {
        const G = 118, Wp = cv.clientWidth - G - 10;
        const dy = (e.clientX - drag.x) / Wp * (drag.d1 - drag.d0);
        if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
        this.d0 = drag.d0 - dy; this.d1 = drag.d1 - dy; this.render(); return;
      }
      const b = this.boxes.findLast(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
      this.render();
      if (b) {
        const [y0, y1, t, , lvl] = b.ev; const cat = CATBY[b.ev[6]], typ = b.ev[7], pl = b.ev[8];
        showTip(e.clientX, e.clientY, `<div class=t>${t}</div><div class=m>${fmtBig(y0)}${y1 ? ' – ' + fmtY(y1) : ''} · ${b.band}</div>` +
          `<div class=m>${cat ? cat.name : ''} · ${typ}${pl ? ' · ' + pl[2] : ''}</div>` +
          `<div class=m>importance ${'●'.repeat(6 - lvl)}${'○'.repeat(lvl - 1)} (${lvl}) · click → Wikipedia</div>`);
        cv.style.cursor = 'pointer';
      } else { hideTip(); cv.style.cursor = 'crosshair'; }
    });
    cv.addEventListener('pointerup', e => {
      const wasDrag = drag && drag.moved; drag = null; if (wasDrag) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const b = this.boxes.findLast(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
      if (b) {
        const t = b.ev[2].split(/ — | \(|·/)[0];
        window.open('https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(t), '_blank');
      }
    });
    cv.addEventListener('pointerleave', () => { hideTip(); this.hoverX = null; this.render(); });
    this.syncChips();
  },
  syncChips() { document.querySelectorAll<HTMLElement>('#lensRow .chip').forEach(ch => ch.classList.toggle('on', this.lens[ch.dataset.lens!])); },

  // ================= domain (category) filter =================
  // `off` is the set of hidden category ids; render() filters on it. Everything below is a
  // different way of WRITING that one set, so there is exactly one source of truth.
  // The set the reader had before they soloed a single domain, so "back" can restore it.
  catPrevOff: null as Set<string> | null,
  // true when exactly one domain is visible (and, with an argument, when it is that one)
  catIsSolo(id?: string) { return this.off.size === CATS.length - 1 && (id === undefined || !this.off.has(id)); },
  catAll() { this.off.clear(); this.catPrevOff = null; this.syncCatChips(); this.render(); },
  catNone() {
    if (this.off.size !== CATS.length) this.catPrevOff = new Set(this.off);
    this.off = new Set(CATS.map(c => c.id));
    this.syncCatChips(); this.render();
  },
  catToggle(id: string) {
    if (this.off.has(id)) this.off.delete(id); else this.off.add(id);
    this.syncCatChips(); this.render();
  },
  // "only" — isolate one domain. Pressing it again on the isolated domain restores the set
  // that was showing before the first press, so isolating is a look, not a destination.
  catSolo(id: string) {
    if (this.catIsSolo(id)) {
      this.off = this.catPrevOff ? new Set(this.catPrevOff) : new Set<string>();
      this.catPrevOff = null;
    } else {
      if (!this.catIsSolo()) this.catPrevOff = new Set(this.off);   // don't clobber it while hopping solo→solo
      this.off = new Set(CATS.filter(c => c.id !== id).map(c => c.id));
    }
    this.syncCatChips(); this.render();
  },
  // Builds into the EXISTING #catRow (Lab.tsx owns that element) — append only, never restructure.
  buildCatRow() {
    const row = $('#catRow'); if (!row) return;
    if (row.querySelector('[data-cat]')) { this.syncCatChips(); return; }   // already built (HMR / re-init)
    const OFF = '.45';                                             // resting opacity of the "only" affordance

    // All / None are VERBS, not filters — globals.css styles .chip.catall and deliberately
    // gives them no swatch and no pressed state, so nothing is set inline here. The live
    // state they act on is carried by the "n of 8" readout instead.
    const master = (kind: 'all' | 'none', label: string, hint: string) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip catall'; b.dataset.catall = kind;
      b.textContent = label; b.title = hint;
      b.addEventListener('click', () => (kind === 'all' ? this.catAll() : this.catNone()));
      row.appendChild(b);
    };
    master('all', 'All', 'Show every domain');
    master('none', 'None', 'Hide every domain — then click the one or two you want');

    const cnt = document.createElement('span');
    cnt.className = 'note'; cnt.id = 'catCount';
    cnt.style.cssText = 'font-variant-numeric:tabular-nums';
    row.appendChild(cnt);

    const sep = document.createElement('span');
    sep.setAttribute('aria-hidden', 'true');
    sep.style.cssText = 'flex:none;align-self:center;width:1px;height:15px;background:var(--line)';
    row.appendChild(sep);

    for (const c of CATS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip on'; b.dataset.cat = c.id;
      b.setAttribute('aria-pressed', 'true');
      // the "only" tag is a mouse target inside the button, so it cannot be focusable itself
      // (interactive content may not nest). aria-keyshortcuts is the keyboard equivalent and,
      // unlike a title tooltip, screen readers announce it — so it is advertised, not hidden.
      b.setAttribute('aria-keyshortcuts', 'Alt+Enter');
      // the "only" tag borrows .chip.catall's typography so the two verbs read as one family
      b.innerHTML = `<span class="dot" style="background:var(--s${c.si + 1})"></span>${c.name}` +
        `<span class="only" aria-hidden="true" style="padding-left:7px;` +
        `border-left:1px solid var(--line);font-size:var(--tl-text-2xs,10px);` +
        `letter-spacing:var(--tl-track-caps,.06em);text-transform:uppercase;` +
        `opacity:${OFF}">only</span>`;
      b.addEventListener('click', e => {
        const t = e.target as HTMLElement | null;
        if ((t && t.closest && t.closest('.only')) || e.altKey || e.metaKey) this.catSolo(c.id);
        else this.catToggle(c.id);
      });
      // a keyboard-activated click carries no modifier state in Chromium, so Alt+Enter /
      // Alt+Space must be caught here or the isolate has no keyboard route at all.
      b.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.catSolo(c.id); }
      });
      // the affordance is always present (so it is seen, not discovered) but quiet until aimed at
      const only = b.querySelector<HTMLElement>('.only')!;
      const fade = (v: string) => { only.style.opacity = v; };
      b.addEventListener('pointerenter', () => fade('1'));
      b.addEventListener('pointerleave', () => fade(OFF));
      b.addEventListener('focus', () => fade('1'));
      b.addEventListener('blur', () => fade(OFF));
      row.appendChild(b);
    }
    this.syncCatChips();
  },
  syncCatChips() {
    document.querySelectorAll<HTMLElement>('#catRow .chip[data-cat]').forEach(ch => {
      const id = ch.dataset.cat!, name = CATBY[id] ? CATBY[id].name : id;
      const shown = !this.off.has(id), solo = this.catIsSolo(id);
      ch.classList.toggle('on', shown);
      ch.setAttribute('aria-pressed', String(shown));
      // the affordance names what it will do next, so "press it again to go back" is read, not learnt
      const only = ch.querySelector<HTMLElement>('.only');
      if (only) only.textContent = solo ? 'back' : 'only';
      ch.title = solo
        ? `${name} is the only domain showing. BACK (or ⌥/Alt-click, or Alt+Enter) restores the set you had before.`
        : `${name} — click to show or hide. ONLY (or ⌥/Alt-click, or Alt+Enter) isolates this domain.`;
    });
    const cnt = $('#catCount');
    if (cnt) cnt.textContent = `${CATS.length - this.off.size} of ${CATS.length}`;
  },
};

export function buildGrammarLegend() {
  const row = $('#grammarRow'); if (!row) return;
  const g = (svg: string, label: string) => `<span class="g"><svg width="30" height="14" viewBox="0 0 30 14">${svg}</svg>${label}</span>`;
  const c = 'var(--ink2)';
  row.innerHTML = `<span class="note" style="font-weight:600">Shape =</span>` +
    g(`<circle cx="15" cy="7" r="3.2" fill="${c}"/>`, 'moment') +
    g(`<rect x="3" y="3" width="24" height="8" rx="4" fill="${c}"/>`, 'episode') +
    g(`<rect x="4" y="4" width="22" height="7" rx="3.5" fill="${c}" opacity=".55"/><circle cx="4" cy="7.5" r="3.2" fill="${c}"/><rect x="25" y="2.5" width="2" height="10" fill="${c}"/>`, 'a life') +
    g(`<path d="M2 7 L7 2.5 L23 2.5 L28 7 L23 11.5 L7 11.5 Z" fill="${c}"/>`, 'territory') +
    g(`<rect x="2" y="1" width="26" height="12" fill="${c}" opacity=".22"/><rect x="2" y="6" width="26" height="2" fill="${c}"/>`, 'era') +
    `<span class="note" style="font-weight:600;margin-left:6px">Color = domain</span>`;
}
