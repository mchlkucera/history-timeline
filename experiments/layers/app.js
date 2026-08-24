/* Timeline — Layers concept prototype.
   One draggable list of topic layers replaces the Lanes + Domain panels.
   Five operations: DRAG · HIDE · GROUP · ADD · REMOVE  (+ per-layer detail dial) */
'use strict';
const D = window.TLDATA;
const $ = (s,r)=> (r||document).querySelector(s);
const el = (t,c,h)=>{const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n;};
const CATS = ['power','war','belief','sci','art','nature','society','reach'];
const cvar = c => `var(--tl-cat-${CATS.includes(c)?c:'power'})`;

/* ── MODEL ───────────────────────────────────────────────────────────────── */
let uid = 0;
const nid = p => p + (++uid);
const L = {};                     // layerId -> layer
function mkLayer(k, src){
  const t = (src||D.topics)[k] || D.library[k];
  const id = nid('L');
  L[id] = {id, tk:k, name:t.name, cat:t.cat, color:t.cat, items:t.items, detail:3, hidden:false, opacity:1};
  return id;
}
let tree = [
  {id:nid('G'), name:'Europe',       collapsed:false, hidden:false, kids:['eu-ess','eu-sci','eu-war','eu-art'].map(k=>mkLayer(k))},
  {id:nid('G'), name:'Asia',         collapsed:false, hidden:false, kids:['as-ess','as-dyn'].map(k=>mkLayer(k))},
  {id:nid('G'), name:'World',        collapsed:false, hidden:false, kids:['deep'].map(k=>mkLayer(k))},
  {id:nid('G'), name:'My interests', collapsed:false, hidden:false, kids:['arts','design','mozart'].map(k=>mkLayer(k))},
];
let libAvail = Object.keys(D.library);     // topics still on the shelf
let soloGroup = null, sel = null;

const G = id => tree.find(g=>g.id===id);
const findLayer = lid => { for(const g of tree){const i=g.kids.indexOf(lid); if(i>=0) return [g,i];} return [null,-1]; };
const groupHidden = g => g.hidden || (soloGroup && soloGroup!==g.id);
const visibleItems = (lay, cap) => lay.items.filter(it=> it.i <= (cap==null?lay.detail:cap));

/* ── ICONS ───────────────────────────────────────────────────────────────── */
const I = {
 eye:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>',
 eyeoff:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.6 5.4C1.9 6.3 1.5 8 1.5 8S3.9 12.2 8 12.2c1 0 1.9-.2 2.7-.6M6.2 4c.6-.14 1.2-.2 1.8-.2 4.1 0 6.5 4.2 6.5 4.2s-.6 1.1-1.7 2.2"/><path d="M2.5 2.5l11 11"/></svg>',
 chev:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6l4 4 4-4"/></svg>',
 grip:'<svg viewBox="0 0 9 11" fill="currentColor"><circle cx="2" cy="1.6" r="1"/><circle cx="7" cy="1.6" r="1"/><circle cx="2" cy="5.5" r="1"/><circle cx="7" cy="5.5" r="1"/><circle cx="2" cy="9.4" r="1"/><circle cx="7" cy="9.4" r="1"/></svg>'
};

