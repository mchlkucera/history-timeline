import { chromium } from 'playwright';
const b = await chromium.launch();
const errs=[];
for (const vp of [[1920,1200],[1440,900],[1280,800]]) {
  const c = await b.newContext({viewport:{width:vp[0],height:vp[1]},deviceScaleFactor:2});
  const p = await c.newPage();
  p.on('pageerror',e=>errs.push(vp+' '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(vp+' '+m.text());});
  await p.goto('file:///Users/michalkucera/Documents/CODE/timeline/experiments/vertical/index.html');
  await p.waitForTimeout(400);
  const r = await p.evaluate(()=>{
    VT.lens.MU=true;VT.lens.SC=true;VT.lens.MZ=true;VT.syncChips();VT.d0=1750;VT.d1=1800;VT.render();
    const cols=Object.entries(VT._cols).map(([k,v])=>k+':'+Math.round(v[1]));
    return {H:VT.H, cw:VT.cv.clientWidth, surface:Math.round(VT._surface.SW), window:Math.round(VT._surface.CW),
            maxPan:Math.round(VT._surface.maxPan), cols:cols.join(' '), labels:VT.boxes.filter(x=>x.k==='lab').length};
  });
  console.log(vp.join('x'), JSON.stringify(r));
  if(vp[0]===1920){ await p.locator('.card').screenshot({path:'shots/10-wide-1920.png'}); }
  await c.close();
}
// interaction tests run at 1280 — narrow enough that the surface really does
// exceed the window, which is the case the panning exists for
const c = await b.newContext({viewport:{width:1280,height:900}});
const p = await c.newPage();
p.on('pageerror',e=>errs.push('int '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('int '+m.text());});
await p.goto('file:///Users/michalkucera/Documents/CODE/timeline/experiments/vertical/index.html');
await p.waitForTimeout(400);
const box = await p.locator('#vertCanvas').boundingBox();
const cx = box.x+box.width/2, cy = box.y+box.height*0.6;

const before = await p.evaluate(()=>[VT.d0,VT.d1]);
const yearAtCursor = await p.evaluate((f)=>VT.it(f,VT.GY,VT.H-VT.GY-VT.PAD), box.height*0.6);
await p.mouse.move(cx,cy);
await p.mouse.wheel(0,-600);                       // zoom IN
await p.waitForTimeout(120);
const after = await p.evaluate(()=>[VT.d0,VT.d1]);
const yearAfter = await p.evaluate((f)=>VT.it(f,VT.GY,VT.H-VT.GY-VT.PAD), box.height*0.6);
console.log('wheel zoom-in  span', Math.round(before[1]-before[0]), '->', Math.round(after[1]-after[0]),
            '| year under cursor', Math.round(yearAtCursor), '->', Math.round(yearAfter),
            '| panX', await p.evaluate(()=>VT.panX), '(wheel must not pan)');

// a state with a surface wider than the window, so there is something to pan to
const wide = ()=>p.evaluate(()=>{VT.lens.MU=true;VT.lens.SC=true;VT.lens.MZ=true;VT.syncChips();
  VT.d0=1700;VT.d1=1800;VT.panX=0;VT.render();return Math.round(VT._surface.maxPan);});
console.log('pannable surface   maxPan =', await wide(), 'px');

// vertical drag: past-at-top, dragging DOWN reveals earlier years (d0 decreases)
await p.mouse.move(cx,cy); await p.mouse.down(); await p.mouse.move(cx,cy+200,{steps:8}); await p.mouse.up();
const d1r = await p.evaluate(()=>[Math.round(VT.d0),Math.round(VT.d1),Math.round(VT.panX)]);
console.log('drag DOWN  1700-1800 ->', d1r[0]+'-'+d1r[1], 'panX='+d1r[2], d1r[0]<1700&&d1r[2]===0?'OK earlier, no sideways drift':'WRONG');

// horizontal drag: dragging LEFT moves the surface left, revealing columns to the right
await wide();
await p.mouse.move(cx,cy); await p.mouse.down(); await p.mouse.move(cx-260,cy,{steps:8}); await p.mouse.up();
const d2r = await p.evaluate(()=>[Math.round(VT.d0),Math.round(VT.d1),Math.round(VT.panX)]);
console.log('drag LEFT  panX 0 ->', d2r[2], '| span', d2r[0]+'-'+d2r[1], d2r[2]>0&&d2r[0]===1700?'OK sideways, no time drift':'WRONG');

