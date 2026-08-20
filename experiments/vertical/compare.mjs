import { chromium } from 'playwright';
const b = await chromium.launch();
const c = await b.newContext({viewport:{width:1800,height:1250},deviceScaleFactor:1});

// --- horizontal original: count real event-label draws (label font is unique to them)
const hp = await c.newPage();
await hp.goto('file:///Users/michalkucera/Documents/CODE/timeline/prototypes/timeline-lab.html');
await hp.waitForTimeout(1800);
await hp.evaluate(()=>{document.querySelector('nav.tabs button[data-tab="zoom"]').click();});
await hp.waitForTimeout(400);
await hp.evaluate(()=>{
  const F=/^11\.5px /;
  const P=CanvasRenderingContext2D.prototype, o=P.fillText;
  window.__lab=[];
  P.fillText=function(t,x,y){ if(F.test(this.font)) window.__lab.push(t); return o.apply(this,arguments); };
});
const H = async (a,b2,setup)=>{
  await hp.evaluate(([a,b2,setup])=>{ eval(setup); TL.log=false;TL.d0=a;TL.d1=b2; window.__lab=[]; TL.render(); },[a,b2,setup||'']);
  return await hp.evaluate(()=>{
    const cw=TL.cv.clientWidth, G=118, Wp=cw-G-10;
    // TL pushes box.x = (mode==='left' ? x0-11-labelW : x0-8) — so a box starting
    // well left of the mark means the label was edge-flipped to the far side.
    let flipped=0;
    for(const b of TL.boxes){ const x0=TL.x(b.ev[0],G,Wp); if(b.x < x0-12) flipped++; }
    return {n:new Set(window.__lab).size, flipped};
  });
};

// --- vertical
const vp = await c.newPage();
await vp.goto('file:///Users/michalkucera/Documents/CODE/timeline/experiments/vertical/index.html');
await vp.waitForTimeout(500);
const V = async (a,b2,setup)=>{
  return await vp.evaluate(([a,b2,setup])=>{ eval(setup); VT.log=false;VT.panX=0;VT.d0=a;VT.d1=b2;VT.render();
    const L=VT.boxes.filter(x=>x.k==='lab');
    // the surface can now be wider than the window, so count both: every label
    // the view holds, and the subset legible without panning
    return {n:new Set(L.map(x=>x.ev[2])).size,
            inWin:new Set(L.filter(x=>x.vw>x.w*0.6).map(x=>x.ev[2])).size,
            over:Math.max(0,Math.round(VT._surface.SW-VT._surface.CW)),
            dropped:VT._dropped}; },[a,b2,setup||'']);
};

const lensBoth='TL.lens.MZ=true;TL.lens.MU=true;TL.syncChips();';
const lensBothV='VT.lens.MZ=true;VT.lens.MU=true;VT.syncChips();';
const sci ='TL.lens.SC=true;TL.syncChips();';
const sciV='VT.lens.SC=true;VT.syncChips();';

const cases = [
  ['whole span   -3000..2026', -3000, 2026, lensBoth, lensBothV],
  ['Mozart       1750..1800',   1750, 1800, lensBoth, lensBothV],
  ['renaissance  1400..1700',   1400, 1700, lensBoth, lensBothV],
  ['20th c.      1900..1950',   1900, 1950, lensBoth+sci, lensBothV+sciV],
  ['1776 preset  1746..1806',   1746, 1806, lensBoth+sci, lensBothV+sciV],
];
console.log('window 1800px            horiz  vert   delta          in window  surface overflow');
for (const [name,a,b2,hs,vs] of cases) {
  const h = await H(a,b2,hs), v = await V(a,b2,vs);
  const d = v.n-h.n;
  console.log(name.padEnd(24), String(h.n).padStart(4), String(v.n).padStart(6),
              '  ', ((d>0?'+':'')+d).padStart(4), `(${(v.n/h.n).toFixed(2)}x)`,
              String(v.inWin).padStart(9), `(${(v.inWin/h.n).toFixed(2)}x)`,
              String(v.over?'+'+v.over+'px':'fits').padStart(9),
              ` · horiz edge-flipped: ${h.flipped}`,
              v.dropped?`· vert dropped: ${v.dropped}`:'');
}
await b.close();
