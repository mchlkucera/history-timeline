import { chromium } from 'playwright';
const b = await chromium.launch();
const c = await b.newContext({viewport:{width:1800,height:1250}});
const p = await c.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
p.on('requestfailed',r=>errs.push('requestfailed: '+r.url()));
await p.goto('file:///Users/michalkucera/Documents/CODE/timeline/experiments/vertical/index.html');
await p.waitForTimeout(500);

// 10 states. (Was 11: the two flipped states are gone with the flip itself, and
// a mid-pan state was added for the wider-than-viewport surface.)
const states = [
  ['default',            ()=>{VT.panX=0;VT.d0=-3000;VT.d1=2026;}],
  ['mozart 1750-1800',   ()=>{VT.lens.MU=true;VT.syncChips();VT.d0=1750;VT.d1=1800;}],
  ['mozart, panned',     ()=>{VT.lens.SC=true;VT.syncChips();VT.panX=1e6;}],
  ['log deep time',      ()=>{VT.lens.SC=false;VT.syncChips();VT.panX=0;VT.log=true;}],
  ['1900-1950 + sci',    ()=>{VT.log=false;VT.lens.SC=true;VT.syncChips();VT.d0=1900;VT.d1=1950;}],
  ['antiquity -600..900',()=>{VT.d0=-600;VT.d1=900;}],
  ['filtered',           ()=>{VT.off.add('war');VT.off.add('power');VT.d0=-600;VT.d1=900;}],
  ['search prague',      ()=>{VT.off.clear();VT.q='prague';VT.d0=1300;VT.d1=1900;}],
  ['max zoom (8 yrs)',   ()=>{VT.q='';VT.d0=1787;VT.d1=1795;}],
  ['max out (80k yrs)',  ()=>{VT.d0=-78000;VT.d1=2026;}],
];
const seen=new Set(); let anyOverlap=0, anyEllipsis=0, oneViewAllFive=null;
for (const [name,fn] of states) {
  const r = await p.evaluate((src)=>{
    (new Function('return '+src))()(); VT.render();
    const L=VT.boxes.filter(x=>x.k==='lab');
    let ov=0;
    for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++){const a=L[i],b=L[j];
      if(a.col!==b.col)continue;
      if(Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y))ov++;}
    const spill=L.filter(x=>{const cc=VT._cols[x.col];return !cc||x.x<cc[0]-1||x.x+x.w>cc[0]+cc[1]+1;}).length;
    // a label ellipsises when its own text does not fit the column it landed in
    const ctx=VT.cv.getContext('2d'); ctx.font='11.5px -apple-system,system-ui,sans-serif';
    const ell=L.filter(x=>wrapText(ctx,x.ev[2],x.w-10,3).some(l=>l.endsWith('…'))).length;
    const types=[...new Set(VT.boxes.map(x=>x.ev[7]))].sort();
    return {labels:L.length,vis:VT._visLabels,marks:VT.boxes.length-L.length,ov,spill,ell,
            types,dropped:VT._dropped,surf:Math.round(VT._surface.SW),win:Math.round(VT._surface.CW)};
  }, fn.toString());
  r.types.forEach(t=>seen.add(t));
  anyOverlap+=r.ov; anyEllipsis+=r.ell;
  if(r.types.length===5&&!oneViewAllFive) oneViewAllFive=name;
  console.log(name.padEnd(21),
    `labels=${String(r.labels).padStart(3)}(${String(r.vis).padStart(3)} in window) marks=${String(r.marks).padStart(3)}`,
    `overlaps=${r.ov} spill=${r.spill} ellipsis=${r.ell} dropped=${String(r.dropped).padStart(2)}`,
    `surface=${String(r.surf).padStart(4)}/${r.win} shapes=[${r.types.join(',')}]`);
}
console.log('\nstates checked      :', states.length);
console.log('shapes seen overall :', [...seen].sort().join(', '), seen.size===5?'— all five OK':'— MISSING');
console.log('all five in one view:', oneViewAllFive||'no single view had all five');
console.log('total label overlaps:', anyOverlap);
console.log('total ellipsised    :', anyEllipsis);
console.log('errors              :', errs.length?errs.join('\n'):'none');

// ---- the headline check: a narrow window must not truncate anything, because
// the columns are no longer squeezed to fit it. Three pan positions.
console.log('\nnarrow window (1200px), 1750-1800, all three lenses');
const nc = await b.newContext({viewport:{width:1200,height:1000}});
const np = await nc.newPage();
np.on('pageerror',e=>errs.push('narrow pageerror: '+e.message));
np.on('console',m=>{if(m.type()==='error')errs.push('narrow console: '+m.text());});
await np.goto('file:///Users/michalkucera/Documents/CODE/timeline/experiments/vertical/index.html');
await np.waitForTimeout(400);
for (const [nm,px] of [['pan left',0],['pan middle',.5],['pan right',1]]) {
  const r = await np.evaluate((f)=>{
    VT.lens.MU=true;VT.lens.SC=true;VT.lens.MZ=true;VT.syncChips();VT.d0=1750;VT.d1=1800;
    VT.panX=0;VT.render(); VT.panX=VT._surface.maxPan*f; VT.render();
    const L=VT.boxes.filter(x=>x.k==='lab');
    const ctx=VT.cv.getContext('2d'); ctx.font='11.5px -apple-system,system-ui,sans-serif';
    const ell=L.filter(x=>wrapText(ctx,x.ev[2],x.w-10,3).some(l=>l.endsWith('…')));
    return {labels:L.length,vis:VT._visLabels,ell:ell.length,worst:ell[0]?ell[0].ev[2]:'—',
            surf:Math.round(VT._surface.SW),win:Math.round(VT._surface.CW),pan:Math.round(VT.panX)};
  }, px);
  console.log(' ', nm.padEnd(11), `panX=${String(r.pan).padStart(3)} surface=${r.surf}/${r.win}`,
              `labels=${r.labels} (${r.vis} in window) ellipsised=${r.ell} ${r.ell?'← '+r.worst:''}`);
}
console.log('narrow-window errors:', errs.length?errs.join('\n'):'none');
await b.close();