// both axes in ONE gesture
await wide();
await p.mouse.move(cx,cy); await p.mouse.down();
await p.mouse.move(cx-120,cy+60,{steps:4}); await p.mouse.move(cx-240,cy+150,{steps:6}); await p.mouse.up();
const d3r = await p.evaluate(()=>[Math.round(VT.d0),Math.round(VT.d1),Math.round(VT.panX)]);
console.log('drag DIAGONAL  ->', d3r[0]+'-'+d3r[1], 'panX='+d3r[2],
            (d3r[0]<1700&&d3r[2]>0)?'OK both axes in one gesture':'WRONG');

// shift+wheel is the non-drag route sideways; plain wheel must stay time-only
await wide();
await p.mouse.move(cx,cy);
await p.keyboard.down('Shift'); await p.mouse.wheel(0,300); await p.keyboard.up('Shift');
await p.waitForTimeout(100);
const sw = await p.evaluate(()=>[Math.round(VT.panX),Math.round(VT.d0),Math.round(VT.d1)]);
console.log('shift+wheel  panX ->', sw[0], '| span', sw[1]+'-'+sw[2], sw[0]>0&&sw[1]===1700?'OK':'WRONG');

// the pan rail under the plot is draggable
await wide();
const rail = await p.evaluate(()=>({y:(VT._rail.y0+VT._rail.y1)/2, gx:VT.GX}));
await p.mouse.move(box.x+box.width-60, box.y+rail.y); await p.mouse.down(); await p.mouse.up();
const rr = await p.evaluate(()=>Math.round(VT.panX));
console.log('rail click (far right)  panX ->', rr, rr>0?'OK':'WRONG');

// the edge chip is a control: clicking it brings that column in
await wide();
const chip = await p.evaluate(()=>{VT.panX=0;VT.render();
  const q=VT._pills[VT._pills.length-1]; return q?{x:q.x+q.w/2,y:q.y+q.h/2,to:Math.round(q.to),col:q.col}:null;});
if(chip){
  await p.mouse.move(box.x+chip.x, box.y+chip.y); await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(500);
  const cp = await p.evaluate((k)=>{
    const c=VT._colList.find(c=>c['key']===k);
    return {pan:Math.round(VT.panX), shown:c.x>=VT.GX-1&&c.x+c.w<=VT.cv.clientWidth-7, name:c.label};}, chip.col);
  console.log('edge chip click  panX 0 ->', cp.pan, '· brings', cp.name, 'fully into view:', cp.shown?'OK':'WRONG');
} else console.log('edge chip click  no chip (surface fits)');

// clamping: you can never pan past the end of the surface
await p.evaluate(()=>{VT.panX=1e6;VT.render();});
const cl = await p.evaluate(()=>[Math.round(VT.panX),Math.round(VT._surface.maxPan)]);
console.log('pan clamp', cl[0], '==', cl[1], cl[0]===cl[1]?'OK':'WRONG');

// presets
await p.evaluate(()=>{VT.panX=0;});
for (const [id,exp] of [['#btnMozart','1735-1835'],['#btn1776z','1746-1806'],['#btnResetZ','-3000-2026']]) {
  await p.click(id); await p.waitForTimeout(800);
  const s = await p.evaluate(()=>[Math.round(VT.d0),Math.round(VT.d1)].join('-'));
  console.log(id.padEnd(14), s, s===exp?'OK':'expected '+exp);
}
// log toggle
await p.click('#btnDeep'); const lg = await p.evaluate(()=>VT.log);
await p.click('#btnDeep'); const lg2 = await p.evaluate(()=>VT.log);
console.log('deep-time toggle', lg, '->', lg2, (lg&&!lg2)?'OK':'WRONG');
// category filter
await p.click('#catRow .chip[data-cat="war"]');
const off = await p.evaluate(()=>[...VT.off]);
console.log('category filter off =', JSON.stringify(off));
await p.click('#catRow .chip[data-cat="war"]');
// the flip button is gone for good
console.log('flip button gone:', await p.evaluate(()=>!document.querySelector('#btnFlip')&&VT.flip===undefined?'OK':'STILL THERE'));
console.log('\nerrors:', errs.length?errs.join('\n'):'none');
await b.close();