/* ── PANEL RENDER ────────────────────────────────────────────────────────── */
const treeEl = $('#tree');
function renderPanel(){
  treeEl.innerHTML = '';
  for(const g of tree){
    const gw = el('div','group'); gw.dataset.gid = g.id;
    const gh = el('div','ghead'+(g.collapsed?' col':'')+(groupHidden(g)?' off':''));
    gh.dataset.gid = g.id;
    const chev = el('div','chev',I.chev); chev.dataset.act='collapse';
    chev.title = g.collapsed ? 'expand — split back into separate lanes' : 'collapse — merge these lanes into one';
    const eye  = el('div','eye', groupHidden(g)?I.eyeoff:I.eye); eye.dataset.act='geye'; eye.title='hide group  ·  alt-click = solo';
    const nm   = el('div','gname'); nm.textContent = g.name; nm.dataset.act='gdrag'; nm.title='double-click to rename · drag to move the group';
    const cn   = el('div','gcount'); cn.textContent = g.kids.length;
    const act  = el('div','act');
    const add  = el('div','ic','+'); add.dataset.act='gadd'; add.title='add a lane to this group';
    const del  = el('div','ic del','×'); del.dataset.act='gdel'; del.title='delete group (its lanes return to the library)';
    act.append(add,del);
    const grip = el('div','grip',I.grip); grip.dataset.act='gdrag';
    gh.append(chev,eye,nm,cn,act,grip);
    gw.append(gh);

    const kids = el('div','kids'+(g.kids.length?'':' empty')); kids.dataset.gid = g.id;
    if(!g.collapsed){
      g.kids.forEach((lid,i)=>{
        const l = L[lid];
        const r = el('div','row'+(l.hidden||groupHidden(g)?' off':'')+(sel===lid?' sel':''));
        r.dataset.lid = lid; r.dataset.gid = g.id; r.dataset.idx = i;
        const e = el('div','eye', l.hidden?I.eyeoff:I.eye); e.dataset.act='eye'; e.title='show / hide this layer';
        const d = el('div','dot'); d.style.setProperty('--c', cvar(l.color));
        const n = el('div','nm'); n.textContent = l.name; n.dataset.act='drag';
        const c = el('div','cnt'); c.textContent = visibleItems(l).length;
        const det = el('div','det'); det.dataset.act='det'; det.title='detail '+l.detail+'/5 — how much of this layer to show';
        for(let k=1;k<=5;k++){const b=el('i',k<=l.detail?'on':''); b.dataset.lv=k; det.append(b);}
        const act2 = el('div','act');
        const cog = el('div','ic','⚙'); cog.dataset.act='cog'; cog.title='layer settings';
        const x   = el('div','ic del','×'); x.dataset.act='del'; x.title='remove layer (returns to the library)';
        act2.append(cog,x);
        const gr = el('div','grip',I.grip); gr.dataset.act='drag';
        r.append(e,d,n,c,det,act2,gr);
        kids.append(r);
      });
    }
    gw.append(kids); treeEl.append(gw);
  }
  const nl = Object.keys(L).length;
  const nv = tree.reduce((a,g)=>a+(groupHidden(g)?0:g.kids.filter(k=>!L[k].hidden).length),0);
  $('#hcount').textContent = nv + '/' + nl + ' shown';
}

/* ── WORKSPACE RENDER ────────────────────────────────────────────────────── */
const lanesEl = $('#lanes');
let laneRecs = [];
const LANE_H = 30, MERGE_H = 36, GLAB_H = 19;

