/* =============================================================================
   techmap — app.js

   One canvas, one scrubber, four diffusions. Everything drawn here comes out of
   window.TM, which build-data.py froze from the corpus (the atlas, the places,
   the spreads) plus the four hand-authored diffusions.

   THREE VISUAL CHANNELS, KEPT APART ON PURPOSE — this is the whole argument of
   the prototype and it follows tokens.css rather than inventing anything:

     HUE    = which domain the diffusion belongs to. One of the corpus's eight
              --tl-cat-* data hues, chosen by the diffusion's `cat`. Never the
              chrome accent, never per-hop.
     DASH   = how sure we are. tokens.css says confidence is encoded by FORM,
              never by hue, and it ships the patterns: --tl-dash-contest for a
              route we cannot document, a dotted ring for a date we cannot fix.
     GLYPH  = the carrier — trade, conquest, migration, print, institution, copy.
              A small mark at the middle of the arc. This channel had to be
              invented because the other two were already spoken for, and it is
              the honest answer to "via as line style, not colour".

   The one accent on the page is the rail index: --tl-accent means WHERE YOU ARE
   IN TIME and it is spent on the index line, its flag, and focus. Nothing on the
   map is ever drawn in it.
   ============================================================================= */
(function () {
  'use strict';
  var TM = window.TM;
  if (!TM) { console.error('[techmap] data.js did not load'); return; }

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  /* ── THEME ────────────────────────────────────────────────────────────────
     Three states, exactly as tokens.css defines them: no stamp (follow the OS),
     [data-theme="light"], [data-theme="dark"]. */
  var themeBtns = document.querySelectorAll('.tm-theme button');
  Array.prototype.forEach.call(themeBtns, function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-theme');
      if (v === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', v);
      Array.prototype.forEach.call(themeBtns, function (o) {
        o.setAttribute('aria-pressed', String(o === b));
      });
      T = null; draw();
    });
  });

  /* ── TOKENS ON THE CANVAS ─────────────────────────────────────────────────
     A canvas has no cascade, so every colour is read out of the document once
     per repaint-after-theme-change and cached. Same doctrine as the app's
     render/shared.ts tokens(). */
  var T = null;
  function tok() {
    if (T) return T;
    var cs = getComputedStyle(document.documentElement);
    var g = function (n) { return cs.getPropertyValue(n).trim(); };
    T = {
      sea: g('--tl-sea'), land: g('--tl-land'), coast: g('--tl-coast'),
      ink: g('--tl-ink'), ink2: g('--tl-ink-2'), ink3: g('--tl-ink-3'),
      surface: g('--tl-surface'), rule: g('--tl-rule'), ruleSoft: g('--tl-rule-soft'),
      grat: g('--tl-graticule'), accent: g('--tl-accent'),
      cat: {
        power: g('--tl-cat-power'), war: g('--tl-cat-war'), belief: g('--tl-cat-belief'),
        sci: g('--tl-cat-sci'), art: g('--tl-cat-art'), nature: g('--tl-cat-nature'),
        society: g('--tl-cat-society'), reach: g('--tl-cat-reach')
      },
      fontUI: g('--tl-font-ui') || 'sans-serif',
      fontMono: g('--tl-font-mono') || 'monospace'
    };
    return T;
  }
  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { T = null; draw(); });

  /* ── THE ATLAS ────────────────────────────────────────────────────────────
     decodeSnapshot(), lifted from web/src/render/shared.ts: decimetre-degrees,
     delta-encoded, into absolute degrees. build-data.py simplified the rings and
     re-encoded them in this same format, so the prototype and the app read the
     atlas the same way. */
  var GEO = {};
  function geo(year) {
    if (GEO[year]) return GEO[year];
    var raw = TM.world[year] || TM.world[String(year)];
    if (!raw) return [];
    var out = raw.map(function (d) {
      var r = new Float64Array(d.length);
      var x = d[0], y = d[1];
      r[0] = x / 10; r[1] = y / 10;
      for (var i = 2; i < d.length; i += 2) { x += d[i]; y += d[i + 1]; r[i] = x / 10; r[i + 1] = y / 10; }
      return r;
    });
    return (GEO[year] = out);
  }
  function snapshotFor(year) {
    var ys = TM.snapshots, best = ys[0], bd = Infinity;
    for (var i = 0; i < ys.length; i++) {
      var d = Math.abs(ys[i] - year);
      if (d < bd) { bd = d; best = ys[i]; }
    }
    return best;
  }

  /* ── PROJECTION — the app's own, MW/MH/px/py from render/map.ts ──────────── */
  var MW = 1000, MH = 403;
  function lon2u(lon) { return (lon + 180) / 360 * MW; }
  function lat2v(lat) { return (85 - lat) / 145 * MH; }
  var FIT = { k: 1, dx: 0, dy: 0 };
  function X(lon) { return FIT.dx + lon2u(lon) * FIT.k; }
  function Y(lat) { return FIT.dy + lat2v(lat) * FIT.k; }

  /* ── STATE ────────────────────────────────────────────────────────────────
     `year` is fractional so the scrubber and the play head move smoothly; every
     comparison against a hop is against the floor of it. */
  var S = { d: TM.diffusions[0], year: 0, playing: false, hover: null, focus: null };
  var PL = TM.places;
  function place(id) { return PL[id]; }

  /* Every mark the current diffusion can draw, in one flat list, sorted by
     year — the origin, the precursors and the hops together. `arcFrom` is
     resolved to the parent's OWN arrival year, which is what makes an arc
     complete over time instead of appearing whole. */
  function marks(d) {
    var out = [], first = {};
    function note(id, y) { if (first[id] == null || y < first[id]) first[id] = y; }
    (d.precursors || []).forEach(function (p, i) {
      out.push({ kind: 'pre', id: 'pre' + i, place: p.place, year: p.year, note: p.note });
    });
    out.push({ kind: 'origin', id: 'origin', place: d.origin.place, year: d.origin.year,
               note: d.origin.note, contested: !!d.origin.contested });
    note(d.origin.place, d.origin.year);
    d.hops.forEach(function (h, i) {
      var m = { kind: 'hop', id: 'h' + i, place: h.place, year: h.year, note: h.note,
                via: h.via, from: h.from, contested: !!h.contested, route: !!h.route, fate: h.fate };
      if (h.from) {
        var py = first[h.from];
        m.fromYear = (py == null || py > h.year) ? h.year : py;
      }
      out.push(m);
      note(h.place, h.year);
    });
    out.sort(function (a, b) { return a.year - b.year; });
    return out;
  }
  var MARKS = null;
  function curMarks() { return MARKS || (MARKS = marks(S.d)); }

  function hue() { return tok().cat[S.d.cat] || tok().ink2; }
  function span() { return S.d.span; }
  function yearToPct(y) { var s = span(); return (y - s[0]) / (s[1] - s[0]); }
  function pctToYear(p) { var s = span(); return s[0] + p * (s[1] - s[0]); }

  /* ── GLYPHS — the `via` channel ───────────────────────────────────────────
     Six forms, drawn at the middle of the arc in the diffusion's own hue. Form,
     not colour and not dash, because the other two channels are taken. */
  var VIA_LABEL = {
    trade: 'trade', conquest: 'conquest', migration: 'migration',
    print: 'a document', institution: 'an institution', copy: 'copied / smuggled'
  };
  function glyph(ctx, kind, x, y, a, r, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 1.2; ctx.setLineDash([]); ctx.lineJoin = 'miter';
    ctx.beginPath();
    if (kind === 'trade') {              // open diamond
      ctx.moveTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.lineTo(0, -r); ctx.closePath(); ctx.stroke();
    } else if (kind === 'conquest') {    // filled arrowhead, along the path
      ctx.moveTo(r * 1.3, 0); ctx.lineTo(-r * 0.9, r * 0.85); ctx.lineTo(-r * 0.9, -r * 0.85); ctx.closePath(); ctx.fill();
    } else if (kind === 'migration') {   // open circle
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === 'print') {       // filled square
      ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); ctx.fill();
    } else if (kind === 'institution') { // a perpendicular bar
      ctx.moveTo(0, -r * 1.2); ctx.lineTo(0, r * 1.2); ctx.lineWidth = 1.6; ctx.stroke();
    } else if (kind === 'copy') {        // a cross
      ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(-r, r); ctx.lineTo(r, -r); ctx.stroke();
    } else {                             // no carrier named
      ctx.arc(0, 0, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  /* the same six, as inline SVG, for the legend and the reader rows */
  function glyphSvg(kind) {
    var p = {
      trade: '<path d="M13 3 18 7 13 11 8 7Z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
      conquest: '<path d="M17 7 8 11.5V2.5Z" fill="currentColor"/>',
      migration: '<circle cx="13" cy="7" r="3.4" fill="none" stroke="currentColor" stroke-width="1.2"/>',
      print: '<rect x="10" y="4" width="6" height="6" fill="currentColor"/>',
      institution: '<path d="M13 2.2v9.6" stroke="currentColor" stroke-width="1.8"/>',
      copy: '<path d="M10 4l6 6M16 4l-6 6" stroke="currentColor" stroke-width="1.3"/>'
    }[kind] || '';
    return '<svg viewBox="0 0 26 14" aria-hidden="true" focusable="false">'
      + '<path d="M0 7h26" stroke="currentColor" stroke-width="1.1" opacity=".55"/>' + p + '</svg>';
  }

  /* ── DRAW ─────────────────────────────────────────────────────────────────── */
  var cv = $('tmCanvas'), ctx = cv.getContext('2d');
  var HITS = [];

  function fitCanvas(c) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, g: g };
  }

  /* split a quadratic bezier at t and return the first piece — this is how an
     arc "completes as time passes" rather than popping into existence. */
  function qsplit(p0, c0, p1, t) {
    var a = [p0[0] + (c0[0] - p0[0]) * t, p0[1] + (c0[1] - p0[1]) * t];
    var b = [c0[0] + (p1[0] - c0[0]) * t, c0[1] + (p1[1] - c0[1]) * t];
    var e = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { c: a, e: e };
  }
  function arcOf(m) {
    var A = place(m.from), B = place(m.place);
    if (!A || !B) return null;
    var p0 = [X(A.lon), Y(A.lat)], p1 = [X(B.lon), Y(B.lat)];
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var L = Math.hypot(dx, dy) || 1;
    var bow = Math.min(0.20, 26 / L + 0.10);
    var c = [(p0[0] + p1[0]) / 2 - dy / L * L * bow, (p0[1] + p1[1]) / 2 + dx / L * L * bow];
    return { p0: p0, p1: p1, c: c, L: L };
  }

  function draw() {
    var dim = fitCanvas(cv); if (!dim) return;
    var g = dim.g, W = dim.w, H = dim.h, K = tok(), C = hue();
    var yr = S.year, iyr = Math.floor(yr);

    var k = Math.min(W / MW, H / MH);
    FIT.k = k; FIT.dx = (W - MW * k) / 2; FIT.dy = (H - MH * k) / 2;

    g.clearRect(0, 0, W, H);
    g.fillStyle = K.sea; g.fillRect(0, 0, W, H);

    /* graticule — 30°, the same spacing the app draws */
    g.save(); g.strokeStyle = K.grat; g.lineWidth = 1; g.beginPath();
    for (var lo = -180; lo <= 180; lo += 30) { g.moveTo(X(lo), Y(85)); g.lineTo(X(lo), Y(-60)); }
    for (var la = -60; la <= 85; la += 30) { g.moveTo(X(-180), Y(la)); g.lineTo(X(180), Y(la)); }
    g.stroke(); g.restore();

    /* land — the atlas snapshot nearest the index year. Polities are GROUND
       here, not figure, so they are one flat land fill with a hairline edge. */
    var snap = snapshotFor(iyr), rings = geo(snap);
    g.save();
    g.beginPath();
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      g.moveTo(X(r[0]), Y(r[1]));
      for (var j = 2; j < r.length; j += 2) g.lineTo(X(r[j]), Y(r[j + 1]));
      g.closePath();
    }
    g.fillStyle = K.land; g.fill('nonzero');
    /* --tl-coast already carries its own alpha; do NOT stack globalAlpha on top
       of it — at 0.30 × 0.30 the world's outline disappears entirely and the
       stage reads as an empty grid, which is exactly how the first build looked. */
    g.strokeStyle = K.coast; g.lineWidth = 0.8; g.stroke();
    g.restore();

    /* ── the diffusion ── */
    var M = curMarks();
    HITS = [];
    var arrived = [];

    /* arcs first, so dots sit on top */
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (var a = 0; a < M.length; a++) {
      var m = M[a];
      if (m.kind !== 'hop' || !m.from) continue;
      var t0 = m.fromYear, t1 = m.year;
      if (yr < t0) continue;
      var p = (t1 <= t0) ? 1 : Math.min(1, (yr - t0) / (t1 - t0));
      if (p <= 0) continue;
      var A = arcOf(m); if (!A) continue;
      var done = p >= 1;
      var seg = done ? { c: A.c, e: A.p1 } : qsplit(A.p0, A.c, A.p1, p);
      g.strokeStyle = C;
      g.globalAlpha = done ? 0.62 : 0.85;
      g.lineWidth = done ? 1.35 : 1.9;
      g.setLineDash(m.route ? [1.5, 3.5] : []);
      g.beginPath(); g.moveTo(A.p0[0], A.p0[1]); g.quadraticCurveTo(seg.c[0], seg.c[1], seg.e[0], seg.e[1]); g.stroke();
      g.setLineDash([]);
      /* the leading end of an arc in flight gets a small head, so an
         in-progress transmission reads as motion and not as a short line */
      if (!done) { g.globalAlpha = 1; g.fillStyle = C; g.beginPath(); g.arc(seg.e[0], seg.e[1], 2.1, 0, 6.2832); g.fill(); }
      else {
        var mid = qsplit(A.p0, A.c, A.p1, 0.5);
        var nx = mid.e[0] - mid.c[0], ny = mid.e[1] - mid.c[1];
        g.globalAlpha = 0.9;
        glyph(g, m.via, mid.e[0], mid.e[1], Math.atan2(ny, nx), 3.6, C);
      }
    }
    g.restore();

    /* dots */
    for (var b = 0; b < M.length; b++) {
      var n = M[b];
      var P = place(n.place); if (!P) continue;
      var x = X(P.lon), y = Y(P.lat);
      var vis = n.kind === 'pre' ? (yr >= n.year) : (yr >= n.year);
      if (!vis) continue;
      arrived.push(n);
      HITS.push({ x: x, y: y, r: 11, m: n });
      var fresh = (yr - n.year) < 12 && n.kind !== 'pre';
      drawDot(g, n, x, y, C, K, fresh);
    }

    /* labels: the origin always, the four most recent arrivals, plus whatever
       is hovered or focused. Any more and the map stops being readable. */
    var lab = arrived.filter(function (m) { return m.kind === 'origin'; });
    var hops = arrived.filter(function (m) { return m.kind !== 'origin'; }).slice(-4);
    lab = lab.concat(hops);
    if (S.focus) { var f = arrived.filter(function (m) { return m.id === S.focus; }); lab = lab.concat(f); }
    if (S.hover) lab = lab.concat(arrived.filter(function (m) { return m.id === S.hover; }));
    var done_ = {};
    lab.forEach(function (m) {
      if (done_[m.id]) return; done_[m.id] = 1;
      var P2 = place(m.place); if (!P2) return;
      label(g, K, P2.name, m.year, X(P2.lon), Y(P2.lat), W, H, m.id === S.hover || m.id === S.focus);
    });

    /* the terminal sentence — computing runs out of places before it runs out
       of time, and the map says so instead of inventing dots */
    if (S.d.id === 'computing' && iyr >= 1993) {
      g.save();
      /* left-aligned, not centred: the arrivals panel floats over the right of
         the stage and a centred line runs straight underneath it. */
      g.font = '500 12px ' + tok().fontUI;
      g.fillStyle = K.ink3; g.textAlign = 'left';
      g.fillText('after 1993 the next arrival is everywhere at once — this map stops here on purpose', 16, H - 14);
      g.restore();
    }

    paintRail(arrived, M);
    paintReader(arrived, M);
    paintSpark();
  }

  function drawDot(g, m, x, y, C, K, fresh) {
    g.save();
    if (fresh) {  /* a short-lived ring, so a new arrival is visible while scrubbing */
      g.globalAlpha = 0.30 * (1 - (S.year - m.year) / 12);
      g.strokeStyle = C; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, 6 + (S.year - m.year) * 0.9, 0, 6.2832); g.stroke();
      g.globalAlpha = 1;
    }
    if (m.kind === 'pre') {
      g.strokeStyle = K.ink3; g.lineWidth = 1.1; g.setLineDash([1.5, 2]);
      g.beginPath(); g.arc(x, y, 3.6, 0, 6.2832); g.stroke(); g.setLineDash([]);
      g.restore(); return;
    }
    /* a halo in the sea colour so a dot never dissolves into a border */
    g.fillStyle = K.sea; g.globalAlpha = 0.55;
    g.beginPath(); g.arc(x, y, 6.4, 0, 6.2832); g.fill(); g.globalAlpha = 1;

    if (m.contested) {                       /* the date is argued about */
      g.strokeStyle = C; g.lineWidth = 1.6; g.setLineDash([1, 2.4]);
      g.beginPath(); g.arc(x, y, 4.2, 0, 6.2832); g.stroke(); g.setLineDash([]);
    } else {
      g.fillStyle = C;
      g.beginPath(); g.arc(x, y, m.kind === 'origin' ? 4.6 : 3.6, 0, 6.2832); g.fill();
    }
    if (m.kind === 'origin') {                /* the origin wears a second ring */
      g.strokeStyle = C; g.lineWidth = 1.2; g.globalAlpha = 0.75;
      g.beginPath(); g.arc(x, y, 8, 0, 6.2832); g.stroke(); g.globalAlpha = 1;
    }
    if (m.fate === 'faded') {                 /* it arrived, it ran, it stopped */
      g.strokeStyle = K.surface; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(x - 5.4, y); g.lineTo(x + 5.4, y); g.stroke();
      g.strokeStyle = C; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x - 5.4, y); g.lineTo(x + 5.4, y); g.stroke();
    }
    if (!m.from && m.kind === 'hop') {        /* an arrival with no drawable parent */
      g.strokeStyle = C; g.globalAlpha = 0.5; g.lineWidth = 1; g.setLineDash([2, 2]);
      g.beginPath(); g.arc(x, y, 7.6, 0, 6.2832); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    g.restore();
  }

  function label(g, K, name, year, x, y, W, H, strong) {
    g.save();
    g.font = (strong ? '600 ' : '500 ') + '11px ' + tok().fontUI;
    var w1 = g.measureText(name).width;
    g.font = '400 10px ' + tok().fontMono;
    var w2 = g.measureText(String(year)).width;
    var w = w1 + 6 + w2, h = 14;
    var left = x + 10, top = y - h / 2;
    if (left + w + 6 > W) left = x - 10 - w;
    if (top < 2) top = 2; if (top + h > H - 2) top = H - h - 2;
    g.fillStyle = K.surface; g.globalAlpha = strong ? 0.94 : 0.80;
    g.beginPath();
    if (g.roundRect) g.roundRect(left - 4, top - 2, w + 8, h + 4, 3); else g.rect(left - 4, top - 2, w + 8, h + 4);
    g.fill(); g.globalAlpha = 1;
    if (strong) { g.strokeStyle = K.rule; g.lineWidth = 1; g.stroke(); }
    g.textBaseline = 'middle';
    g.fillStyle = K.ink; g.font = (strong ? '600 ' : '500 ') + '11px ' + tok().fontUI;
    g.fillText(name, left, top + h / 2);
    g.fillStyle = K.ink3; g.font = '400 10px ' + tok().fontMono;
    g.fillText(String(year), left + w1 + 6, top + h / 2);
    g.restore();
  }

  /* ── THE RAIL — the app's own .tl-timerail, driven from here ─────────────── */
  var elYear = $('tmYear'), elEra = $('tmEra'), elScale = $('tmScale'),
      elA = $('tmScaleA'), elB = $('tmScaleB'), elRange = $('tmRange'),
      elIndex = $('tmIndex'), elFlag = $('tmFlag'), elMarks = $('tmScaleMarks');

  function paintRail(arrived, M) {
    var s = span(), iyr = Math.floor(S.year);
    elYear.textContent = String(iyr);
    elEra.textContent = 'CE · ' + arrived.filter(function (m) { return m.kind !== 'pre'; }).length
      + ' of ' + M.filter(function (m) { return m.kind !== 'pre'; }).length + ' arrived';
    elA.textContent = String(s[0]); elB.textContent = String(s[1]);
    var pct = Math.max(0, Math.min(1, yearToPct(S.year)));
    elIndex.style.setProperty('--tl-index-pos', (pct * 100).toFixed(3) + '%');
    elIndex.setAttribute('data-flip', String(pct > 0.87));
    elFlag.textContent = String(iyr);
    if (document.activeElement !== elRange) elRange.value = String(Math.round(pct * 1000));
  }

  /* Every arrival is engraved into the scale as a tick, so the shape of the
     diffusion in TIME is readable without moving the scrubber at all. Ink, never
     accent: the accent is the index and only the index. */
  function buildScaleMarks() {
    elMarks.textContent = '';
    curMarks().forEach(function (m) {
      if (m.kind === 'pre') return;
      var t = el('i', 'tm-scale__mark');
      t.style.left = (Math.max(0, Math.min(1, yearToPct(m.year))) * 100).toFixed(3) + '%';
      t.setAttribute('data-y', String(m.year));
      elMarks.appendChild(t);
    });
  }
  function syncScaleMarks() {
    Array.prototype.forEach.call(elMarks.children, function (t) {
      t.setAttribute('data-on', String(+t.getAttribute('data-y') <= S.year));
    });
  }

  /* ── THE READER — every arrival to date, newest first ────────────────────── */
  var elReader = $('tmReaderBody'), elCount = $('tmReaderCount');
  function paintReader(arrived, M) {
    var hops = arrived.filter(function (m) { return m.kind !== 'pre'; });
    elCount.textContent = hops.length + ' / ' + M.filter(function (m) { return m.kind !== 'pre'; }).length;
    elReader.textContent = '';
    if (!hops.length) {
      elReader.appendChild(el('p', 'tm-empty', 'Nothing has arrived yet. Drag the scrubber, or press Play.'));
      return;
    }
    var wrap = el('div', 'tm-arr');
    wrap.style.setProperty('--tm-hue', 'var(--tl-cat-' + S.d.cat + ')');
    hops.slice().reverse().forEach(function (m) {
      var P = place(m.place);
      var row = el('button', 'tm-arr__row');
      row.type = 'button';
      row.setAttribute('aria-current', String(m.id === S.focus));
      row.appendChild(el('span', 'tm-arr__y', String(m.year)));
      var gl = el('span', 'tm-arr__g');
      gl.innerHTML = m.via ? glyphSvg(m.via) : '';
      row.appendChild(gl);
      var right = el('span', 'tm-arr__n');
      right.appendChild(document.createTextNode(P ? P.name : m.place));
      var tags = [];
      if (m.kind === 'origin') tags.push('origin');
      if (!m.from && m.kind === 'hop') tags.push('no parent');
      if (m.contested) tags.push('date contested');
      if (m.route) tags.push('route inferred');
      if (m.fate === 'faded') tags.push('lapsed');
      if (tags.length) {
        right.appendChild(document.createTextNode(' '));
        right.appendChild(el('span', 'tm-arr__tag', '· ' + tags.join(' · ')));
      }
      if (m.note) right.appendChild(el('span', 'tm-arr__note', m.note));
      row.appendChild(right);
      row.addEventListener('click', function () {
        S.focus = (S.focus === m.id) ? null : m.id;
        if (S.focus) setYear(m.year, true);
        else draw();
      });
      row.addEventListener('mouseenter', function () { S.hover = m.id; draw(); });
      row.addEventListener('mouseleave', function () { if (S.hover === m.id) { S.hover = null; draw(); } });
      wrap.appendChild(row);
    });
    elReader.appendChild(wrap);
  }

  /* ── THE LEGEND ──────────────────────────────────────────────────────────── */
  function paintLegend() {
    var b = $('tmLegendBody');
    b.textContent = '';
    b.style.setProperty('--tm-hue', 'var(--tl-cat-' + S.d.cat + ')');

    /* WHAT "ARRIVAL" MEANS, IN FULL, ON EVERY MAP. It is the single most
       load-bearing sentence in a diffusion and it cannot live only in the top
       rail, where it is ellipsised. Question 1 of the three below is exactly
       this field, so the prototype has to show it being answered. */
    var k0 = el('div', 'tm-key');
    k0.appendChild(el('div', 'tm-key__hd', 'What counts as arrival'));
    k0.appendChild(el('p', 'tm-claim', S.d.claim));
    k0.appendChild(el('p', 'tm-arr__note', 'Unit: ' + S.d.unit));
    b.appendChild(k0);

    var k1 = el('div', 'tm-key');
    k1.appendChild(el('div', 'tm-key__hd', 'Carrier — the glyph'));
    TM.via.forEach(function (v) {
      var row = el('div', 'tm-key__row');
      var g = el('span', 'tm-key__g'); g.innerHTML = glyphSvg(v); row.appendChild(g);
      row.appendChild(el('span', null, VIA_LABEL[v] || v));
      k1.appendChild(row);
    });
    b.appendChild(k1);

    var k2 = el('div', 'tm-key');
    k2.appendChild(el('div', 'tm-key__hd', 'Confidence — the form'));
    [['solid', 'date attested'],
     ['dots', 'date contested'],
     ['dash', 'route inferred'],
     ['ring', 'no parent — deliberate'],
     ['strike', 'arrived, then lapsed']].forEach(function (p) {
      var row = el('div', 'tm-key__row');
      var g = el('span', 'tm-key__g'); g.innerHTML = confSvg(p[0]); row.appendChild(g);
      row.appendChild(el('span', null, p[1]));
      k2.appendChild(row);
    });
    b.appendChild(k2);

    var k3 = el('div', 'tm-key');
    k3.appendChild(el('div', 'tm-key__hd', 'Colour — the domain'));
    var row3 = el('div', 'tm-key__row');
    var g3 = el('span', 'tm-key__g');
    g3.innerHTML = '<svg viewBox="0 0 26 14" aria-hidden="true"><circle cx="13" cy="7" r="4" fill="currentColor"/></svg>';
    row3.appendChild(g3);
    row3.appendChild(el('span', null, S.d.cat + ' — one of the corpus’s eight'));
    k3.appendChild(row3);
    k3.appendChild(el('p', 'tm-arr__note', 'Never the index red: that hue means where you are in time and nothing else.'));
    b.appendChild(k3);
  }
  function confSvg(kind) {
    var s = '<svg viewBox="0 0 26 14" aria-hidden="true" focusable="false">';
    if (kind === 'solid')  s += '<circle cx="13" cy="7" r="3.6" fill="currentColor"/>';
    if (kind === 'dots')   s += '<circle cx="13" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1 2.4"/>';
    if (kind === 'dash')   s += '<path d="M1 10C7 1 19 1 25 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="1.5 3.5"/>';
    if (kind === 'ring')   s += '<circle cx="13" cy="7" r="3.4" fill="currentColor"/><circle cx="13" cy="7" r="6.2" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity=".6"/>';
    if (kind === 'strike') s += '<circle cx="13" cy="7" r="3.6" fill="currentColor"/><path d="M7.6 7h10.8" stroke="currentColor" stroke-width="1.1"/>';
    return s + '</svg>';
  }

  /* ── THE CORPUS'S OWN ANSWER, on the same axis ───────────────────────────── */
  var spark = $('tmSpark'), elCorpusMeta = $('tmCorpusMeta');
  function paintSpark() {
    var dim = fitCanvas(spark); if (!dim) return;
    var g = dim.g, W = dim.w, H = dim.h, K = tok();
    g.clearRect(0, 0, W, H);
    var C = TM.corpus[S.d.id];
    if (!C || !C.weight.length) { elCorpusMeta.textContent = 'no matching spread'; return; }
    var s = span(), pad = 7;
    var x = function (y) { return ((y - s[0]) / (s[1] - s[0])) * W; };
    var maxw = C.weight.reduce(function (a, p) { return Math.max(a, p[1]); }, 0) || 1;
    var yv = function (w) { return H - pad - (w / maxw) * (H - pad * 2); };
    g.save();
    g.beginPath();
    g.moveTo(x(C.weight[0][0]), H);
    C.weight.forEach(function (p) { g.lineTo(x(p[0]), yv(p[1])); });
    g.lineTo(x(C.weight[C.weight.length - 1][0]), H);
    g.closePath();
    g.fillStyle = K.ink3; g.globalAlpha = 0.16; g.fill(); g.globalAlpha = 1;
    g.beginPath();
    C.weight.forEach(function (p, i) { if (i) g.lineTo(x(p[0]), yv(p[1])); else g.moveTo(x(p[0]), yv(p[1])); });
    g.strokeStyle = K.ink3; g.lineWidth = 1.3; g.stroke();
    /* the index — the ONE accent mark on this strip */
    var ix = x(S.year);
    g.strokeStyle = K.accent; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ix, 0); g.lineTo(ix, H); g.stroke();
    g.restore();
    var gap = C.start - S.d.origin.year;
    elCorpusMeta.textContent = C.id + ' · weight ' + C.start + '–' + C.end + ' · ' + C.weight.length + ' points'
      + (gap > 0 ? '  ·  starts ' + gap + ' yrs after this map’s origin' : '');
  }

  /* ── INTERACTION ─────────────────────────────────────────────────────────── */
  function setYear(y, redraw) {
    var s = span();
    S.year = Math.max(s[0], Math.min(s[1], y));
    syncScaleMarks();
    if (redraw !== false) draw();
  }
  elRange.addEventListener('input', function () {
    stop();
    setYear(pctToYear(+elRange.value / 1000));
  });
  elScale.addEventListener('pointerdown', function (ev) {
    if (ev.target === elRange) return;
    var r = elScale.getBoundingClientRect();
    stop(); setYear(pctToYear((ev.clientX - r.left) / r.width));
  });

  var tip = $('tmTip');
  function hideTip() { tip.hidden = true; }
  cv.addEventListener('pointermove', function (ev) {
    var r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    var best = null, bd = 14;
    for (var i = HITS.length - 1; i >= 0; i--) {
      var d = Math.hypot(HITS[i].x - px, HITS[i].y - py);
      if (d < bd) { bd = d; best = HITS[i]; }
    }
    var id = best ? best.m.id : null;
    if (id !== S.hover) { S.hover = id; draw(); }
    if (!best) { hideTip(); cv.style.cursor = 'default'; return; }
    cv.style.cursor = 'pointer';
    var m = best.m, P = place(m.place);
    tip.textContent = '';
    tip.appendChild(el('div', 'tm-tip__t', P ? P.name : m.place));
    var bits = [String(m.year)];
    if (m.kind === 'origin') bits.push('origin');
    if (m.kind === 'pre') bits.push('precursor — before the origin');
    if (m.via) bits.push('via ' + (VIA_LABEL[m.via] || m.via));
    if (!m.from && m.kind === 'hop') bits.push('no parent drawn');
    if (m.contested) bits.push('date contested');
    if (m.route) bits.push('route inferred');
    if (m.fate === 'faded') bits.push('later lapsed');
    if (P) bits.push(P.src === 'corpus' ? 'place from corpus' : 'place hand-entered');
    tip.appendChild(el('div', 'tm-tip__m', bits.join(' · ')));
    if (m.note) tip.appendChild(el('div', 'tm-tip__s', m.note));
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var lx = best.x + 14, ly = best.y + 14;
    if (lx + tw > r.width - 8) lx = best.x - 14 - tw;
    if (ly + th > r.height - 8) ly = Math.max(8, best.y - 14 - th);
    tip.style.left = Math.max(8, lx) + 'px';
    tip.style.top = Math.max(8, ly) + 'px';
  });
  cv.addEventListener('pointerleave', function () { hideTip(); if (S.hover) { S.hover = null; draw(); } });
  cv.addEventListener('click', function () {
    if (!S.hover) { S.focus = null; draw(); return; }
    S.focus = (S.focus === S.hover) ? null : S.hover;
    draw();
  });

  /* ── TRANSPORT ───────────────────────────────────────────────────────────── */
  var btnPlay = $('tmPlay'), raf = 0, last = 0;
  function stop() { if (!S.playing) return; S.playing = false; btnPlay.textContent = '▶ Play'; cancelAnimationFrame(raf); }
  function play() {
    if (S.playing) { stop(); return; }
    var s = span();
    if (S.year >= s[1] - 0.5) S.year = s[0];
    S.playing = true; btnPlay.textContent = '❚❚ Pause'; last = 0;
    var step = function (t) {
      if (!S.playing) return;
      if (!last) last = t;
      var dt = Math.min(64, t - last); last = t;
      var s2 = span();
      setYear(S.year + (s2[1] - s2[0]) / 14000 * dt);
      if (S.year >= s2[1]) { stop(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  btnPlay.addEventListener('click', play);
  $('tmEnd').addEventListener('click', function () { stop(); setYear(span()[1]); });
  $('tmLegendToggle').addEventListener('click', function () {
    var p = $('tmLegend'), on = p.getAttribute('data-collapsed') === 'true';
    p.setAttribute('data-collapsed', String(!on));
    this.setAttribute('aria-expanded', String(on));
    this.textContent = on ? '−' : '+';
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
    var kc = ev['key'], s = span(), step = ev.shiftKey ? 25 : 1;
    if (kc === 'ArrowLeft') { stop(); setYear(Math.floor(S.year) - step); ev.preventDefault(); }
    else if (kc === 'ArrowRight') { stop(); setYear(Math.floor(S.year) + step); ev.preventDefault(); }
    else if (kc === ' ') { play(); ev.preventDefault(); }
    else if (kc === 'Home') { stop(); setYear(s[0]); }
    else if (kc === 'End') { stop(); setYear(s[1]); }
  });

  /* ── TABS ────────────────────────────────────────────────────────────────── */
  function selectDiffusion(d) {
    stop();
    S.d = d; S.focus = null; S.hover = null; MARKS = null;
    Array.prototype.forEach.call($('tmTabs').children, function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-id') === d.id));
    });
    $('tmUnitLabel').textContent = d.claim;
    buildScaleMarks();
    paintLegend();
    /* open a third of the way in, so the first frame already has a picture */
    setYear(d.span[0] + (d.span[1] - d.span[0]) * 0.34);
    hideTip();
  }
  TM.diffusions.forEach(function (d) {
    var b = el('button', 'tl-switch__item', d.name);
    b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('data-id', d.id);
    b.setAttribute('aria-selected', 'false');
    var dot = el('span', 'tl-chip__dot');
    dot.style.setProperty('--tl-dot', 'var(--tl-cat-' + d.cat + ')');
    dot.style.opacity = '1';
    b.insertBefore(dot, b.firstChild);
    b.addEventListener('click', function () { selectDiffusion(d); });
    $('tmTabs').appendChild(b);
  });

  /* ── THE NUMBERS IN THE PROSE — read out of the build, never typed ───────── */
  (function stats() {
    var st = TM.stats, ids = Object.keys(st);
    var sum = function (f) { return ids.reduce(function (a, k) { return a + f(st[k]); }, 0); };
    $('tmStatHops').textContent = String(sum(function (v) { return v.hops; }));
    $('tmStatPlaces').textContent = String(TM.meta.placesUsed);
    $('tmStatCorpus').textContent = String(TM.meta.placesFromCorpus);
    $('tmStatProblems').textContent = String(TM.problems.length);
    var host = $('tmStrains');
    var cells = [
      ['no parent', sum(function (v) { return v.orphans; }),
       'hops with no <code>from</code>. Mainz 1450, Zuse 1941, Bletchley 1944, Bacon 1267 — each one a claim about independence, not a hole in the data.'],
      ['second arrivals', sum(function (v) { return v.revisits; }),
       'places that arrive more than once. Istanbul 1493 and 1727; Kaifeng 1044 and 1232; Manchester 1781 and 1822. Keying arrivals by place would lose all of them.'],
      ['contested', sum(function (v) { return v.contested + v.routed; }),
       'rows carrying a doubtful date or a doubtful road — roughly a fifth of the file, and the number would go up, not down, with a real historian on it.'],
      ['lapsed', sum(function (v) { return v.faded; }),
       'arrivals that later stopped. Nagasaki, Cairo, Moscow’s Print Yard, Müteferrika, Colossus. Nothing in the current model can express any of them.']
    ];
    cells.forEach(function (c) {
      var box = el('div', 'tm-stat');
      box.appendChild(el('span', 'tm-stat__n', String(c[1])));
      box.appendChild(el('span', 'tm-stat__k', c[0]));
      var d = el('span', 'tm-stat__d'); d.innerHTML = c[2];
      box.appendChild(d);
      host.appendChild(box);
    });
  })();

  /* ── BOOT ────────────────────────────────────────────────────────────────── */
  var ro = window.ResizeObserver ? new ResizeObserver(function () { draw(); }) : null;
  if (ro) { ro.observe(cv); ro.observe(spark); }
  else window.addEventListener('resize', draw);
  selectDiffusion(TM.diffusions[0]);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(); });
})();
