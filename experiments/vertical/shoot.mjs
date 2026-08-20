import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT  = path.join(HERE, 'shots');
const V    = 'file://' + path.join(HERE, 'index.html');
const HORZ = 'file://' + path.join(HERE, '..', '..', 'prototypes', 'timeline-lab.html');

const errors = [];

async function setup(page){
  page.on('console', m => { if (m.type()==='error') errors.push('[console] '+m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] '+e.message));
}

// does any pair of label boxes in the same column overlap?
const OVERLAP = `(() => {
  const L = VT.boxes.filter(b=>b.k==='lab');
  let n=0, worst=null;
  for(let i=0;i<L.length;i++) for(let j=i+1;j<L.length;j++){
    const a=L[i],b=L[j];
    if(a.col!==b.col) continue;
    const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    if(ox>0&&oy>0){n++; if(!worst||oy>worst.oy) worst={a:a.ev[2],b:b.ev[2],oy};}
  }
  const types=[...new Set(VT.boxes.map(b=>b.ev[7]))].sort();
  // does any label box stray outside its own column?
  const spill = L.filter(b=>{const c=VT._cols[b.col]; return !c || b.x < c[0]-1 || b.x+b.w > c[0]+c[1]+1;}).map(b=>b.ev[2]);
  return {labels:L.length, marks:VT.boxes.length-L.length, overlaps:n, dropped:VT._dropped, spill:spill.length, worst, types};
})()`;

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:1800,height:1250}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  await setup(page);
  await page.goto(V);
  await page.waitForTimeout(400);

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.locator('.card').screenshot({ path: path.join(OUT, name+'.png') });
    const st = await page.evaluate(OVERLAP);
    console.log(name.padEnd(26), JSON.stringify(st));
  };

  const span = (a,b) => page.evaluate(([a,b])=>{VT.d0=a;VT.d1=b;VT.log=false;VT.render();}, [a,b]);

  // 1. default full span
  await span(-3000,2026);
  await shot('01-default-span');

  // 2. 1750-1800, Mozart lens on (+ music, as the preset does)
  await page.evaluate(()=>{VT.lens.MZ=true;VT.lens.MU=true;VT.syncChips();VT.d0=1750;VT.d1=1800;VT.render();});
  await shot('02-1750-1800-mozart');

  // 3. deep time / log
  await page.evaluate(()=>{VT.log=true;VT.render();});
  await shot('03-deep-time-log');

  // 4. dense region 1900-1950
  await page.evaluate(()=>{VT.log=false;VT.lens.SC=true;VT.syncChips();VT.d0=1900;VT.d1=1950;VT.render();});
  await shot('04-1900-1950-dense');

  // 5. (see the narrow-window pass below for the mid-pan shot)

  // 6. search
  await page.evaluate(()=>{VT.lens.SC=false;VT.syncChips();VT.d0=-3000;VT.d1=2026;VT.q='revolution';document.querySelector('#searchBox').value='revolution';VT.render();});
  await shot('06-search-revolution');
  await page.evaluate(()=>{VT.q='';document.querySelector('#searchBox').value='';VT.render();});

  // 7. hover crosshair + tooltip
  await page.evaluate(()=>{VT.d0=1700;VT.d1=1850;VT.render();});
  const box = await page.locator('#vertCanvas').boundingBox();
  const target = await page.evaluate(()=>{
    const b = VT.boxes.find(b=>b.k==='lab' && b.ev[2].startsWith('Wolfgang'));
    return b ? {x:b.x+30, y:b.y+b.h/2} : null;
  });
  await page.mouse.move(box.x+target.x, box.y+target.y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT,'07-hover-tooltip.png'), clip:{x:box.x,y:box.y-160,width:box.width,height:box.height+160} });
  console.log('07-hover-tooltip'.padEnd(26), JSON.stringify(await page.evaluate(OVERLAP)));
  await page.mouse.move(10,10);

  // 8. zones: Asia/Americas antiquity
  await page.evaluate(()=>{VT.lens.MU=false;VT.lens.MZ=false;VT.syncChips();VT.d0=-600;VT.d1=900;VT.render();});
  await shot('09-zones-antiquity');
  await page.evaluate(()=>{VT.lens.MZ=true;VT.syncChips();});

  // 8. mid zoom, whole-page shot for context
  await page.evaluate(()=>{VT.d0=1400;VT.d1=1700;VT.render();});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT,'08-page-1400-1700.png'), fullPage:false });
  console.log('08-page-1400-1700'.padEnd(26), JSON.stringify(await page.evaluate(OVERLAP)));

  // 11. whole page, for context
  await page.evaluate(()=>{VT.d0=1750;VT.d1=1800;VT.render();});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT,'11-whole-page.png'), fullPage:true });

  // ---- the narrow window: the case that used to truncate. 1200px, all three
  // lenses on, so the surface is far wider than the window. ----
  const nctx = await browser.newContext({ viewport:{width:1200,height:1000}, deviceScaleFactor:2 });
  const np = await nctx.newPage();
  await setup(np);
  await np.goto(V);
  await np.waitForTimeout(400);
  const nshot = async (name,f) => {
    const st = await np.evaluate((f)=>{
      VT.lens.MU=true;VT.lens.SC=true;VT.lens.MZ=true;VT.syncChips();VT.d0=1750;VT.d1=1800;
      VT.panX=0;VT.render(); VT.panX=VT._surface.maxPan*f; VT.render();
      const L=VT.boxes.filter(b=>b.k==='lab');
      const ctx=VT.cv.getContext('2d'); ctx.font='11.5px -apple-system,system-ui,sans-serif';
      const ell=L.filter(b=>wrapText(ctx,b.ev[2],b.w-10,3).some(l=>l.endsWith('…'))).length;
      return {panX:Math.round(VT.panX), maxPan:Math.round(VT._surface.maxPan),
              surface:Math.round(VT._surface.SW), window:Math.round(VT._surface.CW),
              labels:L.length, inWindow:VT._visLabels, ellipsised:ell};
    }, f);
    await np.waitForTimeout(200);
    await np.locator('.card').screenshot({ path: path.join(OUT,name+'.png') });
    console.log(name.padEnd(26), JSON.stringify(st));
  };
  await nshot('05-mid-pan-1200',0.45);
  await nshot('12-narrow-1200-left',0);
  await nshot('13-narrow-1200-right',1);

  // ---- the horizontal original, same spans, for comparison ----
  const hp = await ctx.newPage();
  hp.on('pageerror', e => errors.push('[horz pageerror] '+e.message));
  await hp.goto(HORZ);
  await hp.waitForTimeout(1500);
  await hp.evaluate(()=>{document.querySelector('nav.tabs button[data-tab="zoom"]').click();});
  await hp.waitForTimeout(400);
  const hshot = async (name,a,b,fn) => {
    await hp.evaluate(([a,b])=>{TL.log=false;TL.d0=a;TL.d1=b;TL.render();},[a,b]);
    await hp.waitForTimeout(250);
    await hp.locator('#tab-zoom .card').screenshot({ path: path.join(OUT,name+'.png') });
    const st = await hp.evaluate(`(()=>{const L=TL.boxes;let n=0;for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++){const a=L[i],b=L[j];const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);if(ox>2&&oy>2)n++;}return {boxes:L.length,overlaps:n};})()`);
    console.log(name.padEnd(26), JSON.stringify(st));
  };
  await hp.evaluate(()=>{TL.lens.MZ=true;TL.lens.MU=true;TL.syncChips();});
  await hshot('H1-default-span',-3000,2026);
  await hshot('H2-1750-1800-mozart',1750,1800);
  await hp.evaluate(()=>{TL.lens.SC=true;TL.syncChips();});
  await hshot('H4-1900-1950-dense',1900,1950);

  console.log('\n--- console/page errors ---');
  console.log(errors.length ? errors.join('\n') : 'none');
  await browser.close();
};
run().catch(e=>{console.error(e);process.exit(1);});