function buildWorkspace(){
  const keep = new Map([...lanesEl.children].map(n=>[n.dataset.lk,n]));
  const used = new Set(); laneRecs = [];
  let y = 6;
  for(const g of tree){
    if(groupHidden(g)) continue;
    const shown = g.kids.filter(k=>!L[k].hidden);
    if(!shown.length) continue;
    const gk = 'g:'+g.id;
    let gl = keep.get(gk);
    if(!gl){ gl = el('div','glab','<span></span><s></s>'); gl.dataset.lk = gk; lanesEl.append(gl); }
    gl.querySelector('span').textContent = g.name + (g.collapsed?' · merged':'');
    gl.style.transform = `translateY(${y}px)`; used.add(gk); y += GLAB_H;

    if(g.collapsed){
      // COLLAPSE = MERGE: the group's layers become one lane at headline detail
      const cap = Math.max(1, Math.min.apply(null, shown.map(k=>L[k].detail)) - 1);
      const items = [];
      for(const k of shown) for(const it of visibleItems(L[k], cap)) items.push(it);
      items.sort((a,b)=>a.s-b.s);
      const lk = 'm:'+g.id;
      let ln = keep.get(lk) || mkLane(lk,'merged');
      used.add(lk);
      ln.querySelector('.llab').textContent = g.name + ' — ' + shown.length + ' layers merged · headlines only';
      fillLane(ln, items, 1);
      ln.style.transform = `translateY(${y}px)`; y += MERGE_H;
      laneRecs.push({el:ln, items});
    } else {
      for(const k of shown){
        const l = L[k], lk = 'l:'+k;
        let ln = keep.get(lk) || mkLane(lk,'');
        used.add(lk);
        ln.querySelector('.llab').textContent = shortName(l.name, g.name);
        const items = visibleItems(l);
        fillLane(ln, items, l.opacity);
        ln.style.transform = `translateY(${y}px)`; y += LANE_H;
        laneRecs.push({el:ln, items});
      }
    }
  }
  for(const [k,n] of keep) if(!used.has(k)) n.remove();
  lanesEl.style.height = (y+14)+'px';
  position();
  $('#hud').textContent = laneRecs.length + ' lanes · ' + laneRecs.reduce((a,r)=>a+r.items.length,0) + ' marks';
}
/* the group separator already says "Europe" — don't repeat it in the lane label */
function shortName(name, gname){
  const p = gname + ' · ';
  return name.startsWith(p) ? name.slice(p.length) : name;
}
function mkLane(lk, extra){
  const ln = el('div','lane '+extra);
  ln.dataset.lk = lk;
  ln.innerHTML = '<div class="lbg"></div><div class="llab"></div><div class="marks"></div>';
  ln.style.opacity = 0; ln.style.transform = 'translateY(0px)';
  lanesEl.append(ln);
  requestAnimationFrame(()=>{ ln.style.opacity = 1; });
  return ln;
}
function fillLane(ln, items, op){
  const m = ln.querySelector('.marks');
  m.innerHTML = '';
  ln.style.opacity = (op==null?1:op);
  const arr = [];
  for(const it of items){
    const isSpan = it.e && it.e !== it.s;
    const d = el('div','mk '+(isSpan?('sp'+(it.k==='life'?' life':'')):('dot i'+it.i)));
    d.style.setProperty('--c', cvar(it.c));
    d.dataset.t = it.t; d.dataset.s = it.s; d.dataset.e = it.e||0; d.dataset.c = it.c; d.dataset.i = it.i;
    const lb = el('div','lb'); lb.textContent = it.t; d.append(lb);
    m.append(d); arr.push({n:d, lb, s:it.s, e:isSpan?it.e:0, sp:isSpan, imp:it.i, lw:0});
  }
  for(const a of arr) a.lw = a.lb.offsetWidth;   // measure once, not every pan frame
  ln._marks = arr;
}

/* ── TIME SCALE — log(years before present), so deep time and 1789 coexist ─ */
const NOW = 2030;
const U = y => Math.log10(Math.max(1, NOW - y));
const uMin = U(2026), uMax = U(-13.8e9);
let view = {u0: U(-12000), k: 300};   // u at x=0 (left edge), px per u-unit
const xOf = y => (view.u0 - U(y)) * view.k;

