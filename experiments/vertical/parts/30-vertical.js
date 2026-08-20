"use strict";
// ============================================================================
// Timeline — VERTICAL. A transposition of instrument ② (`TL`) from partB.html.
// Time runs DOWN. Past at top, always: that is the product's settled reading
// direction, so there is no flip — the core-sample view elsewhere runs the
// other way on purpose, and this one does not have to apologise for it.
//
// Verbatim from TL: THR thresholds, levelFor/alphaFor, LMAX + the log mapping,
// the band list (its numbers now weight lane counts and rail widths), the five
// shapes and their magic numbers, category colours, lens + category filters,
// search dimming, tooltip contents, presets, animTo, wheel-zoom maths.
//
// Adapted for the rotation:
//  · a horizontal label no longer eats time-axis space, so the lane packer no
//    longer budgets for it;
//  · COLUMN WIDTHS ARE DRIVEN BY CONTENT, not by the viewport. Each column asks
//    for the width its own longest visible label wants on one line, clamped to
//    [LABMIN, LABMAX]; sparse columns collapse toward the width of their own
//    header. The columns therefore sum to a SURFACE that is usually WIDER than
//    the window, and the canvas is a window onto it.
//  · the drag is two-axis: Y travels through time, X pans across the surface,
//    in one gesture. The time axis lives in a fixed gutter and the headers ride
//    the surface horizontally only, so neither is ever lost mid-drag.
// ============================================================================

// ---------- shared helpers (verbatim from partB.html) ----------
const CAT_MAP = (typeof CATMAP  !== 'undefined') ? CATMAP  : {};
const PLACES  = (typeof PLACEMAP!== 'undefined') ? PLACEMAP: {};
const $=s=>document.querySelector(s);
const tokens=()=>{const cs=getComputedStyle(document.documentElement);const g=n=>cs.getPropertyValue(n).trim();
  return {bg:g('--bg'),panel:g('--panel'),panel2:g('--panel2'),line:g('--line'),ink:g('--ink'),ink2:g('--ink2'),ink3:g('--ink3'),
  accent:g('--accent'),accent2:g('--accent2'),sea:g('--sea'),stroke:g('--stroke'),
  s:[g('--s1'),g('--s2'),g('--s3'),g('--s4'),g('--s5'),g('--s6'),g('--s7'),g('--s8')]};};
// astronomical year 0 is 1 BCE — never print "0 BCE"
const fmtY=y=>{y=Math.round(y); return y<0? (Math.abs(y)+" BCE") : (y===0? "1 BCE" : ""+y);};
const fmtBig=y=>{const a=2026-y; if(a>=1e9) return (a/1e9).toFixed(1).replace(/\.0$/,"")+" billion yrs ago";
  if(a>=1e6) return (a/1e6).toFixed(0)+" million yrs ago"; if(a>=20000) return Math.round(a/1000)+",000 yrs ago"; return fmtY(y);};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const tip=$('#tip');
function showTip(x,y,html){tip.innerHTML=html;tip.style.display='block';
  const r=tip.getBoundingClientRect();
  tip.style.left=clamp(x+14,8,innerWidth-r.width-8)+'px';
  tip.style.top=clamp(y+14,8,innerHeight-r.height-8)+'px';}
