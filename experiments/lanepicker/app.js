/* =============================================================================
   lanepicker — app.js

   Six specimens: three arrangements × two subjects, all from window.LP, which
   build-data.py froze out of the real corpus. Nothing here invents a lane, a
   count, a neighbour or a link. If a list would be empty, the specimen says so.

   The card markup follows design/selcard/SELCARD.md §6 exactly, with ONE new
   block inserted between the head and the destinations — the lane offer. That
   position is the argument: the offer answers "is this thing even here", which
   is an identity question, and it must be settled before "show this in" can
   mean anything. (For Daoism the TIMELINE cell is drawn shut, which is what
   the shipped card already does for a subject no lane can draw.)
   ============================================================================= */
(function () {
  'use strict';
  var LP = window.LP;
  /* WHAT TO CALL AN ID. The same job relDir does in relations.ts: the link
     table is pure strings, and the directory is built from the corpus. */
  LP.nameOf = function (id) {
    if (LP.names[id]) return LP.names[id];
    var i = id.indexOf(':');
    return i < 0 ? id : id.slice(i + 1);
  };

  // ── small helpers ─────────────────────────────────────────────────────────
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function svgClose() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
    s.appendChild(p);
    return s;
  }
  /* A YEAR IS A MEASUREMENT and negative years are not how anyone reads them. */
  function yr(v) {
    if (v == null) return '';
    if (v < 0) return Math.abs(v) + ' BC';
    return String(v);
  }
  function span(a, b) {
    if (b === LP.year || b >= 2026) return yr(a) + ' – present';
    return a === b ? yr(a) : yr(a) + ' – ' + yr(b);
  }

  /* ── THE CARD HEAD — SELCARD.md §6, unchanged ───────────────────────────── */
  function head(sub) {
    var h = el('div', 'tl-selcard__head');
    var top = el('div', 'tl-selcard__top');
    var meta = el('div', 'tl-selcard__meta');
    meta.style.setProperty('--tl-dot', 'var(--tl-cat-' + sub.cat + ')');
    meta.appendChild(el('span', 'tl-selcard__dot'));
    var b = el('b', null, sub.kindline.split(' · ')[0]);
    meta.appendChild(b);
    meta.appendChild(document.createTextNode(' · ' + sub.kindline.split(' · ').slice(1).join(' · ')));
    var x = el('button', 'tl-selcard__x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.title = 'Close  Esc';
    x.appendChild(svgClose());
    top.appendChild(meta); top.appendChild(x);
    h.appendChild(top);

    h.appendChild(el('h3', 'tl-selcard__name', sub.name));

    var sp = el('div', 'tl-selcard__span');
    sp.setAttribute('data-kind', sub.start === sub.end ? 'moment' : 'span');
    var ends = el('div', 'tl-selcard__ends');
    ends.appendChild(el('b', null, span(sub.start, sub.end)));
    ends.appendChild(el('span', null, String(LP.year)));
    sp.appendChild(ends);
    /* The presence slot stays as it ships: it speaks in two cases only
       (SELCARD.md §7.6), and neither of them is this. The offer block below
       carries the whole statement, once. */
    if (sub.presentLine) sp.appendChild(el('div', 'tl-selcard__present', sub.presentLine));
    h.appendChild(sp);

    if (sub.note) h.appendChild(el('p', 'tl-selcard__note', sub.note));
    return h;
  }

  /* ── THE DESTINATIONS — one cell, because map and cube need a polity ────── */
  function go(sub, added) {
    var g = el('div', 'tl-selcard__go');
    var lead = el('span', 'tl-selcard__lead', 'Show this in');
    var id = 'showin-' + Math.random().toString(36).slice(2, 8);
    lead.id = id;
    g.appendChild(lead);
    var row = el('div', 'tl-selcard__dests');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', id);
    var t = el('button', 'tl-selcard__dest', 'Timeline');
    t.type = 'button';
    var live = added || sub.onBoard;
    if (!live) {
      t.setAttribute('aria-disabled', 'true');
      t.title = sub.shutReason;
    } else {
      t.setAttribute('aria-current', 'true');
      t.title = 'Frame the timeline on ' + span(sub.start, sub.end);
    }
    row.appendChild(t);
    g.appendChild(row);
    return g;
  }

  /* ── CONNECTIONS — the real links, and the real emptiness ───────────────── */
  function rels(sub) {
    var r = el('div', 'tl-selcard__rels');
    var hd = el('div', 'tl-selcard__relshd');
    hd.appendChild(el('span', 'tl-selcard__section', 'Connections'));
    if (!sub.links.length) {
      r.setAttribute('data-empty', 'true');
      hd.appendChild(el('span', 'tl-selcard__none', 'None curated yet.'));
      r.appendChild(hd);
      return r;
    }
    var all = el('button', 'tl-selcard__all', 'All ' + sub.links.length + ' →');
    all.type = 'button';
    hd.appendChild(all);
    r.appendChild(hd);
    var ul = el('ul', 'tl-selcard__rellist');
    sub.links.slice(0, 4).forEach(function (l) {
      var li = el('li');
      var btn = el('button', 'tl-selcard__rel');
      btn.type = 'button';
      btn.appendChild(el('span', 'tl-selcard__rel-n', LP.nameOf(l.other)));
      btn.appendChild(el('span', 'tl-selcard__rel-k', l.kind));
      var bar = el('span', 'tl-selcard__bar');
      bar.style.setProperty('--sc-w', Math.round(l.w * 100) + '%');
      bar.setAttribute('aria-hidden', 'true');
      bar.appendChild(document.createElement('i'));
      btn.appendChild(bar);
      btn.appendChild(el('span', 'tl-selcard__sr', 'strength ' + l.w.toFixed(2)));
      li.appendChild(btn);
      ul.appendChild(li);
    });
    r.appendChild(ul);
    return r;
  }

  /* ═══ ONE CANDIDATE LANE ROW ═══════════════════════════════════════════════
     name · how many things · why it is a candidate · what else is in there.
     `mode` is 'radio' (B, C) or 'button' (A's menu).
     ═══════════════════════════════════════════════════════════════════════ */
  function laneRow(c, opts) {
    var lab = el('label', 'lp-lane');
    if (opts.isDefault) lab.setAttribute('data-default', 'true');
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = opts.group;
    input.value = c.id;
    input.checked = !!opts.checked;
    input.addEventListener('change', function () { opts.onPick(c.id); });
    lab.appendChild(input);

    lab.appendChild(el('span', 'lp-lane__n', c.name));
    lab.appendChild(el('span', 'lp-lane__ct', c.n + ' things'));
    if (opts.why !== false) lab.appendChild(el('span', 'lp-lane__why', c.whyShort));

    if (opts.near !== false && c.near.length) {
      var near = el('span', 'lp-lane__near');
      near.appendChild(document.createTextNode('beside '));
      c.near.slice(0, opts.nearN || 2).forEach(function (m, i) {
        if (i) near.appendChild(document.createTextNode(' · '));
        near.appendChild(el('i', null, m.name));
        var t = el('time', null, ' ' + yr(m.start));
        near.appendChild(t);
      });
      lab.appendChild(near);
    }
    return lab;
  }

  function mineRow(opts) {
    var lab = el('label', 'lp-lane lp-lane--mine');
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = opts.group;
    input.value = 'mine';
    input.checked = !!opts.checked;
    input.addEventListener('change', function () { opts.onPick('mine'); });
    lab.appendChild(input);
    lab.appendChild(el('span', 'lp-lane__n', '+  A lane of my own…'));
    lab.appendChild(el('span', 'lp-lane__ct', 'empty'));
    lab.appendChild(el('span', 'lp-lane__why',
      'Name it, and this is its first member. Sketch only — nothing behind it yet.'));
    return lab;
  }

  /* ═══ ARRANGEMENT A — ONE DEFAULT, ONE LINK ════════════════════════════════
     The card commits. It states the absence, names the lane it has picked, and
     puts the whole choice behind one quiet control. The common path is one
     click and the card does not grow.
     ═══════════════════════════════════════════════════════════════════════ */
  function offerA(sub, st, redraw) {
    var wrap = el('div', 'lp-offer');
    var def = sub.cands[st.pick] || sub.cands[0];

    wrap.appendChild(saying(sub));

    var row = el('div', 'lp-row');
    var add = el('button', 'lp-do', 'Add to “' + def.name + '”');
    add.type = 'button';
    add.addEventListener('click', function () { st.added = def.id; redraw(); });
    var more = el('button', 'lp-do lp-do--ghost lp-do--flex0',
      sub.cands.length > 2 ? (sub.cands.length - 1) + ' others'
        : sub.cands.length === 2 ? '1 other' : 'New lane…');
    more.type = 'button';
    more.setAttribute('aria-expanded', st.open ? 'true' : 'false');
    more.addEventListener('click', function () { st.open = !st.open; redraw(); });
    row.appendChild(add); row.appendChild(more);
    wrap.appendChild(row);

    /* WHAT THE DEFAULT COSTS YOU, in one mono line: the size of the lane and
       who it would sit next to. The reader who trusts the default never opens
       the menu, so this line is the only thing standing between them and a
       surprise. */
    var hint = el('div', 'lp-say');
    hint.appendChild(document.createTextNode(def.n + ' things · '));
    hint.appendChild(el('b', null, def.span ? span(def.span[0], def.span[1]) : '—'));
    if (def.near.length) hint.appendChild(document.createTextNode(' · beside ' + def.near[0].name));
    wrap.appendChild(hint);

    var menu = el('div', 'lp-menu');
    menu.hidden = !st.open;
    sub.cands.forEach(function (c, i) {
      menu.appendChild(laneRow(c, {
        group: st.group, checked: i === st.pick, isDefault: i === 0, nearN: 2,
        onPick: function () { st.pick = i; redraw(); },
      }));
    });
    menu.appendChild(mineRow({ group: st.group, onPick: function () { st.pick = -1; redraw(); } }));
    wrap.appendChild(menu);
    return wrap;
  }

  /* ═══ ARRANGEMENT B — THE LADDER ═══════════════════════════════════════════
     Every candidate on the card, ranked, each carrying its count, its reason
     and a glimpse of its contents. The default is pre-selected, so the common
     path is still one click — but the alternatives are read, not discovered.
     ═══════════════════════════════════════════════════════════════════════ */
  function offerB(sub, st, redraw) {
    var wrap = el('div', 'lp-offer');
    wrap.appendChild(saying(sub));

    var hd = el('div', 'lp-hd');
    hd.appendChild(el('span', 'tl-selcard__section', 'Add it to'));
    hd.appendChild(el('span', 'lp-hd__n', sub.cands.length + ' lanes'));
    wrap.appendChild(hd);

    var list = el('ul', 'lp-pick__list');
    sub.cands.forEach(function (c, i) {
      var li = el('li');
      li.appendChild(laneRow(c, {
        group: st.group, checked: i === st.pick, isDefault: i === 0, nearN: 2,
        onPick: function () { st.pick = i; redraw(); },
      }));
      list.appendChild(li);
    });
    var li2 = el('li');
    li2.appendChild(mineRow({
      group: st.group, checked: st.pick === -1,
      onPick: function () { st.pick = -1; redraw(); },
    }));
    list.appendChild(li2);
    wrap.appendChild(list);

    var chosen = st.pick === -1 ? null : sub.cands[st.pick];
    var add = el('button', 'lp-do lp-do--wide',
      chosen ? 'Add to “' + chosen.name + '”' : 'Name a new lane…');
    add.type = 'button';
    if (!chosen) add.className = 'lp-do lp-do--wide lp-do--ghost';
    add.addEventListener('click', function () {
      if (!chosen) return;
      st.added = chosen.id; redraw();
    });
    wrap.appendChild(add);
    return wrap;
  }

  /* ═══ ARRANGEMENT C — TWO AXES ═════════════════════════════════════════════
     The choice split the way the founder said it: "Mozart as part of Austria
     or Music". WHERE IT HAPPENED is the derived region × domain axis; WHAT IT
     IS ABOUT is the curated thematic one; MINE is the third, future axis. An
     axis with nothing in it says so, in the column where the answer would have
     been — which is the whole reason this arrangement exists.
     ═══════════════════════════════════════════════════════════════════════ */
  function offerC(sub, st, redraw) {
    var wrap = el('div', 'lp-offer');
    wrap.appendChild(saying(sub));

    var groups = [
      { t: 'Where it happened', sub: 'region × domain', list: sub.cands.filter(function (c) { return c.axis === 'derived'; }) },
      { t: 'What it is about', sub: 'curated lanes', list: sub.cands.filter(function (c) { return c.axis === 'curated'; }) },
    ];
    groups.forEach(function (g) {
      var ax = el('div', 'lp-axis');
      var h = el('div', 'lp-axis__hd');
      h.appendChild(el('span', 'lp-axis__t', g.t));
      h.appendChild(el('span', 'lp-axis__sub', g.sub));
      ax.appendChild(h);
      if (!g.list.length) {
        var e = el('div', 'lp-empty');
        e.appendChild(el('b', null, 'Nothing. '));
        e.appendChild(document.createTextNode(sub.emptyAxis));
        ax.appendChild(e);
      } else {
        g.list.forEach(function (c) {
          var i = sub.cands.indexOf(c);
          ax.appendChild(laneRow(c, {
            group: st.group, checked: i === st.pick, isDefault: i === 0, nearN: 2,
            onPick: function () { st.pick = i; redraw(); },
          }));
        });
      }
      wrap.appendChild(ax);
    });

    var mine = el('div', 'lp-axis');
    var mh = el('div', 'lp-axis__hd');
    mh.appendChild(el('span', 'lp-axis__t', 'Mine'));
    mh.appendChild(el('span', 'lp-axis__sub', 'not built'));
    mine.appendChild(mh);
    mine.appendChild(mineRow({
      group: st.group, checked: st.pick === -1,
      onPick: function () { st.pick = -1; redraw(); },
    }));
    wrap.appendChild(mine);

    var chosen = st.pick === -1 ? null : sub.cands[st.pick];
    var add = el('button', 'lp-do lp-do--wide' + (chosen ? '' : ' lp-do--ghost'),
      chosen ? 'Add to “' + chosen.name + '”' : 'Name a new lane…');
    add.type = 'button';
    add.addEventListener('click', function () { if (chosen) { st.added = chosen.id; redraw(); } });
    wrap.appendChild(add);
    return wrap;
  }


  /* ═══ ARRANGEMENT D — THE FOUNDER'S CUT ═══════════════════════════════════
     "We just have a list of views. […] The moment we have him open in Timeline
     […] we should see an expanded view to specify which lanes in the Timeline
     it is a part of. Just show their names, nothing else, no other
     explanations."

     So: the destination strip the card already ships IS the list of views, and
     the lane list hangs off it — only under Timeline, because a lane is a
     timeline concept. Names only. Two states, both borrowed from the strip
     itself: the inverted ink block for a lane on your board, the plain bordered
     cell for one you can press to add.

     THE RANKING RULE STILL GOVERNS THE ORDER and says nothing. Within each of
     the two states the names are in candidate rank; the added ones come first,
     because "which have I added" is the question the two states exist to
     answer and grouping answers it before the eye has to compare fills.
     ═══════════════════════════════════════════════════════════════════════ */
  var VIEWS = [
    { act: 'persp', label: 'Timeline', view: 'zoom' },
    { act: 'flow', label: 'Flow', view: 'flow' },
    { act: 'map', label: 'Map', view: 'map' },
    { act: 'cube', label: 'Cube', view: 'cube' },
  ];
  function shutReasonFor(act, sub) {
    if (act === 'flow') return sub.name + ' carries no weight curve, so the flow of empires draws no ribbon for it';
    if (act === 'map') return sub.name + ' holds no ground, so the atlas draws nothing for it';
    if (act === 'cube') return sub.name + ' holds no ground, so the cube traces nothing for it';
    return '';
  }

  function goD(sub, st, redraw) {
    var g = el('div', 'tl-selcard__go');
    var lead = el('span', 'tl-selcard__lead', 'Show this in');
    var id = 'showin-' + Math.random().toString(36).slice(2, 8);
    lead.id = id;
    g.appendChild(lead);

    var row = el('div', 'tl-selcard__dests');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', id);
    VIEWS.forEach(function (v) {
      var c = el('button', 'tl-selcard__dest', v.label);
      c.type = 'button';
      if (st.view === v.view) c.setAttribute('aria-current', 'true');
      /* Flow, Map and Cube need a polity — neither of these subjects has one —
         so they are drawn SHUT with the reason on them, which is the card's own
         idiom for a door that opens onto nothing. TIMELINE is live even for
         Daoism, and that is the model change made visible: once a lane is a
         choice, "there is no lane to add" stops being true. */
      if (v.act !== 'persp') {
        c.setAttribute('aria-disabled', 'true');
        c.title = shutReasonFor(v.act, sub);
      } else {
        c.title = 'Frame the timeline on ' + span(sub.start, sub.end);
      }
      row.appendChild(c);
    });
    g.appendChild(row);

    // ONLY UNDER TIMELINE. Lanes are a timeline concept; on Flow, Map or Cube
    // there is no lane list at all, and the strip closes back up.
    if (st.view !== 'zoom') return g;

    var box = el('div', 'lp-lanes');
    var on = sub.cands.filter(function (c) { return st.board.indexOf(c.id) >= 0; });
    var off = sub.cands.filter(function (c) { return st.board.indexOf(c.id) < 0; });
    on.concat(off).forEach(function (c) {
      var chip = el('button', 'lp-chip', c.name);
      chip.type = 'button';
      var isOn = st.board.indexOf(c.id) >= 0;
      if (isOn) {
        chip.setAttribute('data-on', 'true');
        chip.setAttribute('aria-pressed', 'true');
        chip.title = 'On your board';
      } else {
        chip.setAttribute('aria-pressed', 'false');
        chip.title = 'Add to your board';
        chip.addEventListener('click', function () {
          st.board.push(c.id); st.added = c.id; redraw();
        });
      }
      box.appendChild(chip);
    });
    var mine = el('button', 'lp-chip lp-chip--new', '+ New lane');
    mine.type = 'button';
    mine.title = 'Name a lane of your own — sketch only';
    box.appendChild(mine);
    g.appendChild(box);
    return g;
  }

  /* THE STATEMENT, shared by all three. It says what is true and nothing more:
     how many lanes hold this thing today, and out of how many there are. */
  function saying(sub) {
    var s = el('div', 'lp-say');
    s.appendChild(el('b', null, sub.sayHead));
    s.appendChild(document.createTextNode(' · ' + sub.sayTail));
    return s;
  }

  /* ── AFTER: the lane is on the board and the thing is in it ─────────────── */
  function done(sub, st, redraw) {
    var c = laneById(sub, st.added);
    var w = el('div', 'lp-done');
    var s = el('div', 'lp-say');
    s.appendChild(el('b', null, 'On the board'));
    s.appendChild(document.createTextNode(
      ' · in “' + c.name + '”, with ' + c.n + ' other things'));
    w.appendChild(s);
    if (c.near.length) {
      var near = el('div', 'lp-lane__near');
      near.appendChild(document.createTextNode('nearest in time: '));
      c.near.slice(0, 2).forEach(function (m, i) {
        if (i) near.appendChild(document.createTextNode(' · '));
        near.appendChild(el('i', null, m.name));
        near.appendChild(el('time', null, ' ' + yr(m.start)));
      });
      w.appendChild(near);
    }
    return w;
  }

  function laneById(sub, id) {
    for (var i = 0; i < sub.cands.length; i++) if (sub.cands[i].id === id) return sub.cands[i];
    return null;
  }

  /* ── the notice, with the Undo that puts all three pieces back ──────────── */
  function notice(sub, st, redraw) {
    var c = laneById(sub, st.added);
    var n = el('div', 'lp-notice');
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    var msg = el('span', 'lp-notice__msg');
    /* didLine() in Lab.tsx says `Added “Music”`. A lane-picker reveal does one
       more thing than a search reveal does — it also writes a MEMBERSHIP — so
       the line has to say both, or Undo is undoing something the reader was
       never told about. This is the one grammar change the notice needs. */
    msg.appendChild(document.createTextNode('Added '));
    msg.appendChild(el('b', null, '“' + c.name + '”'));
    msg.appendChild(document.createTextNode(' and put ' + sub.name + ' in it'));
    n.appendChild(msg);
    var undo = el('button', 'lp-notice__act', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', function () {
      if (st.board) {
        var i = st.board.indexOf(st.added);
        if (i >= 0) st.board.splice(i, 1);
      }
      st.added = null;
      redraw();
    });
    n.appendChild(undo);
    var x = el('button', 'lp-notice__x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.title = 'Dismiss';
    x.appendChild(svgClose());
    x.addEventListener('click', function () { n.remove(); });
    n.appendChild(x);
    return n;
  }

  /* ── one specimen: a stage, a card, a measurement, and maybe a notice ───── */
  var OFFERS = { a: offerA, b: offerB, c: offerC };
  /* Which lanes the reader has already put on their board, per specimen. Mozart
     carries Music so that "added" and "could add" are legible side by side. */
  var SEED = { 'd:mozart': ['mu'], 'd:daoism': [] };

  function specimen(host, arrangement, sub) {
    var st = {
      pick: 0, open: false, added: null, group: arrangement + '-' + sub.id,
      view: 'zoom',
      /* THE READER'S BOARD. Mozart starts with Music on it and everything else
         off, so the two states are on screen at the same time; Daoism starts
         with nothing, which is the founder's "a card that does not exist in any
         of your lanes yet". Both are demo states, and the stage says so. */
      board: (SEED[arrangement + ':' + sub.slug] || []).slice(),
    };
    var stage = el('div', 'lp-stage');
    var label = el('div', 'lp-stage__label');
    label.appendChild(el('span', null, sub.stageLabel));
    if (arrangement === 'd') {
      /* NOT part of the card — the card reports the view you are standing in,
         it does not switch it. This is the page's stand-in for the top rail, so
         the lane block can be watched opening and closing under Timeline. */
      var vwrap = el('span', 'lp-viewwrap');
      vwrap.appendChild(el('span', 'lp-viewwrap__t', 'active view'));
      var vsw = el('span', 'lp-view');
      vsw.setAttribute('role', 'group');
      vsw.setAttribute('aria-label', 'Active view');
      VIEWS.forEach(function (v) {
        var b = el('button', null, v.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', st.view === v.view ? 'true' : 'false');
        b.addEventListener('click', function () { st.view = v.view; redraw(); });
        vsw.appendChild(b);
      });
      vwrap.appendChild(vsw);
      label.appendChild(vwrap);
    }
    var slot = el('div');
    slot.style.width = '320px';
    slot.style.maxWidth = '100%';
    var measure = el('div', 'lp-measure');
    stage.appendChild(label);
    stage.appendChild(slot);
    stage.appendChild(measure);
    host.appendChild(stage);

    function redraw() {
      slot.textContent = '';
      var card = el('div', 'tl-selcard tl-selcard--flow');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', sub.name);
      card.appendChild(head(sub));
      if (arrangement === 'd') {
        /* No offer block, no confirmation block, no statement line. The list of
           views is the whole control, and the lane names are the whole answer. */
        if (st.view === 'zoom') card.className += ' lp-selcard--open';
        card.appendChild(goD(sub, st, redraw));
      } else {
        card.appendChild(st.added ? done(sub, st, redraw) : OFFERS[arrangement](sub, st, redraw));
        card.appendChild(go(sub, st.added));
      }
      card.appendChild(rels(sub));
      slot.appendChild(card);

      var sw = stage.querySelector('.lp-view');
      if (sw) sw.querySelectorAll('button').forEach(function (b, i) {
        b.setAttribute('aria-pressed', VIEWS[i].view === st.view ? 'true' : 'false');
      });
      var old = stage.querySelector('.lp-notice');
      if (old) old.remove();
      if (st.added) stage.appendChild(notice(sub, st, redraw));

      /* MEASURED, NOT ESTIMATED. Synchronously (getBoundingClientRect forces
         the layout), then again when the webfonts land, because a card set in
         the fallback stack is not the card. Deliberately NOT on rAF: a tab
         that is not being painted never runs one, and the line would be blank
         on first open. */
      function stamp() {
        var h = Math.round(card.getBoundingClientRect().height);
        measure.textContent = '';
        var left = el('span');
        left.appendChild(document.createTextNode('card height '));
        left.appendChild(el('b', null, h + 'px'));
        measure.appendChild(left);
        var over = h > 480;
        measure.setAttribute('data-over', over ? 'true' : 'false');
        measure.appendChild(el('span', null, over ? 'over the 480px cap — scrolls' : 'within the 480px cap'));
      }
      stamp();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(stamp);
    }
    redraw();
  }

  /* ── boot ──────────────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-spec]').forEach(function (host) {
    var a = host.getAttribute('data-spec');
    var which = host.getAttribute('data-sub');
    var sub = LP.subjects.filter(function (s) { return s.slug === which; })[0];
    specimen(host, a, sub);
  });

  /* three-state theme, matching tokens.css: no stamp = follow the system. */
  var tbar = document.querySelector('.lp-theme');
  if (tbar) {
    tbar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var v = b.getAttribute('data-theme');
      if (v === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', v);
      tbar.querySelectorAll('button').forEach(function (o) {
        o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
    });
  }
})();
