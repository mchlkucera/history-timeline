/* eslint-disable @typescript-eslint/no-explicit-any */
// ================= ④ SPACE-TIME CUBE =================
// Ported from prototypes/partB.html. Only change: `cv` is resolved in init().
import {
  $, EVENTS, GEO, YEARS, catColor, clamp, fitCanvas, fmtY, fontMono, repaintOnFonts, sovColor, tokens,
} from './shared';

export const Cube = {
  cv: null as unknown as HTMLCanvasElement, az: -0.62, el: 0.52, zoom: 1, spin: null as any, fast: false,
  sov: 'Roman Empire', showEvents: true, showLand: true, H: 600, simp: null as any,
  years() { return YEARS; },
  simplify() {
    if (this.simp) return this.simp;
    const out: Record<number, any[]> = {};
    for (const y of YEARS) {
      out[y] = GEO[y].filter((f: any) => f.area > 7).map((f: any) => {
        const rings = f.rings.filter((r: any) => r.length >= 16).map((r: any) => {
          const n = r.length / 2, keep = Math.max(1, Math.ceil(n / 24)), pts: number[] = [];
          for (let i = 0; i < n; i += keep) pts.push(r[2 * i], r[2 * i + 1]);
          pts.push(r[0], r[1]);
          return pts;
        });
        return { sov: f.sov, name: f.name, rings: rings.filter((r: number[]) => r.length >= 8), lc: f.lc };
      }).filter((f: any) => f.rings.length);
    }
    return this.simp = out;
  },
  zOf(year: number) {
    const Y = YEARS;
    if (year <= Y[0]) return 0; if (year >= Y[Y.length - 1]) return 1;
    for (let i = 1; i < Y.length; i++) if (year <= Y[i]) {
      return (i - 1 + (year - Y[i - 1]) / (Y[i] - Y[i - 1])) / (Y.length - 1);
    }
    return 1;
  },
  proj(lon: number, lat: number, z: number, S: number, cx: number, cy: number) {
    const X = lon / 180, Y = lat / 90 * 0.52, Z = (z - 0.5) * 1.15;
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const rx = X * ca - Y * sa, ry = X * sa + Y * ca;
    const se = Math.sin(this.el), ce = Math.cos(this.el);
    return [cx + rx * S, cy - (ry * se + Z * ce) * S];
  },
  render() {
    if (!this.cv) return;
    const d = fitCanvas(this.cv, this.H); if (!d) return;
    const { cw, ctx } = d; const T = tokens(); const H = this.H;
    const traceCol = sovColor(this.sov);       // the traced empire's colour, shared with the caption
    ctx.fillStyle = T.panel; ctx.fillRect(0, 0, cw, H);
    const S = Math.min(cw, H) * 0.42 * this.zoom, cx = cw / 2, cy = H / 2;
    const SIM = this.simplify();
    const Y = YEARS, n = Y.length;
    // box wireframe (back edges first)
    const corners = [[-180, -60], [180, -60], [180, 85], [-180, 85]];
    ctx.lineWidth = 1; ctx.strokeStyle = T.line; ctx.globalAlpha = .5;
    for (const zz of [0, 1]) {
      ctx.beginPath();
      corners.forEach((c, i) => { const p = this.proj(c[0], c[1], zz, S, cx, cy); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath(); ctx.stroke();
    }
    ctx.beginPath();
    for (const c of corners) {
      const a = this.proj(c[0], c[1], 0, S, cx, cy), b = this.proj(c[0], c[1], 1, S, cx, cy);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // slices, oldest first
    const stepSlice = this.fast ? 2 : 1;
    const traced: number[][] = [];
    for (let i = 0; i < n; i += stepSlice) {
      const yr = Y[i], z = i / (n - 1);
      const feats = SIM[yr];
      if (this.showLand) {
        ctx.globalAlpha = .19; ctx.fillStyle = T.ink3;
        for (const f of feats) {
          ctx.beginPath();
          for (const r of f.rings) {
            for (let k = 0; k < r.length; k += 2) {
              const p = this.proj(r[k], r[k + 1], z, S, cx, cy);
              k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
            }
            ctx.closePath();
          }
          ctx.fill();
        }
      }
      // traced sovereign. NOT the accent: minium is reserved for "where you are", and this
      // is the largest saturated shape on the canvas — it is data. It takes the very colour
      // the world map paints this sovereign in, so tab ① and tab ④ agree about who is who.
      const mine = feats.filter((f: any) => f.sov === this.sov);
      if (mine.length) {
        ctx.globalAlpha = .85; ctx.fillStyle = traceCol; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.4;
        let sx = 0, sy = 0, cnt = 0;
        for (const f of mine) {
          ctx.beginPath();
          for (const r of f.rings) {
            for (let k = 0; k < r.length; k += 2) {
              const p = this.proj(r[k], r[k + 1], z, S, cx, cy);
              k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
            }
            ctx.closePath();
          }
          ctx.fill(); ctx.stroke();
          if (f.lc) { const p = this.proj(f.lc[0], f.lc[1], z, S, cx, cy); sx += p[0]; sy += p[1]; cnt++; }
        }
        if (cnt) traced.push([sx / cnt, sy / cnt, yr]);
        ctx.globalAlpha = 1;
      }
      // year label on the left rear edge
      if (!this.fast) {
        const p = this.proj(-180, 85, z, S, cx, cy);
        ctx.fillStyle = T.ink3; ctx.font = fontMono(10); ctx.textAlign = 'right';   // a year is a measurement
        ctx.fillText(fmtY(yr), p[0] - 6, p[1] + 3); ctx.textAlign = 'left';
      }
    }
    // the world line of the traced empire
    if (traced.length > 1) {
      ctx.strokeStyle = T.ink; ctx.lineWidth = 2; ctx.globalAlpha = .85;
      ctx.beginPath(); traced.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // events floating in the block
    if (this.showEvents && !this.fast) {
      for (const ev of EVENTS) {
        const pl = ev[8]; if (!pl) continue; if (ev[0] < -3000 || ev[0] > 2026) continue; if (ev[4] > 3) continue;
        const col = catColor(ev[6], T);
        const p = this.proj(pl[1], pl[0], this.zOf(ev[0]), S, cx, cy);
        if (ev[7] === 'life' && ev[1]) {
          // a human life is literally a world line through the block: birth to death
          const q = this.proj(pl[1], pl[0], this.zOf(ev[1]), S, cx, cy);
          ctx.strokeStyle = col; ctx.globalAlpha = .8; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
          ctx.fillStyle = col; ctx.globalAlpha = .95;
          ctx.beginPath(); ctx.arc(p[0], p[1], 2.8, 0, 7); ctx.fill();
          continue;
        }
        ctx.fillStyle = col; ctx.globalAlpha = pl[3] === 'region' ? .5 : .9;
        ctx.beginPath(); ctx.arc(p[0], p[1], ev[4] <= 2 ? 3.4 : 2.2, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    $('#cubeCap')!.innerHTML = `<b>Reading the block:</b> each sheet is a world map at one date, oldest at the bottom — ` +
      // A SWATCH quotes the trace colour and the name stays in ink. Colouring the text
      // itself would put a mid-tone data hue on a panel surface, which fails contrast in
      // the dark theme — and globals.css is explicit that a dot is the only place the data
      // hues are allowed to cross into the chrome.
      `<span style="white-space:nowrap"><span aria-hidden="true" style="display:inline-block;width:8px;height:8px;` +
      `border-radius:999px;background:${traceCol};vertical-align:baseline"></span> <b>${this.sov}</b></span>` +
      ` is lit through every sheet it occupies, and the line threads its centre of gravity through time. ` +
      `Dots are events at their real coordinates; a horizontal cut through here is tab ①, a vertical drill is tab ⑤.`;
  },
  init() {
    const cv = this.cv = $<HTMLCanvasElement>('#cubeCanvas')!;
    const sovs: Record<string, number> = {}, spanOf: Record<string, number> = {};
    for (const y of YEARS) {
      const here = new Set<string>();
      for (const f of GEO[y]) if (f.sov && f.sov !== '?') { sovs[f.sov] = (sovs[f.sov] || 0) + f.area; here.add(f.sov); }
      for (const s of here) spanOf[s] = (spanOf[s] || 0) + 1;
    }
    const list = Object.entries(sovs).sort((a, b) => b[1] - a[1]).slice(0, 70).map(e => e[0]).sort();
    const sel = $<HTMLSelectElement>('#cubeSov')!;
    for (const s of list) {
      const o = document.createElement('option'); o.value = s;
      o.textContent = `${s} — ${spanOf[s] || 0} of ${YEARS.length} sheets`; sel.appendChild(o);
    }
    // default to a recognisable empire that threads many sheets — the clearest column in the block
    const WANT = [/^Ottoman/, /^Russian Empire/, /^Roman Empire/, /^France$/, /^Qing/, /^Spain$/, /^Persia/];
    let pref: string | null = null;
    for (const re of WANT) { const hit = list.find(s => re.test(s)); if (hit && (spanOf[hit] || 0) >= 3) { pref = hit; break; } }
    if (!pref) pref = list.slice()
      .filter(s => !/hunter|gatherer|aboriginal|tribes|peoples|nomads|cultures/i.test(s))
      .sort((a, b) => (spanOf[b] || 0) - (spanOf[a] || 0) || sovs[b] - sovs[a])[0] || list[0];
    sel.value = pref; this.sov = pref;
    sel.addEventListener('change', () => { this.sov = sel.value; this.render(); });
    $<HTMLInputElement>('#cubeEvents')!.addEventListener('change', (e: any) => { this.showEvents = e.target.checked; this.render(); });
    $<HTMLInputElement>('#cubeLand')!.addEventListener('change', (e: any) => { this.showLand = e.target.checked; this.render(); });
    $('#cubeTop')!.addEventListener('click', () => { this.el = 1.45; this.render(); });
    $('#cubeSide')!.addEventListener('click', () => { this.el = 0.10; this.render(); });
    $('#cubeIso')!.addEventListener('click', () => { this.az = -0.62; this.el = 0.52; this.zoom = 1; this.render(); });
    // A toggle, so the state lives in aria-pressed and not in a ▶/⏸ glyph that no screen
    // reader announces and that reads as a second icon language beside the shell's own.
    // Same contract as map.ts #btnPlay and population.ts #popPlay: write the label only
    // while the button is a text button.
    const spinBtn = $<HTMLButtonElement>('#cubeSpin')!;
    const setSpin = (on: boolean) => {
      spinBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      spinBtn.setAttribute('aria-label', on ? 'Stop rotating the block' : 'Rotate the block');
      if (!spinBtn.firstElementChild) spinBtn.textContent = on ? 'Stop' : 'Spin';
    };
    setSpin(false);
    spinBtn.addEventListener('click', () => {
      if (this.spin) { cancelAnimationFrame(this.spin); this.spin = null; setSpin(false); return; }
      setSpin(true);
      const loop = () => { this.az += 0.006; this.render(); this.spin = requestAnimationFrame(loop); };
      this.spin = requestAnimationFrame(loop);
    });
    repaintOnFonts(() => this.render());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.pow(1.0015, -e.deltaY), 0.5, 4); this.render();
    }, { passive: false });
    let drag: any = null;
    cv.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, az: this.az, el: this.el };
      this.fast = true; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this.az = drag.az + (e.clientX - drag.x) * 0.008;
      this.el = clamp(drag.el - (e.clientY - drag.y) * 0.006, 0.06, 1.5);
      this.render();
    });
    const end = () => { if (drag) { drag = null; this.fast = false; this.render(); } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointerleave', end);
  },
};