function hideTip(){tip.style.display='none';}
// same colour at a given alpha. Canvas gradients interpolate in straight RGBA,
// so fading a hex to `transparent` runs it through grey — always fade to the
// colour's own zero-alpha form instead.
function withA(c,a){
  let m=/^#([0-9a-f]{3,8})$/i.exec(c);
  if(m){let h=m[1]; if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;}
  m=/rgba?\(([^)]+)\)/.exec(c);
  if(m){const p=m[1].split(',').map(s=>s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`;}
  return c;
}
function fitCanvas(cv,h){
  const cw=cv.clientWidth||cv.parentElement.clientWidth; if(!cw)return null;
  const dpr=devicePixelRatio||1;
  if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(h*dpr)){
    cv.width=Math.round(cw*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+'px';}
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return {cw,ch:h,ctx};
}
// year pill at the cursor — rotated: sits on the left axis, vertically centred on the crosshair
function yearPillV(ctx,T,x,cy,text,accent){
  ctx.font='600 12px ui-monospace,Menlo,monospace';
  const w=ctx.measureText(text).width+14;
  ctx.fillStyle=accent||T.accent; ctx.beginPath(); ctx.roundRect(x,cy-10,w,20,10); ctx.fill();
  ctx.fillStyle=T.bg; ctx.textAlign='center'; ctx.fillText(text,x+w/2,cy+4); ctx.textAlign='left';
}

// ---------- the visual grammar (verbatim from partB.html) ----------
const CATS=[
  {id:'power',  name:'Power & states', si:0},
  {id:'war',    name:'War & conflict', si:7},
  {id:'belief', name:'Ideas & belief', si:6},
  {id:'sci',    name:'Science & tech', si:2},
  {id:'art',    name:'Art & culture',  si:4},
  {id:'nature', name:'Nature & catastrophe', si:5},
  {id:'society',name:'Society & economy', si:3},
  {id:'reach',  name:'Exploration & movement', si:1}];
const CATBY={}; CATS.forEach(c=>CATBY[c.id]=c);
const catColor=(id,T)=>{const c=CATBY[id]; return c?T.s[c.si]:T.ink2;};
function guessCat(ev){
  const t=(ev[5]+' '+ev[2]).toLowerCase();
  if(/war|battle|conquest|siege|invade|invasion|armada|crusade|revolt/.test(t))return 'war';
  if(/religio|christian|islam|buddh|philosoph|reformation|schism|communism|enlighten/.test(t))return 'belief';
  if(/science|physics|math|astronom|medicine|technolog|invention|computing|printing|space|internet|dna|electricity/.test(t))return 'sci';
  if(/music|opera|art|literature|jazz|rock|symphon|mozart|beethoven/.test(t))return 'art';
  if(/cosmos|life|extinction|plague|pandemic|volcano|earth|human|climate/.test(t))return 'nature';
  if(/exploration|migration|colony|colonialism|voyage|route/.test(t))return 'reach';
  if(/trade|economy|slavery|university|law|gold|money|independence/.test(t))return 'society';
  return 'power';
}
if(typeof LIVES!=='undefined') for(const L of LIVES) EVENTS.push(L.slice());
for(const ev of EVENTS){
  const m=CAT_MAP[ev[2]];
  ev[6]=m?m[0]:guessCat(ev);
  ev[7]=m?m[1]:(ev[1]?'episode':'moment');
  const p=PLACES[ev[2]];
  ev[8]=p||null;                     // [lat, lon, place, scope]
}

// ---------- label wrapping (only possible because labels now run across time) ----------
const LABFONT='11.5px -apple-system,system-ui,sans-serif';
const HEADFONT='600 10.5px -apple-system,system-ui,sans-serif';
const LH=13, MAXLINES=3;
const _wrapCache=new Map();
function wrapText(ctx,text,maxW,maxLines){
  const key=text+'|'+Math.round(maxW)+'|'+maxLines;
  let hit=_wrapCache.get(key); if(hit)return hit;
  const words=String(text).split(/\s+/);
  const lines=[]; let cur='', broke=false;
  for(let i=0;i<words.length;i++){
    const t=cur?cur+' '+words[i]:words[i];
    if(cur&&ctx.measureText(t).width>maxW){
      lines.push(cur); cur=words[i];
      if(lines.length===maxLines){broke=true;break;}
    } else cur=t;
  }
  if(!broke){ if(cur){ if(lines.length<maxLines) lines.push(cur); else broke=true; } }
  if(broke){
    let last=lines[lines.length-1];
    while(last.length>1&&ctx.measureText(last+'…').width>maxW) last=last.slice(0,-1);
    lines[lines.length-1]=last.replace(/[\s,;:·—-]+$/,'')+'…';
  }
  for(let k=0;k<lines.length;k++){            // a single word wider than the column
    if(ctx.measureText(lines[k]).width>maxW){
      let s=lines[k];
      while(s.length>1&&ctx.measureText(s+'…').width>maxW) s=s.slice(0,-1);
      lines[k]=s+'…';
    }
  }
  if(_wrapCache.size>4000)_wrapCache.clear();
  _wrapCache.set(key,lines); return lines;
}
// How wide does this label WANT to be? oneLineW is the ideal (a label that fits
// on one line is what makes a column read as a list rather than a paragraph);
// it is what a column bids with. Measured once per title and cached — the label
// font never changes.
const _wantCache=new Map();
function oneLineW(ctx,text){
  let hit=_wantCache.get(text); if(hit!==undefined)return hit;
  const w=Math.ceil(ctx.measureText(text).width);
  if(_wantCache.size>4000)_wantCache.clear();
  _wantCache.set(text,w); return w;
}

// ================= VERTICAL TIMELINE =================
const VT={
  cv:$('#vertCanvas'), d0:-3000,d1:2026, log:false,
  lens:{MU:false,SC:false,MZ:true}, q:'', hoverY:null, off:new Set(),
  THR:{1:Infinity,2:40000,3:2400,4:650,5:170},                       // verbatim
  // verbatim band list. The third number was the band's HEIGHT in the horizontal
  // view; rotated it still drives the lane count (and so the mark rail's width).
  bands(){ const b=[['CO','Deep time',34,null],['EU','Europe',86,0],['ME','MidEast & Africa',86,1],['AS','Asia',86,2],['AM','Americas',86,3]];
    if(this.lens.MU)b.push(['MU','Music',88,4]); if(this.lens.SC)b.push(['SC','Science & ideas',88,5]); if(this.lens.MZ)b.push(['MZ','Mozart',88,6]);
    return b;},
  span(){return this.d1-this.d0;},
  LMAX:10.2,
  GX:96, GY:44, PAD:26, MAXPUSH:64,
  // Label-column width band. LABMAX is the cap on a column's bid; it is also the
  // no-ellipsis guarantee — the widest title in the corpus needs 138px to wrap
  // into MAXLINES lines without truncation, so any column at or above that can
  // never ellipsise. Widths quantise to STEPW so a zoom does not make the
  // columns shiver.
  LABMIN:96, LABMAX:192, LABNEED:144, STEPW:16, PITCH:9,
  panX:0, H:760,
  // screen pixel for a year (past at top, monotonically increasing)
  y(t,G,Hp){ if(!this.log) return G+(t-this.d0)/this.span()*Hp;
    const ya=Math.max(2026.5-t,0.6); return G+(1-Math.log10(ya)/this.LMAX)*Hp;},
  // inverse: year at a screen pixel
  it(py,G,Hp){ if(!this.log) return this.d0+(py-G)/Hp*this.span();
    return 2026.5-Math.pow(10,(1-(py-G)/Hp)*this.LMAX);},
  levelFor(S){ if(S<=this.THR[5])return 5; if(S<=this.THR[4])return 4; if(S<=this.THR[3])return 3; if(S<=this.THR[2])return 2; return 1;},
  alphaFor(lvl,S,isLens){
    const t=this.THR[lvl]*(isLens?2.5:1); if(!isFinite(t))return 1;
    if(S<=t)return 1; if(S<=t*1.6)return 1-(S-t)/(t*.6); return 0;},
  // Is this event drawn in this column, and at what alpha? The importance ramp
  // and the off-screen cull, verbatim — factored out so the width-measuring
  // pass and the drawing pass can never disagree about what is on screen.
  // `pad` widens the window for the measuring pass only (see layout).
  alphaOf(ev,isLens,key,GY,Hp,PB,pad){
    const a=this.log ? (key==='CO'?1:(ev[4]<=2?1:0)) : this.alphaFor(ev[4],this.span(),isLens);
    if(a<=0.02)return 0;
    const p=pad||0;
    const ya=this.y(ev[0],GY,Hp), yb=ev[1]?this.y(ev[1],GY,Hp):ya;
    if(Math.max(ya,yb)<GY-40-p||Math.min(ya,yb)>PB+p)return 0;
    return a;
  },
  railWidth(bw){ const maxTracks=Math.max(1,Math.floor((bw-24)/17)); return {maxTracks,railW:10+(maxTracks-1)*this.PITCH+9};},
  measure(){
    const top=this.cv.getBoundingClientRect().top+scrollY;
    this.H=clamp(Math.round(innerHeight-top-142),460,1600);
  },
  size(){ const d=fitCanvas(this.cv,this.H); return d?{cw:d.cw,H:this.H,ctx:d.ctx}:null; },
  boxes:[],
  // ---- pass 1: what width does each column actually need? -------------------
  // A column bids the width its longest label wants on one line. Nothing here
  // looks at the viewport, and nothing looks at the search query, so typing
  // never reflows the columns — that is the whole point. It measures over a
  // window padded by a screenful of time above and below, too, so that dragging
  // through time does not make the columns breathe under your hand: the bid
  // changes when the level of detail changes, not on every frame of a drag.
  layout(ctx,bands,bandEvs,GY,Hp,PB,VW){
    const cols=[];
    for(const [key,label,bw,si] of bands){
      const {maxTracks,railW}=this.railWidth(bw);
      const isLens=['MU','SC','MZ'].includes(key);
      ctx.font=LABFONT;
      let want=0, n=0;
      for(const ev of bandEvs[key]){
        const a=this.alphaOf(ev,isLens,key,GY,Hp,PB,Hp);
        if(a<=0.25)continue;                       // no label at this alpha (verbatim rule)
        n++; const w=oneLineW(ctx,ev[2]); if(w>want)want=w;
      }
      ctx.font=HEADFONT;
      const headW=Math.ceil(ctx.measureText(label.toUpperCase()).width)+26;
      let colW, minW;
      if(!n){ colW=minW=Math.max(headW,railW+34); }   // nothing to say: get out of the way
      else {
        const labW=clamp(Math.ceil(want/this.STEPW)*this.STEPW,this.LABMIN,this.LABMAX);
        colW=Math.max(railW+12+labW,headW);
        minW=Math.max(railW+12+this.LABNEED,headW);   // below this something would truncate
      }
      cols.push({key,label,bw,si,maxTracks,railW,w:colW,min:minW,demand:n?colW:0});
    }
    // A column is ENTITLED to `min` — the width below which its labels would
    // truncate. Everything above that is appetite. So: if the window can hold
    // every entitlement, never overflow — squeeze the appetites and, if there is
    // still room, hand the leftover to the busiest columns. Only when the window
    // cannot hold the entitlements does the surface grow past it and pan.
    let SW=cols.reduce((a,c)=>a+c.w,0);
    if(SW<VW){
      const dsum=cols.reduce((a,c)=>a+c.demand,0)||SW, slack=VW-SW;
      for(const c of cols) c.w+=slack*(c.demand||(c.w*0.0001))/dsum;
    } else {
      const give=cols.reduce((a,c)=>a+(c.w-c.min),0), need=SW-VW;
      const f=Math.min(1,give?need/give:0);
      for(const c of cols) c.w-=(c.w-c.min)*f;
    }
    SW=cols.reduce((a,c)=>a+c.w,0);
    return {cols,SW};
  },
  render(){
    const dim=this.size(); if(!dim)return;
    const {cw,H,ctx}=dim; const T=tokens();
    ctx.fillStyle=T.panel; ctx.fillRect(0,0,cw,H);
    const GX=this.GX, GY=this.GY, PAD=this.PAD;
    const Hp=H-GY-PAD, PB=H-PAD;              // plot height, plot bottom
    const CW=cw-GX-8;                          // width of the WINDOW onto the surface
    const bands=this.bands();
    const q=this.q.toLowerCase();
    let hitCount=0; this._dropped=0; this.boxes=[];

    const bandEvs={};
    for(const b of bands) bandEvs[b[0]]=EVENTS.filter(e=>e[3]===b[0]&&!this.off.has(e[6])).sort((a,b)=>a[0]-b[0]);
    const {cols,SW}=this.layout(ctx,bands,bandEvs,GY,Hp,PB,CW);
    const maxPan=Math.max(0,SW-CW);
    this.panX=clamp(this.panX,0,maxPan);
    const panX=this.panX;

    // ---- era wash (verbatim thresholds; stripes are now horizontal) ----
    this._eras=[];
    if(!this.log){
      const eras=[[-800,476,'Antiquity'],[476,1453,'Middle Ages'],[1453,1789,'Early Modern'],[1789,2026,'Modern']];
      ctx.textAlign='left'; ctx.font='10px -apple-system,system-ui,sans-serif';
      for(const [a,b,n] of eras){
        let ya=this.y(a,GY,Hp), yb=this.y(b,GY,Hp);
        if(ya>yb){const t=ya;ya=yb;yb=t;}
        ya=clamp(ya,GY,PB); yb=clamp(yb,GY,PB);
        if(yb-ya<4)continue;
        ctx.fillStyle=T.accent; ctx.globalAlpha=.055; ctx.fillRect(GX,ya,CW,yb-ya);
        if(yb-ya>22){ctx.globalAlpha=.75;ctx.fillStyle=T.ink3;ctx.fillText(n,GX+6,ya+12);this._eras.push([n,ya+12]);}
        ctx.globalAlpha=1;
      }
    }

    // ---- time axis (same step table, same ≤14 rule). Lives in a fixed gutter
    // and spans the window, not the surface: panning sideways never loses it.
    ctx.strokeStyle=T.line;ctx.lineWidth=1;
    ctx.font='11px ui-monospace,Menlo,monospace'; ctx.fillStyle=T.ink2; ctx.textAlign='right';
    if(!this.log){
      const steps=[2000,1000,500,200,100,50,20,10,5,2,1];
      const step=steps.find(s=>this.span()/s<=14)||1;
      const start=Math.ceil(this.d0/step)*step;
      ctx.beginPath();
      for(let t=start;t<=this.d1;t+=step){
        const yy=this.y(t,GY,Hp);
        ctx.moveTo(GX,yy);ctx.lineTo(cw-8,yy);
        ctx.fillText(fmtY(t),GX-10,yy+4);
      }
      ctx.globalAlpha=.35;ctx.stroke();ctx.globalAlpha=1;
    } else {
      const labs=[[1e10,'10 Gya'],[1e9,'1 Gya'],[1e8,'100 Mya'],[1e7,'10 Mya'],[1e6,'1 Mya'],[1e5,'100 kya'],[1e4,'10 kya'],[1e3,'1,000 ya'],[100,'100 ya'],[10,'10 ya']];
      ctx.beginPath();
      for(const [ya,lab] of labs){
        const yy=this.y(2026.5-ya,GY,Hp);
        if(yy<GY-1||yy>PB+1)continue;
        ctx.moveTo(GX,yy);ctx.lineTo(cw-8,yy);ctx.fillText(lab,GX-10,yy+4);
      }
      ctx.globalAlpha=.35;ctx.stroke();ctx.globalAlpha=1;
    }
    ctx.textAlign='left';
    const yn=this.y(2026,GY,Hp);
    if(yn>=GY&&yn<=PB){ctx.strokeStyle=T.accent2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(GX,yn);ctx.lineTo(cw-8,yn);ctx.stroke();ctx.setLineDash([]);}

    const baseL=this.log?2:this.levelFor(this.span());

    // ---- columns. The surface is drawn at -panX and clipped to the window, so
    // nothing ever paints over the time-axis gutter.
    ctx.save(); ctx.beginPath(); ctx.rect(GX,0,CW,PB); ctx.clip();
    let cx=GX-panX; this._cols={}; this._colList=[];
    for(const C of cols){
      const {key,label,si,maxTracks,railW}=C, colW=C.w;
      this._cols[key]=[cx,colW]; this._colList.push({key,label,si,x:cx,w:colW});
      ctx.strokeStyle=T.line;ctx.globalAlpha=.8;ctx.beginPath();
      ctx.moveTo(cx+colW,GY-26);ctx.lineTo(cx+colW,PB);ctx.stroke();ctx.globalAlpha=1;
      ctx.fillStyle=si===null?T.accent:T.s[si];ctx.beginPath();ctx.arc(cx+8,GY-20,4,0,7);ctx.fill();
      ctx.fillStyle=T.ink2;ctx.font=HEADFONT;ctx.textAlign='left';
      ctx.fillText(label.toUpperCase(),cx+18,GY-16);

      const isLens=['MU','SC','MZ'].includes(key);
      const evs=bandEvs[key];
      const PITCH=this.PITCH;
      const labX=cx+railW+4, labW=Math.max(46,colW-railW-12);
      const trackEnd=new Array(maxTracks).fill(-1e18);
      const labels=[];
      ctx.save(); ctx.beginPath(); ctx.rect(cx,GY,colW,Hp); ctx.clip();
      ctx.font=LABFONT;

      for(const ev of evs){
        const [y0,y1,title,,lvl]=ev; const cat=ev[6], typ=ev[7];
        let a=this.alphaOf(ev,isLens,key,GY,Hp,PB);
        if(!a)continue;
        const ya=this.y(y0,GY,Hp), yb=y1?this.y(y1,GY,Hp):ya;
        const top=Math.min(ya,yb), bot=Math.max(ya,yb);
        const isMatch=q&&((title.toLowerCase().includes(q))||ev[5].includes(q));
        if(q){ if(isMatch){hitCount++;} else a*=.12; }
        const col=catColor(cat,T);

        // lane packing, in time-pixels. No label width in the budget any more —
        // that whole term is what the rotation buys us.
        let track=trackEnd.findIndex(te=>te<top-4);
        if(track<0){track=0;let m=1e18;trackEnd.forEach((te,i)=>{if(te<m){m=te;track=i;}});}
        trackEnd[track]=Math.max(trackEnd[track],bot+8);
        const mx=cx+10+track*PITCH;

        const ct=Math.max(top,GY-30), cb=Math.min(bot,PB+30), clen=Math.max(cb-ct,6);
        ctx.globalAlpha=a; ctx.fillStyle=col; ctx.strokeStyle=col;
        if(typ==='era'){                                    // translucent swath, full column
          ctx.globalAlpha=a*.22; ctx.fillRect(cx+2,ct,colW-4,clen);
          ctx.globalAlpha=a*.9;  ctx.fillRect(mx-1,ct,2,clen);
        } else if(typ==='zone'){                            // thick tapered ribbon
          const th=Math.max(5,12-lvl*1.2), cap=Math.min(9,clen*.28);
          ctx.beginPath();
          ctx.moveTo(mx,ct); ctx.lineTo(mx-th/2,ct+cap);
          ctx.lineTo(mx-th/2,ct+clen-cap); ctx.lineTo(mx,ct+clen);
          ctx.lineTo(mx+th/2,ct+clen-cap); ctx.lineTo(mx+th/2,ct+cap);
          ctx.closePath(); ctx.fill();
        } else if(typ==='life'){                            // capsule + birth dot + death cap
          ctx.globalAlpha=a*.55; ctx.beginPath(); ctx.roundRect(mx-3.5,ct,7,clen,3.5); ctx.fill();
          ctx.globalAlpha=a;
          if(ya>GY-8&&ya<PB+8){ctx.beginPath(); ctx.arc(mx,ya,3.4,0,7); ctx.fill();}
          if(y1&&yb>GY-8&&yb<PB+8){ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(mx-5,yb); ctx.lineTo(mx+5,yb); ctx.stroke();}
        } else if(y1||typ==='episode'){                     // bar
          ctx.beginPath(); ctx.roundRect(mx-4,ct,8,clen,4); ctx.fill();
        } else {                                            // moment — a quiet point
          ctx.beginPath(); ctx.arc(mx,ya,3.2,0,7); ctx.fill();
        }
        ctx.globalAlpha=1;
        this.boxes.push({k:'mark',x:mx-8,y:ct-5,w:16,h:clen+10,ev,band:label});

        // anchor: the point the label belongs to. Durations use the midpoint of
        // their *visible* stretch so an era running off both ends keeps its name.
        const vt=Math.max(top,GY+2), vb=Math.min(bot,PB-2);
        const anchor=clamp(y1?(vt+vb)/2:ya,GY+2,PB-2);
        if(a>0.25){
          const lines=wrapText(ctx,title,labW,MAXLINES);
          labels.push({anchor,h:lines.length*LH,lines,a,col,mx,lvl,ev,isMatch});
        } else if(isMatch){
          ctx.globalAlpha=1;ctx.strokeStyle=T.accent2;ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(mx,anchor,7,0,7);ctx.stroke();ctx.globalAlpha=1;
        }
      }

      // ---- label placement. Most-important-first into the nearest free slot.
      // Replaces the horizontal view's lane budgeting + left/right edge flipping.
      const GAP=4, MAXPUSH=this.MAXPUSH, slots=[];
      labels.sort((A,B)=>A.lvl-B.lvl||A.anchor-B.anchor);
      for(const L of labels){
        const bh=L.h+GAP, want=L.anchor-bh/2;
        let put=null;
        for(let d=0;d<=MAXPUSH&&put===null;d+=3){
          for(const t of (d===0?[want]:[want+d,want-d])){
            if(t<GY+2||t+bh>PB-2)continue;
            let ok=true;
            for(const s of slots){ if(t<s[1]&&t+bh>s[0]){ok=false;break;} }
            if(ok){put=t;break;}
          }
        }
        if(put===null){L.drop=true;this._dropped++;continue;}
        L.y=put+GAP/2; slots.push([put,put+bh]);
      }
      ctx.font=LABFONT; ctx.textAlign='left';
      for(const L of labels){
        if(L.drop)continue;
        const cy=L.y+L.h/2;
        if(Math.abs(cy-L.anchor)>3){                 // leader hairline back to the true year
          ctx.globalAlpha=L.a*.45; ctx.strokeStyle=L.col; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(L.mx+6,L.anchor); ctx.lineTo(labX-4,cy); ctx.stroke();
        }
        if(L.isMatch){
          ctx.globalAlpha=1;ctx.strokeStyle=T.accent2;ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(L.mx,L.anchor,7,0,7);ctx.stroke();
        }
        ctx.globalAlpha=L.a; ctx.fillStyle=T.ink;
        for(let k=0;k<L.lines.length;k++) ctx.fillText(L.lines[k],labX,L.y+10+k*LH);
        ctx.globalAlpha=1;
        this.boxes.push({k:'lab',x:labX-6,y:L.y-2,w:labW+10,h:L.h+4,ev:L.ev,band:label,col:key});
      }
      ctx.restore();
      cx+=colW;
    }
    ctx.restore();
    // hit-testing works on the visible slice of each box, so a mark half-scrolled
    // under the axis gutter cannot be clicked through it
    let visLabels=0;
    for(const b of this.boxes){
      const x0=Math.max(b.x,GX), x1=Math.min(b.x+b.w,cw-8);
      b.vx=x0; b.vw=x1-x0;
      if(b.k==='lab'&&b.vw>b.w*0.6)visLabels++;
    }
    this._visLabels=visLabels;

    // ---- "there is more over here" ------------------------------------------
    this._surface={SW,CW,panX,maxPan};
    this.edgeHints(ctx,T,cw,GX,GY,PB,CW,panX,maxPan);
    if(panX>0.5){    // era names are viewport furniture, not surface — the fade must not eat them
      ctx.font='10px -apple-system,system-ui,sans-serif'; ctx.textAlign='left';
      ctx.globalAlpha=.75; ctx.fillStyle=T.ink3;
      for(const [n,yy] of this._eras) ctx.fillText(n,GX+6,yy);
      ctx.globalAlpha=1;
    }
    this.panRail(ctx,T,cw,GX,PB,H,CW,SW,panX);

    // ---- hover crosshair + year readout ----
    if(this.hoverY!==null&&this.hoverY>GY&&this.hoverY<PB){
      const yr=this.it(this.hoverY,GY,Hp);
      ctx.strokeStyle=T.accent;ctx.globalAlpha=.55;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(GX,this.hoverY);ctx.lineTo(cw-8,this.hoverY);ctx.stroke();
      ctx.globalAlpha=1;
      yearPillV(ctx,T,4,this.hoverY,this.log?fmtBig(yr):fmtY(yr));
    }
    $('#zoomReadout').textContent=this.log?'log scale · Big Bang → now':
      `showing importance ≤ ${baseL} of 5 · span ${Math.round(this.span()).toLocaleString()} yrs`;
    $('#searchCnt').textContent=q?`${hitCount} hits`:'';
  },
  // Fade the columns out against the panel at whichever edge has more surface
  // behind it, and name the next column that way. The fade says "this is cut
  // off"; the pill says what you would get for dragging.
  edgeHints(ctx,T,cw,GX,GY,PB,CW,panX,maxPan){
    const R=cw-8, FW=58;
    this._pills=[];
    // The chip sits above the header row, where it can never cover a header or a
    // label, and it is a control as well as a hint: click it and the named column
    // slides in.
    const pill=(x,text,dir,to,col)=>{
      ctx.font='600 10.5px -apple-system,system-ui,sans-serif';
      const label=dir<0?'‹  '+text:text+'  ›';
      const w=ctx.measureText(label).width+20, h=18, y=1, px=dir<0?x:x-w;
      ctx.globalAlpha=1; ctx.fillStyle=T.accent;
      ctx.beginPath(); ctx.roundRect(px,y,w,h,9); ctx.fill();
      ctx.fillStyle=T.bg; ctx.textAlign='left'; ctx.fillText(label,px+10,y+12.5);
      this._pills.push({x:px,y,w,h,to,col});
    };
    const fade=(side)=>{
      const x0=side<0?GX:R, x1=side<0?GX+FW:R-FW;
      const g=ctx.createLinearGradient(x0,0,x1,0);
      // opaque for the first third, so text is gone before the hard cut rather
      // than being sliced mid-word
      g.addColorStop(0,withA(T.panel,1)); g.addColorStop(.3,withA(T.panel,1));
      g.addColorStop(.62,withA(T.panel,.62)); g.addColorStop(1,withA(T.panel,0));
      ctx.fillStyle=g; ctx.fillRect(Math.min(x0,x1),GY-30,FW,PB-GY+30);
      ctx.strokeStyle=T.line; ctx.globalAlpha=.9; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x0+(side<0?.5:-.5),GY-30); ctx.lineTo(x0+(side<0?.5:-.5),PB); ctx.stroke();
      ctx.globalAlpha=1;
    };
    // "off screen" means too little of it is left to read, not literally zero —
    // an 18px sliver under the fade is not a column you can see.
    const READ=72, surfX=c=>c.x+panX-GX;
    if(panX>0.5){
      fade(-1);
      const off=this._colList.filter(c=>c.x+c.w<=GX+READ), h=off[off.length-1];
      if(h) pill(GX+6,h.label+(off.length>1?'  +'+(off.length-1):''),-1,surfX(h),h['key']);
    }
    if(panX<maxPan-0.5){
      fade(1);
      const off=this._colList.filter(c=>c.x>=R-READ), h=off[0];
      // the shortest pan that brings the named column fully into view — not a
      // jump to the far end, so you keep your bearings
      if(h) pill(R-6,h.label+(off.length>1?'  +'+(off.length-1):''),1,surfX(h)+h.w-CW,h['key']);
    }
  },
  // A scrollbar that is also a map: every column as a block, in its own colour,
  // with the window drawn over it. It reads as "you are here, that is the whole
  // of it" even when nothing is hidden.
  panRail(ctx,T,cw,GX,PB,H,CW,SW,panX){
    const y0=PB+7, h=12, tw=CW, k=tw/SW;
    this._rail={y0,y1:y0+h,k,SW};
    ctx.fillStyle=T.panel2; ctx.globalAlpha=.9;
    ctx.beginPath(); ctx.roundRect(GX,y0,tw,h,6); ctx.fill(); ctx.globalAlpha=1;
    ctx.save(); ctx.beginPath(); ctx.roundRect(GX,y0,tw,h,6); ctx.clip();
    let sx=0;
    for(const c of this._colList){
      const bx=GX+sx*k, bw=Math.max(1,c.w*k-1.5);
      ctx.fillStyle=c.si===null?T.accent:T.s[c.si]; ctx.globalAlpha=.32;
      ctx.fillRect(bx,y0,bw,h); ctx.globalAlpha=1;
      ctx.font='600 8px -apple-system,system-ui,sans-serif'; ctx.textAlign='center';
      const nm=c.label.toUpperCase();
      if(ctx.measureText(nm).width<bw-8){ctx.fillStyle=T.ink3;ctx.fillText(nm,bx+bw/2,y0+8.5);}
      sx+=c.w;
    }
    ctx.restore();
    ctx.textAlign='left';
    const thx=GX+panX*k, thw=Math.max(18,CW*k);
    ctx.fillStyle=T.ink; ctx.globalAlpha=.09;
    ctx.beginPath(); ctx.roundRect(thx,y0-2,thw,h+4,7); ctx.fill(); ctx.globalAlpha=1;
    ctx.strokeStyle=T.accent; ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect(thx+1,y0-1,thw-2,h+2,7); ctx.stroke();
    if(thw<CW-1){                       // grips, so the frame reads as draggable
      ctx.strokeStyle=T.accent; ctx.lineWidth=1.2; ctx.globalAlpha=.85; ctx.beginPath();
      for(const gx of [thx+5,thx+thw-5]){ctx.moveTo(gx,y0+3);ctx.lineTo(gx,y0+h-3);}
      ctx.stroke(); ctx.globalAlpha=1;
    }
  },
  hit(mx,my){ return this.boxes.findLast(b=>b.vw>0&&mx>=b.vx&&mx<=b.vx+b.vw&&my>=b.y&&my<=b.y+b.h); },
  animTo(a,b){                                        // verbatim
    if(reduceMotion){this.d0=a;this.d1=b;this.render();return;}
    const A0=this.d0,B0=this.d1,t0=performance.now();
    const step=t=>{const p=clamp((t-t0)/650,0,1),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
      this.d0=A0+(a-A0)*e; this.d1=B0+(b-B0)*e; this.render();
      if(p<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  },
  panTo(x){ this.panX=x; this.render(); },
  pillAt(mx,my){ return (this._pills||[]).find(p=>mx>=p.x&&mx<=p.x+p.w&&my>=p.y-2&&my<=p.y+p.h+2); },
  panAnim(to){
    to=clamp(to,0,this._surface.maxPan);
    if(reduceMotion){this.panTo(to);return;}
    const A=this.panX,t0=performance.now();
    const step=t=>{const p=clamp((t-t0)/380,0,1),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
      this.panX=A+(to-A)*e; this.render(); if(p<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  },
  init(){
    const cv=this.cv;
    $('#btnMozart').addEventListener('click',()=>{this.log=false;this.lens.MZ=true;this.lens.MU=true;
      this.syncChips();this.animTo(1735,1835);});
    $('#btn1776z').addEventListener('click',()=>{this.log=false;this.animTo(1746,1806);});
    $('#btnDeep').addEventListener('click',()=>{this.log=!this.log;this.render();});
    $('#btnResetZ').addEventListener('click',()=>{this.log=false;this.panX=0;this.animTo(-3000,2026);});
    $('#searchBox').addEventListener('input',e=>{this.q=e.target.value.trim();this.render();});
    document.querySelectorAll('#lensRow .chip').forEach(ch=>ch.addEventListener('click',()=>{
      const k=ch.dataset.lens; this.lens[k]=!this.lens[k]; ch.classList.toggle('on',this.lens[k]); this.render();}));
    const row=$('#catRow');
    for(const c of CATS){
      const b=document.createElement('button'); b.className='chip on'; b.dataset.cat=c.id;
      b.innerHTML=`<span class="dot" style="background:var(--s${c.si+1})"></span>${c.name}`;
      b.addEventListener('click',()=>{
        if(this.off.has(c.id)){this.off.delete(c.id);b.classList.add('on');}
        else {this.off.add(c.id);b.classList.remove('on');}
        this.render();});
      row.appendChild(b);
    }
    buildGrammarLegend();
    // Wheel stays what it was: time zoom. Sideways travel is on shift+wheel and
    // on an unambiguously horizontal trackpad swipe, so it never fights the zoom.
    cv.addEventListener('wheel',e=>{e.preventDefault();
      const sideways=e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)*2;
      if(sideways){ const d=(e.shiftKey&&Math.abs(e.deltaX)<Math.abs(e.deltaY))?e.deltaY:e.deltaX;
        this.panX+=d; this.render(); return; }
      if(this.log)return;
      const r=cv.getBoundingClientRect(); const Hp=this.H-this.GY-this.PAD;
      const tc=this.it(e.clientY-r.top,this.GY,Hp);
      const f=Math.pow(1.0018,e.deltaY); let s=clamp(this.span()*f,8,80000);
      const frac=(tc-this.d0)/this.span();
      this.d0=tc-frac*s; this.d1=this.d0+s; this.render();
    },{passive:false});
    let drag=null;
    const onRail=my=>this._rail&&my>=this._rail.y0-5&&my<=this._rail.y1+5;
    cv.addEventListener('pointerdown',e=>{
      const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      cv.setPointerCapture(e.pointerId);
      const pl=this.pillAt(mx,my);
      if(pl){ drag={rail:true,moved:true}; this.panAnim(pl.to); return; }
      if(onRail(my)){                       // grab the map: centre the window on the click
        drag={rail:true,moved:true};
        this.panTo((mx-this.GX)/this._rail.k-this._surface.CW/2); return;
      }
      drag={x:e.clientX,y:e.clientY,d0:this.d0,d1:this.d1,panX:this.panX,moved:false};
      cv.style.cursor='grabbing';
    });
    cv.addEventListener('pointermove',e=>{
      const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      this.hoverY=my;
      if(drag&&drag.rail){ this.panTo((mx-this.GX)/this._rail.k-this._surface.CW/2); return; }
      if(drag){
        // one gesture, both axes: Y travels through time, X pans the surface
        const Hp=this.H-this.GY-this.PAD;
        const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
        if(Math.abs(dx)>3||Math.abs(dy)>3)drag.moved=true;
        this.panX=drag.panX-dx;
        if(!this.log){ const dt=dy/Hp*(drag.d1-drag.d0);
          this.d0=drag.d0-dt; this.d1=drag.d1-dt; }
        this.render(); return;   // keep the crosshair: the year readout is the anchor while travelling
      }
      const b=this.hit(mx,my);
      this.render();
      if(onRail(my)||this.pillAt(mx,my)){hideTip();cv.style.cursor='pointer';return;}
      if(b){const [y0,y1,t,,lvl,tags]=b.ev; const cat=CATBY[b.ev[6]], typ=b.ev[7], pl=b.ev[8];
        showTip(e.clientX,e.clientY,`<div class=t>${t}</div><div class=m>${fmtBig(y0)}${y1?' – '+fmtY(y1):''} · ${b.band}</div>`+
          `<div class=m>${cat?cat.name:''} · ${typ}${pl?' · '+pl[2]:''}</div>`+
          `<div class=m>importance ${'●'.repeat(6-lvl)}${'○'.repeat(lvl-1)} (${lvl}) · click → Wikipedia</div>`);
        cv.style.cursor='pointer';
      } else {hideTip();cv.style.cursor='grab';}
    });
    cv.addEventListener('pointerup',e=>{
      const wasDrag=drag&&drag.moved; drag=null; cv.style.cursor='grab'; if(wasDrag)return;
      const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      const b=this.hit(mx,my);
      if(b){const t=b.ev[2].split(/ — | \(|·/)[0];
        window.open('https://en.wikipedia.org/wiki/Special:Search?search='+encodeURIComponent(t),'_blank');}
    });
    cv.addEventListener('pointerleave',()=>{hideTip();this.hoverY=null;this.render();});
    this.syncChips(); this.measure();
  },
  syncChips(){document.querySelectorAll('#lensRow .chip').forEach(ch=>ch.classList.toggle('on',this.lens[ch.dataset.lens]));}
};
// same legend, glyphs rotated a quarter turn to match what's on the canvas
function buildGrammarLegend(){
  const row=$('#grammarRow'); if(!row)return;
  const g=(svg,label)=>`<span class="g"><svg width="14" height="30" viewBox="0 0 14 30">${svg}</svg>${label}</span>`;
  const c='var(--ink2)';
  row.innerHTML=`<span class="note" style="font-weight:600">Shape =</span>`+
    g(`<circle cx="7" cy="15" r="3.2" fill="${c}"/>`,'moment')+
    g(`<rect x="3" y="3" width="8" height="24" rx="4" fill="${c}"/>`,'episode')+
    g(`<rect x="3.5" y="4" width="7" height="22" rx="3.5" fill="${c}" opacity=".55"/><circle cx="7" cy="4" r="3.2" fill="${c}"/><rect x="2" y="25" width="10" height="2" fill="${c}"/>`,'a life')+
    g(`<path d="M7 2 L2.5 7 L2.5 23 L7 28 L11.5 23 L11.5 7 Z" fill="${c}"/>`,'territory')+
    g(`<rect x="1" y="2" width="12" height="26" fill="${c}" opacity=".22"/><rect x="6" y="2" width="2" height="26" fill="${c}"/>`,'era')+
    `<span class="note" style="font-weight:600;margin-left:6px">Color = domain</span>`;
}

VT.init(); VT.measure(); VT.render();
addEventListener('resize',()=>{VT.measure();VT.render();});
window.VT=VT;