function position(){
  const W = $('#stage').clientWidth;
  for(const r of laneRecs){
    const arr = r.el._marks || [], n = arr.length;
    let lastR = -1e9;
    for(let i=0;i<n;i++){
      const m = arr[i], x = xOf(m.s);
      const nx = i < n-1 ? xOf(arr[i+1].s) : 1e9;         // where the next mark lands
      if(m.sp){
        const w = Math.max(3, xOf(m.e) - x);
        m.n.style.transform = `translateX(${x}px)`; m.n.style.width = w+'px';
        const room = w > m.lw + 14 && x + w > 0 && x < W && x + 4 >= lastR;
        m.lb.classList.toggle('hide', !room);
        if(room) lastR = x + Math.min(w, m.lw + 14);
      } else {
        m.n.style.transform = `translateX(${x}px)`;
        /* headline marks keep their label even in a crowd; minor ones yield */
        const roomy = nx - x > m.lw + 14 || (m.imp <= 2 && nx - x > 22);
        const on = x > -40 && x < W + 40 && x > lastR + 7 && roomy;
        m.lb.classList.toggle('hide', !on);
        if(on) lastR = x + m.lw + 10;
      }
    }
  }
  drawAxis();
}
const TICKS = [-13e9,-1e9,-100e6,-10e6,-1e6,-100000,-10000,-5000,-3000,-2000,-1000,-500,-200,0,500,1000,1200,1400,1500,1600,1700,1800,1850,1900,1925,1950,1975,2000,2020];
function fmt(y){
  const a = Math.abs(y);
  if(a>=1e9) return (a/1e9).toFixed(a>=1e10?0:1)+' bn'+(y<0?' BCE':'');
  if(a>=1e6) return (a/1e6).toFixed(0)+' m'+(y<0?' BCE':'');
  if(a>=10000) return (a/1000).toFixed(0)+'k'+(y<0?' BCE':'');
  return y<0 ? a+' BCE' : (y===0?'0':''+y);
}
function drawAxis(){
  const W = $('#stage').clientWidth;
  let h='', gh='', last=-1e9;
  for(const t of TICKS){
    const x = xOf(t);
    if(x < -20 || x > W) continue;
    if(x - last < 56) continue;
    last = x;
    h += `<div class="t" style="left:${x}px">${fmt(t)}</div>`;
    gh += `<div class="g" style="left:${x}px"></div>`;
  }
  $('#axis').innerHTML = h; $('#grid').innerHTML = gh;
}

/* ── PAN / ZOOM ──────────────────────────────────────────────────────────── */
const stage = $('#stage');
function clampView(){
  const W = stage.clientWidth;
  view.u0 = Math.max(uMin + 0.05, Math.min(uMax + W/view.k - 0.05, view.u0));
}
stage.addEventListener('wheel', e=>{
  e.preventDefault();
  const px = e.clientX - stage.getBoundingClientRect().left;
  if(e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)){
    const uAt = view.u0 - px/view.k;
    view.k = Math.max(26, Math.min(6000, view.k * Math.exp(-e.deltaY * 0.0018)));
    view.u0 = uAt + px/view.k;
  } else view.u0 += e.deltaX / view.k;
  clampView(); position();
},{passive:false});
let panning = null;
stage.addEventListener('mousedown', e=>{
  if(e.button!==0) return;
  panning = {x:e.clientX, u0:view.u0}; stage.classList.add('pan');
});
window.addEventListener('mousemove', e=>{
  if(!panning) return;
  view.u0 = panning.u0 + (e.clientX - panning.x)/view.k;   // content follows the hand
  clampView(); position();
});
window.addEventListener('mouseup', ()=>{ panning=null; stage.classList.remove('pan'); });

const tip = $('#tip');
stage.addEventListener('mousemove', e=>{
  const m = e.target.closest && e.target.closest('.mk');
  if(!m || panning){ tip.style.display='none'; return; }
  const s = +m.dataset.s, en = +m.dataset.e;
  tip.innerHTML = `<div>${m.dataset.t}</div><em>${fmt(s)}${en&&en!==s?' – '+fmt(en):''} · ${m.dataset.c} · level ${m.dataset.i}</em>`;
  tip.style.display='block';
  tip.style.left = Math.min(e.clientX+12, innerWidth-300)+'px';
  tip.style.top = (e.clientY+14)+'px';
});
stage.addEventListener('mouseleave', ()=>{ tip.style.display='none'; });

/* ── PANEL INTERACTIONS ──────────────────────────────────────────────────── */
treeEl.addEventListener('click', e=>{
  const t = e.target.closest('[data-act]'); if(!t) return;
  const act = t.dataset.act;
  const row = e.target.closest('.row'), gh = e.target.closest('.ghead');
  const host = row||gh; if(!host) return;
  const gid = host.dataset.gid, lid = row && row.dataset.lid;
  if(act==='collapse'){ G(gid).collapsed = !G(gid).collapsed; renderPanel(); buildWorkspace(); }
  else if(act==='geye'){
    if(e.altKey) soloGroup = (soloGroup===gid)?null:gid;
    else G(gid).hidden = !G(gid).hidden;
    renderPanel(); buildWorkspace();
  }
  else if(act==='gadd'){ openLib(t, gid); }
  else if(act==='gdel'){ delGroup(gid); }
  else if(act==='eye'){ L[lid].hidden = !L[lid].hidden; renderPanel(); buildWorkspace(); }
  else if(act==='del'){ removeLayer(lid); }
  else if(act==='cog'){ openSettings(t, lid); }
  else if(act==='det'){
    const lv = +(e.target.dataset.lv || 0);
    if(lv){ L[lid].detail = lv; sel = lid; renderPanel(); buildWorkspace(); }
  }
});
treeEl.addEventListener('dblclick', e=>{
  const nm = e.target.closest('.gname'); if(!nm) return;
  const gid = e.target.closest('.ghead').dataset.gid;
  nm.contentEditable = 'true'; nm.focus();
  const done = ()=>{ nm.contentEditable='false'; G(gid).name = nm.textContent.trim()||'Group'; renderPanel(); buildWorkspace(); };
  nm.addEventListener('blur', done, {once:true});
  nm.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); nm.blur(); } });
});
treeEl.addEventListener('contextmenu', e=>{
  const row = e.target.closest('.row'); if(!row) return;
  e.preventDefault(); openSettings(row, row.dataset.lid);
});

function removeLayer(lid){
  const [g,i] = findLayer(lid); if(!g) return;
  const k = L[lid].tk;
  if(!libAvail.includes(k)) libAvail.push(k);
  g.kids.splice(i,1); delete L[lid];
  closePops(); renderPanel(); buildWorkspace();
}
function delGroup(gid){
  const g = G(gid); if(!g) return;
  for(const lid of g.kids){ const k = L[lid].tk; if(!libAvail.includes(k)) libAvail.push(k); delete L[lid]; }
  tree = tree.filter(x=>x.id!==gid);
  if(soloGroup===gid) soloGroup = null;
  renderPanel(); buildWorkspace();
}

/* ── ADD: the topic library ──────────────────────────────────────────────── */
const libpop = $('#libpop'), setpop = $('#setpop');
function closePops(){ libpop.style.display='none'; setpop.style.display='none'; }
document.addEventListener('mousedown', e=>{
  if(!e.target.closest('.pop') && !e.target.closest('[data-act="cog"]') &&
     !e.target.closest('[data-act="gadd"]') && !e.target.closest('#addLane')) closePops();
});
function libEntry(k){ return D.library[k] || D.topics[k]; }
function openLib(anchor, gid){
  closePops();
  const g = G(gid) || tree[tree.length-1];
  if(!g){ return; }
  libpop.innerHTML = '';
  libpop.append(el('h4',null,'Add a lane to <b style="color:var(--tl-ink-2)">'+g.name+'</b>'));
  const avail = libAvail.slice().sort((a,b)=> libEntry(a).name.localeCompare(libEntry(b).name));
  if(!avail.length) libpop.append(el('div','empty','Every topic is already on the board.'));
  for(const k of avail){
    const t = libEntry(k);
    const it = el('div','item'); it.dataset.tk = k;
    const d = el('span',null,'');
    d.style.cssText = `width:7px;height:7px;border-radius:50%;flex:none;background:${cvar(t.cat)}`;
    const n = el('span',null); n.textContent = t.name;
    const c = el('span','n'); c.textContent = t.items.length;
    it.append(d,n,c);
    it.onclick = ()=>{
      g.kids.push(mkLayer(k, D.library[k] ? D.library : D.topics));
      libAvail = libAvail.filter(x=>x!==k);
      closePops(); renderPanel(); buildWorkspace();
    };
    libpop.append(it);
  }
  place(libpop, anchor);
}
$('#addLane').onclick = e => openLib(e.currentTarget, tree.length?tree[tree.length-1].id:null);
$('#addGroup').onclick = ()=>{
  tree.push({id:nid('G'), name:'New group', collapsed:false, hidden:false, kids:[]});
  renderPanel(); buildWorkspace(); treeEl.scrollTop = treeEl.scrollHeight;
};

/* ── per-layer settings ──────────────────────────────────────────────────── */
function openSettings(anchor, lid){
  closePops(); const l = L[lid]; if(!l) return;
  setpop.innerHTML = '';
  setpop.append(el('h4',null,l.name));
  const sw = el('div','sw');
  for(const c of CATS){
    const b = el('b', c===l.color?'on':''); b.style.background = cvar(c); b.title = c;
    b.onclick = ()=>{ l.color = c; renderPanel(); openSettings(anchor,lid); };
    sw.append(b);
  }
  setpop.append(sw);
  const lab = el('label',null,'<span>Detail</span>');
  const rg = el('input'); rg.type='range'; rg.min=1; rg.max=5; rg.step=1; rg.value=l.detail;
  rg.oninput = ()=>{ l.detail = +rg.value; renderPanel(); buildWorkspace(); };
  lab.append(rg); setpop.append(lab);
  const lab2 = el('label',null,'<span>Opacity</span>');
  const rg2 = el('input'); rg2.type='range'; rg2.min=0.15; rg2.max=1; rg2.step=0.05; rg2.value=l.opacity;
  rg2.oninput = ()=>{ l.opacity = +rg2.value; buildWorkspace(); };
  lab2.append(rg2); setpop.append(lab2);
  setpop.append(el('div','sep'));
  const rm = el('div','item dang'); rm.textContent = '×  Remove layer';
  rm.onclick = ()=> removeLayer(lid);
  setpop.append(rm);
  place(setpop, anchor);
}
function place(pop, anchor){
  pop.style.display='block';
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 10) + 'px';
  pop.style.top  = Math.min(r.bottom + 5, innerHeight - pop.offsetHeight - 10) + 'px';
}

/* ── DRAG: reorder inside a group, and move between groups ───────────────── */
const ghost = $('#ghost'), dropline = $('#dropline');
let drag = null;
treeEl.addEventListener('mousedown', e=>{
  const t = e.target.closest('[data-act="drag"],[data-act="gdrag"]');
  if(!t || e.button!==0) return;
  const isG = t.dataset.act === 'gdrag';
  const host = e.target.closest(isG ? '.ghead' : '.row');
  if(host.isContentEditable || e.target.isContentEditable) return;
  e.preventDefault();
  drag = {isG, gid:host.dataset.gid, lid:host.dataset.lid, x:e.clientX, y:e.clientY, live:false, el:host};
});
window.addEventListener('mousemove', e=>{
  if(!drag) return;
  if(!drag.live){
    if(Math.abs(e.clientY-drag.y) + Math.abs(e.clientX-drag.x) < 4) return;
    drag.live = true; closePops();
    ghost.style.display = 'flex';
    if(drag.isG) ghost.innerHTML = '<b style="font-size:11px;letter-spacing:.05em;text-transform:uppercase">'+G(drag.gid).name+'</b>';
    else {
      const l = L[drag.lid];
      ghost.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${cvar(l.color)};display:block"></span>${l.name}`;
    }
    drag.el.classList.add('drop-src');
  }
  ghost.style.left = (e.clientX + 12)+'px';
  ghost.style.top  = (e.clientY - 10)+'px';

  /* LIVE MOVE — the model is reordered as the pointer passes each slot, so the
     workspace lanes slide into their new places while you are still dragging. */
  if(drag.isG){
    const t = groupSlot(e.clientY); if(!t) return;
    const gi = tree.findIndex(g=>g.id===drag.gid);
    let at = t.gi; if(gi < at) at--;
    at = Math.max(0, Math.min(at, tree.length-1));
    if(at !== gi){
      tree.splice(at, 0, tree.splice(gi,1)[0]);
      repaintDuringDrag();
    }
  } else {
    const t = slotAt(e.clientY); if(!t) return;
    const [og,oi] = findLayer(drag.lid);
    const ng = G(t.gid); if(!ng) return;
    let at = t.idx; if(og===ng && oi < at) at--;
    at = Math.max(0, Math.min(at, og===ng ? ng.kids.length-1 : ng.kids.length));
    if(og!==ng || at!==oi){
      og.kids.splice(oi,1);
      ng.kids.splice(at,0,drag.lid);
      repaintDuringDrag();
    }
  }
});
function repaintDuringDrag(){
  renderPanel(); buildWorkspace();
  const sel2 = drag.isG
    ? treeEl.querySelector(`.group[data-gid="${drag.gid}"] .ghead`)
    : treeEl.querySelector(`.row[data-lid="${drag.lid}"]`);
  if(sel2){ sel2.classList.add('drop-src'); drag.el = sel2; }
}
window.addEventListener('mouseup', ()=>{
  if(!drag) return;
  const d = drag; drag = null;
  ghost.style.display='none'; dropline.style.display='none';
  if(!d.live && d.lid){ sel = d.lid; }
  renderPanel(); buildWorkspace();
});
/* nearest insertion point (group, index) to the pointer */
function slotAt(py){
  let best=null, bd=1e9;
  for(const g of tree){
    const gw = treeEl.querySelector(`.group[data-gid="${g.id}"]`); if(!gw) continue;
    const kids = gw.querySelector('.kids');
    const rows = [...kids.querySelectorAll('.row')];
    const kr = kids.getBoundingClientRect();
    const cand = [];
    if(g.collapsed || !rows.length){
      const hr = gw.querySelector('.ghead').getBoundingClientRect();
      cand.push({y:hr.bottom, idx:g.collapsed?g.kids.length:0, x:kr.left+8, w:Math.max(40,kr.width-14)});
    }
    rows.forEach((r,i)=>{
      const b = r.getBoundingClientRect();
      cand.push({y:b.top, idx:i, x:b.left, w:b.width});
      if(i===rows.length-1) cand.push({y:b.bottom, idx:i+1, x:b.left, w:b.width});
    });
    for(const c of cand){
      const dd = Math.abs(py - c.y);
      if(dd < bd){ bd = dd; best = {gid:g.id, idx:c.idx, y:c.y, x:c.x, w:c.w}; }
    }
  }
  return best;
}
function groupSlot(py){
  let best=null, bd=1e9;
  tree.forEach((g,i)=>{
    const gw = treeEl.querySelector(`.group[data-gid="${g.id}"]`); if(!gw) return;
    const b = gw.getBoundingClientRect();
    for(const c of [{y:b.top,gi:i},{y:b.bottom,gi:i+1}]){
      const dd = Math.abs(py - c.y);
      if(dd < bd){ bd = dd; best = {gi:c.gi, y:c.y, x:b.left+2, w:b.width-8}; }
    }
  });
  return best;
}

/* ── boot ────────────────────────────────────────────────────────────────── */
addEventListener('resize', ()=>{ clampView(); position(); });
renderPanel(); buildWorkspace();
window.__tl = {get tree(){return tree;}, L, get view(){return view;}, buildWorkspace, renderPanel,
               get libAvail(){return libAvail;}};
