import * as THREE from 'three';
import { SlabBuilder, OutlineBuilder } from './geometry/slabs.js';
import { buildSovereignVolumes } from './geometry/solid.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CubeControls } from './nav/CubeControls.js';

// ───────────────────────────────────────────────────────── frame of reference
const SX = 1, SY = 1;          // 1 world unit == 1 degree
const H = 300;                 // height of the time axis, world units
const SLAB = 6;                // slab thickness (the "weight" of a map sheet)
const LON0 = -180, LON1 = 180, LAT0 = -90, LAT1 = 90;

const COL = {
  ghost: 0x8098ba, ghostLine: 0x92a9c6, frame: 0x33415a,
  empire: 0xef8c33, empireLine: 0xffd08a, ink: 0x9fb0c6
};

/**
 * REGIONS, in the order the trace list is grouped.
 * The polity table tags AF separately even though those rows live in the ME
 * and AM files.
 */
const REGION = { EU: 'Europe', ME: 'Middle East', AF: 'Africa', AS: 'Asia', AM: 'Americas & Oceania' };


// ───────────────────────────────────────────────────────────────── state
const S = {
  polity: 'roman-republic',
  lineage: 3,            // 0 = this polity only; n = follow n links of ancestry AND descent
  mode: 'lofted',        // lofted | prisms | off
  ghost: 0.16,
  spacing: 'even',       // even | true
  res: 'normal',         // draft | normal | fine
  outlines: false,
  ghostLines: true,
  cutLo: 0, cutHi: 1,    // the time cut, as fractions of the block height
  caps: true,            // stencil-capped cross-sections at the cut
  slice: false,          // single-snapshot mode
  sliceI: 0,
  slicePlay: false,
  proj: 'persp'          // persp | ortho
};

const stage = document.getElementById('stage');
const busy = document.getElementById('busy');

// `stencil: true` is not the three.js default and the capped time cut needs it.
// ?stencil=0 turns it off (and with it the caps) so the cost can be measured.
const WANT_STENCIL = new URLSearchParams(location.search).get('stencil') !== '0';
if (!WANT_STENCIL) S.caps = false;      // no stencil buffer, no cap pass
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: WANT_STENCIL, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.localClippingEnabled = true;
// filmic rolloff: with five lights on a saturated amber solid, plain linear
// clamping blows the highlights to white and the volume stops reading as 3-D
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
/**
 * TWO CAMERAS, one view state. A 42-degree perspective fans the 18 slices
 * outward: from the top the world map is a splayed pile and columns lean.
 * Orthographic fixes exactly that — parallel projection keeps every slice at
 * the same scale and every vertical column vertical, which is what you want
 * for reading the block as a diagram. CubeControls.useCamera() swaps them
 * without changing what is on screen.
 */
const ORTHO_H = 600;                       // base frustum height, world units
const perspCam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 6000);
const orthoCam = new THREE.OrthographicCamera(
  -ORTHO_H * (innerWidth / innerHeight) / 2, ORTHO_H * (innerWidth / innerHeight) / 2,
  ORTHO_H / 2, -ORTHO_H / 2, -900, 6000);
let camera = perspCam;

scene.add(new THREE.AmbientLight(0xffffff, 0.16));
const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x241a10, 0.7); scene.add(hemi);

/**
 * Camera-relative three-point rig. A world-fixed key light means that from some
 * orbit angles it sits right behind the camera and the solid flattens into a
 * flash-photo decal. Keeping key / fill / rim at fixed angles *relative to the
 * view* guarantees the same readable modelling from every direction — the same
 * trick CAD viewers use.
 */
const key = new THREE.DirectionalLight(0xfff1dc, 2.1); scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x86b0ff, 0.75); scene.add(fill, fill.target);
const rim = new THREE.DirectionalLight(0xffe0b0, 1.05); scene.add(rim, rim.target);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 0, 1), _l = new THREE.Vector3();
function relightForCamera(target) {
  camera.getWorldDirection(_f);
  _r.crossVectors(_f, _u).normalize();
  const place = (light, a, b, c) => {
    _l.set(0, 0, 0).addScaledVector(_f, a).addScaledVector(_r, b).addScaledVector(_u, c).normalize();
    light.position.copy(target).addScaledVector(_l, -900);
    light.target.position.copy(target);
    light.target.updateMatrixWorld();
  };
  place(key,  0.55, -0.70,  0.45);   // upper left, 45deg off the view axis
  place(fill, 0.40,  0.85, -0.25);   // lower right, cool
  place(rim, -0.85,  0.20,  0.45);   // behind the subject, warm edge
}

// image-based lighting: soft directional variation across curved surfaces, which
// is what actually makes a smooth volume read as a volume rather than a decal
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = 0.26;
  pmrem.dispose();
}

/**
 * THE TIME CUT is a RANGE, so an arbitrary era can be isolated: a lower plane
 * that keeps z >= zLo and an upper plane that keeps z <= zHi.
 *
 * These are MATERIAL clipping planes, not renderer.clippingPlanes. Global
 * planes are unioned into every material, which would also clip the stencil
 * cap pass and there would be no cap. Per-material clipping lets the cap
 * quad for one plane be clipped by the *other* plane only.
 */
const planeLo = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e5);    // keep z >= zLo  (constant = -zLo)
const planeHi = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5);   // keep z <= zHi  (constant =  zHi)
const CLIP = [planeLo, planeHi];

// ───────────────────────────────────────────────────────────────── load data
busy.classList.add('on'); busy.textContent = 'loading world…';
const [DATA, PDATA] = await Promise.all([
  fetch('/world-block.json').then(r => r.json()),
  fetch('/polities.json').then(r => r.json())
]);
const YEARS = DATA.years;
const NY = YEARS.length;

/**
 * THE POLITY LAYER — 147 curated polities with stable ids and a lineage graph,
 * joined at build time onto the free-text sovereign strings in worlds.js
 * (see scripts/build-polities.mjs). `p.match` is {snapshotYear: [strings]},
 * which is what makes a state traceable across snapshots where the map's own
 * label changed: Rome / Roman Empire / Eastern Roman Empire / Byzantine Empire
 * are four strings and one column.
 */
const POL = PDATA.polities;
const polById = new Map(POL.map(p => [p.id, p]));

/**
 * A lineage is DIRECTED: ancestors are reached only through `from`, successors
 * only through `to`. Walking undirected would hop sideways off a fork and drag
 * in half the graph (Rome's undirected 2-hop neighbourhood is 13 polities and
 * its full closure is 79). Directed and depth-limited, Rome at 3 hops is the
 * chain you actually want: Republic -> Empire -> {West, Byzantium} -> Ottoman.
 */
function lineageOf(id, depth) {
  const seen = new Set([id]);
  if (!polById.has(id) || depth <= 0) return [...seen];
  for (const key of ['to', 'from']) {
    let front = [id];
    for (let k = 0; k < depth && front.length; k++) {
      const next = [];
      for (const c of front) for (const n of (polById.get(c)?.[key] ?? [])) if (!seen.has(n)) { seen.add(n); next.push(n); }
      front = next;
    }
  }
  return [...seen];
}

/** the polities currently being traced, ordered oldest-first */
function tracedIds() {
  return lineageOf(S.polity, S.lineage)
    .filter(id => polById.has(id))
    .sort((a, b) => polById.get(a).start - polById.get(b).start);
}

const zEven = YEARS.map((_, i) => -H / 2 + (i / (NY - 1)) * H);
const y0 = YEARS[0], y1 = YEARS[NY - 1];
const zTrue = YEARS.map(y => -H / 2 + ((y - y0) / (y1 - y0)) * H);
const zc = () => (S.spacing === 'even' ? zEven : zTrue);

const fmtY = (y) => (y < 0 ? `${-y} BC` : y === 0 ? '1 AD' : `${y} AD`);

// ─────────────────────────────────────────────────────────── ghost land mass
busy.textContent = 'extruding world…';
await new Promise(r => setTimeout(r, 0));

const ghostGroup = new THREE.Group();     // slabs
const ghostLineGroup = new THREE.Group(); // coastlines
scene.add(ghostGroup, ghostLineGroup);

/**
 * Near-camera fade. The block is 300 units tall and you fly *into* it; without
 * this, the slabs between you and whatever you flew in to look at pile up into
 * an opaque milk fog. Fading anything within ~`near` world units of the eye
 * means the stack opens up as you approach, exactly like haze in Google Earth.
 */
const FADE = { near: { value: 55 }, far: { value: 300 } };
function nearFade(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeNear = FADE.near;
    sh.uniforms.uFadeFar = FADE.far;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeD;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeD = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFadeNear;\nuniform float uFadeFar;\nvarying float vFadeD;')
      // NB: an early `if (alpha < eps) discard;` was tried here and measured
      // ~3x SLOWER on Apple Silicon — a discard disables the tile-based GPU's
      // early-Z, which costs far more than the blending it avoids.
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= smoothstep(uFadeNear, uFadeFar, vFadeD);');
  };
  mat.customProgramCacheKey = () => 'nearFade';
  return mat;
}

// FrontSide, not DoubleSide: the winding is guaranteed outward, so front faces
// are all we ever need — and a transparent DoubleSide material costs three.js a
// second full draw pass per object (it renders back faces then front faces).
const ghostMat = nearFade(new THREE.MeshLambertMaterial({
  color: COL.ghost, transparent: true, opacity: S.ghost,
  depthWrite: true, side: THREE.FrontSide,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 6
}));
// the outgoing snapshot during a single-slice cross-fade, so two sheets can
// hold two different opacities at once
const ghostFadeMat = nearFade(ghostMat.clone());
const ghostLineMat = nearFade(new THREE.LineBasicMaterial({
  color: COL.ghostLine, transparent: true, opacity: 0.22, depthWrite: false
}));

/**
 * Each year is built as CHUNKS (4 longitude bands x 2 latitude bands) rather
 * than one merged mesh for the whole world. Merging everything would be a
 * single draw call, but a world-sized bounding sphere is never frustum-culled,
 * so once you fly inside the block all eighteen full-screen transparent sheets
 * are still rasterised even when only a corner of each is on screen — and this
 * scene is fill-rate bound, not draw-call bound.
 */
const CHUNK_X = 4, CHUNK_Y = 2;
const chunkOf = (bb) => {
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const ix = Math.min(CHUNK_X - 1, Math.max(0, Math.floor((cx - LON0) / (360 / CHUNK_X))));
  const iy = Math.min(CHUNK_Y - 1, Math.max(0, Math.floor((cy - LAT0) / (180 / CHUNK_Y))));
  return ix + iy * CHUNK_X;
};

let GHOST_TRIS = 0, GHOST_VERTS = 0;
const tBuild = performance.now();
const yearGroups = [];
const NC = CHUNK_X * CHUNK_Y;
for (let i = 0; i < NY; i++) {
  const feats = DATA.byYear[YEARS[i]];
  const sbs = Array.from({ length: NC }, () => new SlabBuilder());
  const obs = Array.from({ length: NC }, () => new OutlineBuilder());
  for (const f of feats) {
    const c = chunkOf(f.bb);
    for (const p of f.p) {
      sbs[c].addPolygon(p, -SLAB / 2, SLAB / 2, SX, SY);
      obs[c].addPolygon(p, SLAB / 2 + 0.05, SX, SY);
    }
  }
  const g = new THREE.Group(), gl = new THREE.Group();
  for (let c = 0; c < NC; c++) {
    if (sbs[c].isEmpty()) continue;
    GHOST_TRIS += sbs[c].tris; GHOST_VERTS += sbs[c].v;
    const m = new THREE.Mesh(sbs[c].toBufferGeometry(THREE), ghostMat);
    m.userData.pickable = true; m.renderOrder = 2; g.add(m);
    const l = new THREE.LineSegments(obs[c].toBufferGeometry(THREE), ghostLineMat);
    l.userData.pickable = false; l.renderOrder = 3; gl.add(l);
  }
  ghostGroup.add(g); ghostLineGroup.add(gl); yearGroups.push([g, gl]);
}
const GHOST_MS = Math.round(performance.now() - tBuild);

function layoutSlices() {
  const z = zc();
  BANDS.zc.value.set(z); BANDS.n.value = Math.min(32, z.length);
  for (let i = 0; i < NY; i++) { yearGroups[i][0].position.z = z[i]; yearGroups[i][1].position.z = z[i]; }
  layoutLabels();
}

// ──────────────────────────────────────────────────────── block frame + axis
const frameGroup = new THREE.Group(); scene.add(frameGroup);
const frameMat = new THREE.LineBasicMaterial({ color: COL.frame, transparent: true, opacity: 0.85 });
{
  const zb = -H / 2 - SLAB, zt = H / 2 + SLAB;
  const c = [[LON0, LAT0], [LON1, LAT0], [LON1, LAT1], [LON0, LAT1]];
  const pts = [];
  for (const zz of [zb, zt]) for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    pts.push(a[0] * SX, a[1] * SY, zz, b[0] * SX, b[1] * SY, zz);
  }
  for (const p of c) pts.push(p[0] * SX, p[1] * SY, zb, p[0] * SX, p[1] * SY, zt);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const ls = new THREE.LineSegments(g, frameMat); ls.userData.pickable = false;
  frameGroup.add(ls);
}

// year ticks + labels ---------------------------------------------------------
function makeLabel(text, { color = '#c9d4e3', size = 34, bold = 500, pad = 8 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${bold} ${size}px ui-monospace, Menlo, monospace`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.font = font; x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.scale.set(w * 0.34, h * 0.34, 1);
  sp.userData.pickable = false;
  sp.renderOrder = 900;
  return sp;
}

const labelGroup = new THREE.Group(); scene.add(labelGroup);
const yearLabels = YEARS.map(y => { const s = makeLabel(fmtY(y), { color: '#7d8ea6', size: 30 }); labelGroup.add(s); return s; });
const tickGeo = new THREE.BufferGeometry();
const tickLine = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: COL.frame }));
tickLine.userData.pickable = false; frameGroup.add(tickLine);

function layoutLabels() {
  const z = zc();
  const pts = [];
  for (let i = 0; i < NY; i++) {
    yearLabels[i].position.set(LON0 * SX - 34, LAT1 * SY, z[i]);
    pts.push(LON0 * SX, LAT1 * SY, z[i], LON0 * SX - 14, LAT1 * SY, z[i]);
  }
  pts.push(LON0 * SX, LAT1 * SY, -H / 2 - SLAB, LON0 * SX, LAT1 * SY, H / 2 + SLAB);
  tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  tickGeo.computeBoundingSphere();
}

// compass labels
for (const [t, x, y] of [['N', 0, LAT1 + 16], ['S', 0, LAT0 - 16], ['W', LON0 - 22, 0], ['E', LON1 + 22, 0]]) {
  const s = makeLabel(t, { color: '#4e5d73', size: 30, bold: 700 });
  s.position.set(x * SX, y * SY, -H / 2 - SLAB - 4);
  labelGroup.add(s);
}
{
  const s = makeLabel('▲ TIME', { color: '#5d6f88', size: 26, bold: 700 });
  s.position.set(LON0 * SX - 40, LAT1 * SY, H / 2 + SLAB + 22);
  labelGroup.add(s);
}

// ────────────────────────────────────────────────────────── the traced solid
const empireGroup = new THREE.Group(); scene.add(empireGroup);
/**
 * Date banding, painted into the solid's own shader rather than drawn as lines
 * on top of it. The isosurface can sit up to half a grid cell outside the exact
 * polygon, which is far more than any polygon-offset can compensate for, so
 * overlaid line rings disappear into the surface from most angles. Modulating
 * the material by world Z is exact and works from every direction:
 *   - a bright rule at the top and bottom face of every snapshot slab
 *   - measured slabs kept at full colour, interpolated gaps slightly darker
 * so you can see at a glance which parts of the volume are data and which are
 * inference.
 */
const BANDS = { zc: { value: new Float32Array(32) }, n: { value: 0 }, half: { value: SLAB / 2 } };
function bandShader(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBandZ = BANDS.zc; sh.uniforms.uBandN = BANDS.n; sh.uniforms.uBandH = BANDS.half;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWZ;')
      .replace('#include <common>', '#include <common>\nvarying float vWNz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWZ = (modelMatrix * vec4(transformed, 1.0)).z;\nvWNz = normalize(mat3(modelMatrix) * objectNormal).z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBandZ[32];\nuniform int uBandN;\nuniform float uBandH;\nvarying float vWZ;\nvarying float vWNz;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float edge = 0.0; float inSlab = 0.0;
        for (int i = 0; i < 32; i++) {
          if (i >= uBandN) break;
          float d = abs(vWZ - uBandZ[i]);
          edge = max(edge, 1.0 - smoothstep(0.0, 0.85, abs(d - uBandH)));
          inSlab = max(inSlab, 1.0 - smoothstep(uBandH - 0.4, uBandH + 0.1, d));
        }
        // a horizontal face lies *inside* a band plane, so damp the rule there
        edge *= 1.0 - 0.78 * abs(vWNz);
        diffuseColor.rgb *= mix(0.80, 1.0, inSlab);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.84, 0.60), edge * 0.6);
      }`);
  };
  mat.customProgramCacheKey = () => 'bandZ';
  return mat;
}

const empireMat = bandShader(new THREE.MeshStandardMaterial({
  color: COL.empire, roughness: 0.62, metalness: 0.0,
  side: THREE.DoubleSide, emissive: 0x0f0601, emissiveIntensity: 1,
  polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 14
}));
const empirePrismMat = bandShader(new THREE.MeshStandardMaterial({
  color: COL.empire, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x0f0601,
  polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 14
}));
// Date bands: the traced state's real outline at every snapshot, drawn on the
// surface of the interpolated solid. They say plainly "these seven rings are
// data, everything between them is interpolation" — and they break the tall
// column up so its form is readable instead of one flat sheet of orange.
const empireLineMat = new THREE.LineBasicMaterial({ color: COL.empireLine, transparent: true, opacity: 0.95, depthWrite: false });
/**
 * X-ray pass — "show me the empire even when the world is in the way".
 *
 * The same geometry drawn a second time with `depthFunc: GreaterDepth`, i.e.
 * ONLY where it fails the ordinary depth test — where a ghost slab is in front
 * of it. Where the solid is directly visible the depths are equal, the test
 * fails, and nothing is drawn, so the lit shading is left completely intact.
 * (This works because the ghost slabs write depth; an earlier version used
 * depthTest:false and washed the whole solid out into a flat orange blob.)
 */
const empireXrayMat = new THREE.MeshBasicMaterial({
  color: 0xff9c3f, transparent: true, opacity: 0.14, depthWrite: false,
  depthTest: true, depthFunc: THREE.GreaterDepth,
  blending: THREE.AdditiveBlending, side: THREE.FrontSide
});

/**
 * Which materials the cut clips. The block FRAME and the year labels are left
 * unclipped on purpose: seeing the whole time axis around an isolated era is
 * how you know *where* the era sits. (The previous build clipped everything,
 * because it used renderer.clippingPlanes.)
 *
 * Clipping is attached and detached rather than left permanently on: a clip
 * plane compiles to a `discard`, and this scene is fill-rate bound — the same
 * reason the ghost shader deliberately avoids an alpha discard.
 */
const CLIP_SOLID = [empireMat, empirePrismMat, empireLineMat, empireXrayMat];
const CLIP_GHOST = [ghostMat, ghostFadeMat, ghostLineMat];
let clipSolidOn = false, clipGhostOn = false;
function setClipActive(onSolid, onGhost = onSolid) {
  if (onSolid !== clipSolidOn) {
    clipSolidOn = onSolid;
    for (const m of CLIP_SOLID) { m.clippingPlanes = onSolid ? CLIP : null; m.needsUpdate = true; }
  }
  if (onGhost !== clipGhostOn) {
    clipGhostOn = onGhost;
    for (const m of CLIP_GHOST) { m.clippingPlanes = onGhost ? CLIP : null; m.needsUpdate = true; }
  }
}

let SOLID_STATS = null, EMPIRE_TRIS = 0;
let TRACED = [];               // the polity ids currently being traced

/* ─────────────────────────────────────────── capping the cut (stencil pass)
 * A clipped solid is a HOLLOW SHELL: you cut the top off and look straight
 * through the empty inside to the far wall, which reads as a bag rather than a
 * body. Fixing it needs a per-pixel "am I inside the solid at this plane?"
 * test, and the stencil buffer is exactly that test:
 *
 *   1. draw BACK faces, clipped by the plane, incrementing stencil
 *   2. draw FRONT faces, clipped by the plane, decrementing stencil
 *      -> the stencil now holds the winding number: non-zero exactly where the
 *         cut plane passes through solid material
 *   3. draw a quad ON the plane, only where stencil != 0
 *   4. clear stencil, repeat for the second plane
 *
 * Both passes write no colour and no depth, so they cost fill rate only. This
 * is watertight because the surface-nets volume is manifold by construction;
 * the prism mode works too, since every prism is individually closed and
 * increment/decrement-wrap counts overlapping solids correctly.
 */
const capGroup = new THREE.Group(); scene.add(capGroup);

function stencilMat(plane, op) {
  return new THREE.MeshBasicMaterial({
    depthWrite: false, depthTest: false, colorWrite: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op, stencilZFail: op, stencilZPass: op,
    clippingPlanes: [plane]
  });
}
function capMat(other) {
  // A cut face in a technical drawing is lighter than the body it came from —
  // that difference is what tells you it is a section and not a surface.
  //
  // ORDER MATTERS. The whole cap pass runs BEFORE the solid (negative
  // renderOrder). Drawn after the solid, the cap loses the depth test to
  // whatever sliver of the solid sits between the eye and the plane and comes
  // out full of holes. Drawn first, into an empty depth buffer, it lays down
  // the section face and its depth; the solid then wins wherever it is
  // genuinely nearer, and the two caps occlude each other correctly.
  return new THREE.MeshStandardMaterial({
    color: 0xffc287, roughness: 0.5, metalness: 0.0,
    emissive: 0x3a1c06, emissiveIntensity: 1, side: THREE.DoubleSide,
    depthTest: true, depthWrite: true,
    clippingPlanes: [other],
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp
  });
}
const CAP_GEO = new THREE.PlaneGeometry(760, 420);
const capSpecs = [
  { plane: planeLo, sign: 1, mat: capMat(planeHi) },
  { plane: planeHi, sign: -1, mat: capMat(planeLo) }
];

/** rebuild the stencil + cap meshes for whatever geometry the solid now has */
let capZ = [0, 0];               // the solid's z extent, so idle planes can be skipped
function buildCaps(geoms) {
  // geometry is shared with the lit solid, but each stencil mesh owns its
  // material (side + stencil op differ per mesh), so those must be released
  for (const c of capGroup.children) if (c.userData.capSign === undefined) c.material.dispose();
  capGroup.clear();
  if (!S.caps || !geoms.length) return;
  let zmin = Infinity, zmax = -Infinity;
  for (const g of geoms) {
    g.computeBoundingBox();
    zmin = Math.min(zmin, g.boundingBox.min.z); zmax = Math.max(zmax, g.boundingBox.max.z);
  }
  capZ = [zmin, zmax];
  let order = -30;
  capSpecs.forEach((spec, k) => {
    for (const g of geoms) {
      for (const [side, op] of [[THREE.BackSide, THREE.IncrementWrapStencilOp], [THREE.FrontSide, THREE.DecrementWrapStencilOp]]) {
        const m = stencilMat(spec.plane, op); m.side = side;
        const mesh = new THREE.Mesh(g, m);
        mesh.renderOrder = order++;
        mesh.userData.pickable = false; mesh.userData.noDispose = true; mesh.userData.capIdx = k;
        capGroup.add(mesh);
      }
    }
    const cap = new THREE.Mesh(CAP_GEO, spec.mat);
    cap.userData.pickable = false; cap.userData.noDispose = true; cap.userData.capIdx = k;
    cap.renderOrder = order++;
    cap.userData.capSign = spec.sign;
    // the stencil must be zeroed before the next plane's pass counts anything
    cap.onAfterRender = (r) => r.clearStencil();
    capGroup.add(cap);
  });
  placeCaps();
}

/**
 * Park each cap quad on its plane, a hair to the DISCARDED side.
 *
 * This epsilon has a sign and the sign matters. Nudging the cap into the kept
 * side leaves a sliver of the solid's own surface between the eye and the cap,
 * and that sliver wins the depth test — the cap gets punched full of holes
 * exactly where the section is most nearly horizontal. Nudged the other way
 * there is provably nothing between the eye and the cap, because everything on
 * that side of the plane was clipped away.
 */
const CAP_EPS = 0.06;
function placeCaps() {
  // A plane that misses the solid entirely has nothing to cap, and its stencil
  // pass would still redraw the whole solid twice. Skipping it halves the cost
  // in the common case where the cut only bites one end.
  const at = [-planeLo.constant, planeHi.constant];
  const live = at.map(z => z > capZ[0] && z < capZ[1]);
  for (const c of capGroup.children) {
    const k = c.userData.capIdx;
    c.visible = live[k];
    if (c.userData.capSign === undefined) continue;
    c.position.set(0, 0, at[k] + (c.userData.capSign > 0 ? -CAP_EPS : CAP_EPS));
  }
}

function bboxOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    if (ring[i] < x0) x0 = ring[i]; if (ring[i] > x1) x1 = ring[i];
    if (ring[i + 1] < y0) y0 = ring[i + 1]; if (ring[i + 1] > y1) y1 = ring[i + 1];
  }
  return [x0, y0, x1, y1];
}

/**
 * Presence of a set of polity ids, snapshot by snapshot. The sovereign strings
 * are looked up PER SNAPSHOT rather than pooled across all of them, so the
 * time gate baked into the join is preserved: "Egypt" means Ancient Egypt at
 * 3000 BC and nothing at all in 1994.
 */
function presenceOfIds(ids) {
  const polys = [], feats = [];
  YEARS.forEach((y) => {
    const want = new Set();
    for (const id of ids) { const m = polById.get(id)?.match?.[y]; if (m) for (const n of m) want.add(n); }
    const ps = [], f = [];
    if (want.size) for (const ft of DATA.byYear[y]) if (want.has(ft.s)) {
      f.push(ft);
      for (const p of ft.p) ps.push({ rings: [p.o, ...p.h], bb: bboxOf(p.o) });
    }
    polys.push(ps.length ? ps : null); feats.push(f);
  });
  return { polys, feats };
}

const RES = { draft: { res: 90, sub: 3 }, normal: { res: 150, sub: 4 }, fine: { res: 230, sub: 5 } };

function addXray(geom) {
  const x = new THREE.Mesh(geom, empireXrayMat);
  x.userData.pickable = false; x.renderOrder = 940;
  x.userData.noDispose = true;      // geometry is shared with the lit mesh
  empireGroup.add(x);
}

function clearGroup(g) {
  for (const c of g.children) { if (!c.userData.noDispose) c.geometry?.dispose(); }
  g.clear();
}

function buildEmpire() {
  clearGroup(empireGroup);
  SOLID_STATS = null; EMPIRE_TRIS = 0;
  const ids = tracedIds();
  TRACED = ids;
  const { polys, feats } = presenceOfIds(ids);
  const z = zc();
  const present = YEARS.filter((_, i) => polys[i]);
  describeTrace(ids, present);
  if (!present.length) { buildCaps([]); applyCut(); updateHud(); return; }

  // crisp per-snapshot outlines — anchors the smooth solid to the actual data
  if (S.outlines) {
    const ob = new OutlineBuilder();
    for (let i = 0; i < NY; i++) {
      if (!feats[i].length) continue;
      for (const f of feats[i]) for (const p of f.p) {
        ob.addPolygon(p, z[i] + SLAB / 2, SX, SY);
        ob.addPolygon(p, z[i] - SLAB / 2, SX, SY);
      }
    }
    const l = new THREE.LineSegments(ob.toBufferGeometry(THREE), empireLineMat);
    l.userData.pickable = false; l.renderOrder = 5;
    empireGroup.add(l);
  }

  if (S.mode === 'off') { buildCaps([]); applyCut(); updateHud(); return; }

  if (S.mode === 'prisms') {
    const sb = new SlabBuilder();
    const t0 = performance.now();
    for (let i = 0; i < NY; i++) for (const f of feats[i]) for (const p of f.p) sb.addPolygon(p, z[i] - SLAB / 2, z[i] + SLAB / 2, SX, SY);
    const g = sb.toBufferGeometry(THREE);
    const m = new THREE.Mesh(g, empirePrismMat);
    m.userData.pickable = true; empireGroup.add(m);
    addXray(g);
    buildCaps([g]);
    EMPIRE_TRIS = sb.tris;
    SOLID_STATS = { mode: 'prisms', triangles: sb.tris, vertices: sb.v, meshMs: +(performance.now() - t0).toFixed(1) };
    applyCut(); updateHud(); return;
  }

  const { res, sub } = RES[S.res];
  const t0 = performance.now();
  const vol = buildSovereignVolumes({
    presence: polys, zc: z, half: SLAB / 2, res, sub, band: 6, smooth: 2,
    lonToX: (l) => l * SX, latToY: (l) => l * SY
  });
  if (!vol) { buildCaps([]); applyCut(); updateHud(); return; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(vol.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(vol.normals, 3));
  g.setIndex(new THREE.BufferAttribute(vol.indices, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, empireMat);
  m.userData.pickable = true; m.renderOrder = 1;
  empireGroup.add(m);
  addXray(g);
  buildCaps([g]);
  EMPIRE_TRIS = vol.stats.triangles;
  SOLID_STATS = { mode: 'lofted', ...vol.stats, totalMs: +(performance.now() - t0).toFixed(1) };
  applyCut();
  updateHud();
}

// ─────────────────────────────────────────────────────────────── navigation
const bounds = new THREE.Box3(
  new THREE.Vector3(LON0 * SX, LAT0 * SY, -H / 2 - SLAB),
  new THREE.Vector3(LON1 * SX, LAT1 * SY, H / 2 + SLAB)
);
const pickRoot = new THREE.Group();
scene.add(pickRoot);
const nav = new CubeControls(camera, renderer.domElement, scene, bounds);
scene.add(nav.pivotMarker);

// NB: `fov` is explicit. Without it, flying Home from the Top view (fov 12) kept
// the long lens, so "home" was not the same place twice — invisible in
// perspective but glaring once the ortho toggle converts fov into a zoom.
const HOME = { target: new THREE.Vector3(0, 0, 0), radius: 720, theta: -0.62, phi: 1.06, fov: 42 };
nav.applyView(HOME);
nav.setHome(HOME);
nav.oc.target.set(0, 0, 0);

/**
 * Axis views use a long focal length (fov 12-14) at a proportionally larger
 * radius. A wide-angle camera looking straight down a 300-unit stack makes the
 * 18 slices splay outwards like a fan and the world map becomes unreadable;
 * near-orthographic projection makes the top view an actual world map again.
 */
const VIEWS = {
  home: HOME,
  top:   { target: new THREE.Vector3(0, 0, 0), radius: 1650, theta: 0, phi: 0.0016, fov: 12 },
  front: { target: new THREE.Vector3(0, 0, 0), radius: 1750, theta: 0, phi: Math.PI / 2, fov: 14 },
  side:  { target: new THREE.Vector3(0, 0, 0), radius: 1500, theta: Math.PI / 2, phi: Math.PI / 2, fov: 14 },
  low:   { target: new THREE.Vector3(0, 0, 0), radius: 520, theta: -0.9, phi: 1.35, fov: 42 }
};

/** frame the traced solid: fly to it and pull the ghost back so it can be seen */
function frameEmpire(ms = 800) {
  const box = new THREE.Box3();
  let any = false;
  for (const c of empireGroup.children) {
    if (!c.geometry || c.userData.noDispose) continue;
    c.geometry.computeBoundingBox();
    box.union(c.geometry.boundingBox); any = true;
  }
  if (!any) return;
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  // perspective fit: half-diagonal / tan(fov/2), with headroom for the side panel
  const r = Math.max(sz.length() * 0.5 / Math.tan(THREE.MathUtils.degToRad(42) / 2) * 1.25, 70);
  const cur = nav.currentView();
  nav.flyTo({ target: c, radius: r, theta: cur.theta, phi: THREE.MathUtils.clamp(cur.phi, 0.75, 1.4), fov: 42 }, ms);
  if (S.ghost > 0.07) { S.ghost = 0.07; $('#ghost').value = 0.07; applyGhost(); }
}

// ────────────────────────────────────────────────────────────────────── UI
const ui = document.getElementById('ui');
const $ = (s) => document.querySelector(s);

const REG_ORDER = ['EU', 'ME', 'AF', 'AS', 'AM'];
// every curated polity, grouped by region, most-resolved first inside each
const listable = POL.slice().sort((a, b) =>
  (REG_ORDER.indexOf(a.region) - REG_ORDER.indexOf(b.region)) ||
  (b.span - a.span) || (b.weight - a.weight) || a.name.localeCompare(b.name));

ui.innerHTML = `
  <h1>Space-time cube</h1>
  <div class="row">
    <label>Trace a polity <span class="val" id="polN"></span></label>
    <input type="text" id="filter" placeholder="type: rome, ottoman, han…" autocomplete="off" spellcheck="false"/>
    <select id="sov" size="1" style="margin-top:6px"></select>
    <div class="note" id="polNote"></div>
  </div>
  <div class="row">
    <label>Follow lineage <span class="val" id="linV"></span></label>
    <div class="seg" id="lineage">
      <button data-v="0">Off</button><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button>
    </div>
    <div class="chain" id="chain"></div>
  </div>
  <hr/>
  <div class="row">
    <label>Solid</label>
    <div class="seg" id="mode">
      <button data-v="lofted">Lofted</button><button data-v="prisms">Prisms</button><button data-v="off">Off</button>
    </div>
  </div>
  <div class="row">
    <label>Mesh detail</label>
    <div class="seg" id="res">
      <button data-v="draft">Draft</button><button data-v="normal">Normal</button><button data-v="fine">Fine</button>
    </div>
  </div>
  <div class="row">
    <label>Projection</label>
    <div class="seg" id="proj"><button data-v="persp">Perspective</button><button data-v="ortho">Isometric</button></div>
  </div>
  <hr/>
  <div class="row">
    <label>Ghost world <span class="val" id="ghostV"></span></label>
    <input type="range" id="ghost" min="0" max="0.55" step="0.01"/>
  </div>
  <div class="row">
    <label>Cut through time <span class="val" id="cutV"></span></label>
    <div class="rng" id="cutRange">
      <div class="rtrack"></div><div class="rfill" id="cutFill"></div>
      <div class="rh" id="hLo" title="from"></div><div class="rh" id="hHi" title="to"></div>
    </div>
    <label class="chk" style="margin-top:6px"><input type="checkbox" id="caps"/> Cap the cut (solid section)</label>
  </div>
  <hr/>
  <div class="row">
    <label>Single slice <span class="val" id="sliceV"></span></label>
    <label class="chk"><input type="checkbox" id="slice"/> One snapshot at a time</label>
    <div class="transport" id="transport">
      <button data-a="first" title="first">&#9198;</button>
      <button data-a="prev"  title="step back">&#8249;</button>
      <button data-a="play"  title="play / pause" id="playBtn">&#9654;</button>
      <button data-a="next"  title="step forward">&#8250;</button>
      <button data-a="last"  title="last">&#9197;</button>
    </div>
    <input type="range" id="sliceIdx" min="0" max="${NY - 1}" step="1"/>
  </div>
  <hr/>
  <div class="row">
    <label>Time axis</label>
    <div class="seg" id="spacing"><button data-v="even">Even</button><button data-v="true">True years</button></div>
  </div>
  <div class="row" style="margin-bottom:4px">
    <label class="chk"><input type="checkbox" id="outlines"/> Snapshot outlines</label>
    <label class="chk"><input type="checkbox" id="ghostLines"/> Ghost coastlines</label>
    <label class="chk"><input type="checkbox" id="spin"/> Auto-orbit</label>
  </div>
  <hr/>
  <div class="hint">
    <b>Drag</b> orbit around whatever is under the cursor · <b>Right-drag</b> pan ·
    <b>Scroll</b> zoom to cursor · <b>Double-click</b> fly to a point<br>
    <kbd>R</kbd> home <kbd>T</kbd> top <kbd>F</kbd> front <kbd>E</kbd> side <kbd>Z</kbd> focus
    <kbd>I</kbd> isometric <kbd>A</kbd> slice <kbd>P</kbd> play <kbd>[</kbd><kbd>]</kbd> step <kbd>Space</kbd> spin
  </div>`;

// ── the trace list ───────────────────────────────────────────────────────────
/**
 * Ranked search over the curated table. This is what the old filter box was
 * missing: it only re-rendered the <select>, and assigning `select.value` from
 * script does not fire a `change` event, so nothing downstream ever heard about
 * it — the list narrowed and the view kept tracing whatever it had. Now typing
 * picks a best match and traces it.
 */
function rankMatches(q) {
  const ql = q.trim().toLowerCase();
  if (!ql) return [];
  const esc = ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp('\\b' + esc);
  /**
   * Stem match, because people type the country and the table holds the
   * adjective: "rome" is not a substring of "Roman Empire" and never will be.
   * Two words count as the same stem if they agree on at least three leading
   * characters and on 60% of the shorter one — rome/roman, persia/persian,
   * china/chinese. A first-word stem hit ranks above a later-word one, so
   * "rome" lands on the Roman Empire rather than the Holy Roman Empire.
   */
  const stem = (a, b) => {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i >= 3 && i >= 0.6 * Math.min(a.length, b.length);
  };
  const out = [];
  for (const p of listable) {
    const n = p.name.toLowerCase(), id = p.id.toLowerCase(), note = (p.note || '').toLowerCase();
    const words = n.split(/[^a-z0-9]+/).filter(Boolean);
    let r = -1;
    if (n === ql || id === ql) r = 0;
    else if (n.startsWith(ql) || id.startsWith(ql)) r = 1;
    else if (word.test(n)) r = 2;
    else if (words[0] && stem(words[0], ql)) r = 2.4;
    else if (words.some(w => stem(w, ql))) r = 2.6;
    else if (n.includes(ql) || id.includes(ql)) r = 3;
    else if (note.includes(ql)) r = 4;
    if (r >= 0) out.push({ p, r });
  }
  // a polity that resolves to real geometry always beats one that does not
  out.sort((a, b) => (a.r - b.r) || ((b.p.span > 0) - (a.p.span > 0)) || (b.p.span - a.p.span) || (b.p.weight - a.p.weight));
  return out.map(o => o.p);
}

function fillSelect(q = '') {
  const sel = $('#sov');
  const hits = q ? rankMatches(q) : listable;
  const set = new Set(hits.map(p => p.id));
  const groups = [];
  for (const rg of REG_ORDER) {
    const rows = hits.filter(p => p.region === rg);
    if (!rows.length) continue;
    groups.push(`<optgroup label="${REGION[rg]} (${rows.length})">` +
      rows.map(p => `<option value="${p.id}">${p.name}${p.span ? ` · ${p.span}` : ' · –'}</option>`).join('') + '</optgroup>');
  }
  sel.innerHTML = groups.join('') || '<option disabled>no match</option>';
  if (set.has(S.polity)) sel.value = S.polity;
  else if (hits.length) sel.value = hits[0].id;
  $('#polN').textContent = `${hits.length}/${POL.length}`;
  return hits;
}

/** the headline, the polity's own one-line note, and the lineage chips */
function describeTrace(ids, present) {
  const sel = polById.get(S.polity);
  const live = ids.filter(i => polById.get(i).span > 0);
  $('#eLabel').innerHTML = present.length
    ? `${sel ? sel.name : S.polity}${S.lineage ? ` <span>+ ${live.length - 1} linked</span>` : ''}` +
      ` <span>· ${present.length} of ${NY} snapshots · ${fmtY(present[0])} → ${fmtY(present[present.length - 1])}</span>`
    : `${sel ? sel.name : S.polity} <span>· no geometry in any of the 18 snapshots</span>`;
  $('#polNote').textContent = sel ? sel.note : '';
  $('#chain').innerHTML = ids.map(i => polById.get(i))
    .map(p => `<span class="${p.id === S.polity ? 'sel' : p.span ? '' : 'dim'}" title="${p.span ? p.span + ' snapshots' : 'no geometry in this dataset'}">${p.name}</span>`)
    .join('');
}

// ── controls ─────────────────────────────────────────────────────────────────
function seg(id, key, after, cast = (v) => v) {
  const el = $('#' + id);
  el.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v == S[key]);
    b.onclick = () => { S[key] = cast(b.dataset.v); el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); after(); };
  });
}
const paintSeg = (id, key) => document.querySelectorAll('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v == S[key]));

seg('mode', 'mode', () => buildEmpire());
seg('res', 'res', () => buildEmpire());
seg('spacing', 'spacing', () => { layoutSlices(); buildEmpire(); applyCut(); });
seg('lineage', 'lineage', () => { paintLineageLabel(); buildEmpire(); }, Number);
seg('proj', 'proj', () => setProjection(S.proj));
const paintLineageLabel = () => { $('#linV').textContent = S.lineage ? `${S.lineage} link${S.lineage > 1 ? 's' : ''}` : 'single'; };
paintLineageLabel();

// ── the filter, fixed ────────────────────────────────────────────────────────
let traceTimer = 0;
function selectPolity(id, rebuild = true) {
  if (!polById.has(id) || id === S.polity) return false;
  S.polity = id;
  $('#sov').value = id;
  if (rebuild) buildEmpire();
  return true;
}
$('#filter').oninput = (ev) => {
  const q = ev.target.value.trim();
  const hits = fillSelect(q);
  clearTimeout(traceTimer);
  if (!q) return;
  // debounce: meshing the solid costs 100-400 ms, so do not rebuild per keystroke
  traceTimer = setTimeout(() => { if (hits.length) selectPolity(hits[0].id); }, 280);
};
$('#filter').onkeydown = (ev) => {
  if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
    clearTimeout(traceTimer);
    const h = rankMatches(ev.target.value);
    if (h.length) selectPolity(h[0].id);
    ev.target.blur();
  } else if (ev.code === 'Escape') {
    ev.target.value = ''; fillSelect(''); ev.target.blur();
  }
};
$('#sov').onchange = (ev) => { clearTimeout(traceTimer); selectPolity(ev.target.value); };
fillSelect();

$('#ghost').value = S.ghost;
$('#ghost').oninput = (ev) => { S.ghost = +ev.target.value; applyGhost(); };
$('#outlines').checked = S.outlines;
$('#outlines').onchange = (ev) => { S.outlines = ev.target.checked; buildEmpire(); };
$('#ghostLines').checked = S.ghostLines;
$('#ghostLines').onchange = (ev) => { S.ghostLines = ev.target.checked; applyGhost(); if (S.slice) applySlice(); };
$('#spin').onchange = (ev) => { nav.oc.autoRotate = ev.target.checked; nav.oc.autoRotateSpeed = 0.9; };
$('#caps').checked = S.caps;
$('#caps').disabled = !WANT_STENCIL;
$('#caps').onchange = (ev) => { S.caps = ev.target.checked; buildEmpire(); applyCut(); };

function applyGhost() {
  ghostMat.opacity = S.slice ? SLICE_GHOST : S.ghost;
  empireXrayMat.opacity = Math.min(0.3, S.ghost * 0.9);
  empireXrayMat.visible = S.ghost > 0.02 && !S.slice;
  ghostGroup.visible = S.slice || S.ghost > 0.005;
  ghostLineMat.opacity = S.slice ? 0.5 : Math.min(0.32, S.ghost * 0.8);
  ghostLineGroup.visible = S.ghostLines && (S.slice || S.ghost > 0.005);
  $('#ghostV').textContent = S.ghost.toFixed(2);
}

// ── the time cut: a RANGE with two handles ───────────────────────────────────
const Z_BOT = -H / 2 - SLAB, Z_TOP = H / 2 + SLAB;
const zAtF = (f) => Z_BOT + (Z_TOP - Z_BOT) * f;
const fAtZ = (z) => (z - Z_BOT) / (Z_TOP - Z_BOT);

/** the (fractional) year at a world height, so the cut labels read as dates */
function yearAtZ(z) {
  const zs = zc();
  if (z <= zs[0]) return YEARS[0];
  for (let i = 0; i < NY - 1; i++) if (z <= zs[i + 1]) {
    const t = (z - zs[i]) / (zs[i + 1] - zs[i]);
    return YEARS[i] + t * (YEARS[i + 1] - YEARS[i]);
  }
  return YEARS[NY - 1];
}
const labelZ = (z) => fmtY(Math.round(yearAtZ(z)));

/** the world-z window the cut keeps */
function cutWindow() {
  return S.slice ? sliceWindow() : [zAtF(S.cutLo), zAtF(S.cutHi)];
}

function applyCut() {
  const [lo, hi] = cutWindow();
  planeLo.constant = -lo;
  planeHi.constant = hi;
  const cutting = S.slice || S.cutLo > 0.0015 || S.cutHi < 0.9985;
  // In slice mode the ghost is controlled per-snapshot instead. Clipping it too
  // would blank both sheets mid-cross-fade, when the window sits between slabs.
  setClipActive(cutting, cutting && !S.slice);
  placeCaps();
  capGroup.visible = cutting && S.caps && S.mode !== 'off';
  paintCutUi(cutting);
}

function paintCutUi(cutting) {
  const a = S.cutLo * 100, b = S.cutHi * 100;
  $('#hLo').style.left = a + '%';
  $('#hHi').style.left = b + '%';
  const fill = $('#cutFill');
  fill.style.left = a + '%'; fill.style.width = (b - a) + '%';
  $('#cutRange').classList.toggle('off', !cutting);
  $('#cutV').textContent = S.slice ? 'slice mode'
    : cutting ? `${labelZ(zAtF(S.cutLo))} → ${labelZ(zAtF(S.cutHi))}` : 'whole block';
}

/* Dual-handle slider. Two overlaid <input type=range> is the usual hack, and
 * they fight over pointer capture at the ends; forty lines of pointer maths is
 * less code and behaves. Handles snap to the top and bottom faces of a snapshot
 * slab, so isolating whole eras is the default and a mid-slab section — the
 * thing that shows off the cap — is a deliberate drag. */
{
  const el = $('#cutRange');
  let drag = null;
  const fOf = (ev) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  };
  const snap = (f, which) => {
    const z = zAtF(f), zs = zc(), half = SLAB / 2 + 0.5;
    let best = null, bd = 5;
    for (let i = 0; i < NY; i++) {
      const t = which === 'lo' ? zs[i] - half : zs[i] + half;
      const d = Math.abs(z - t);
      if (d < bd) { bd = d; best = t; }
    }
    return best === null ? f : Math.min(1, Math.max(0, fAtZ(best)));
  };
  const set = (f, which) => {
    f = snap(f, which);
    if (which === 'lo') S.cutLo = Math.min(f, S.cutHi - 0.004);
    else S.cutHi = Math.max(f, S.cutLo + 0.004);
    applyCut();
  };
  el.addEventListener('pointerdown', (ev) => {
    const f = fOf(ev);
    drag = Math.abs(f - S.cutLo) <= Math.abs(f - S.cutHi) ? 'lo' : 'hi';
    $(drag === 'lo' ? '#hLo' : '#hHi').classList.add('drag');
    el.setPointerCapture(ev.pointerId);
    set(f, drag);
  });
  el.addEventListener('pointermove', (ev) => { if (drag) set(fOf(ev), drag); });
  const end = () => { if (!drag) return; $(drag === 'lo' ? '#hLo' : '#hHi').classList.remove('drag'); drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ── single-slice mode ────────────────────────────────────────────────────────
/**
 * Exactly one snapshot on screen at a time, meant to be watched from straight
 * above; playback steps through all eighteen so a region's evolution reads as
 * motion.
 *
 * HONESTY. The ghost world CROSS-FADES between two discrete sheets — it never
 * invents a map for an in-between date. The traced solid is a different kind of
 * object: it is already a continuous interpolated volume, so its clip window
 * SLIDES from one slab to the next, and the readout says "1600 → 1715" for
 * exactly as long as what you are looking at is inference rather than data.
 */
const SLICE_GHOST = 0.92;     // a lone sheet at 0.16 is invisible
const SLICE_FADE = 0.30;      // seconds of cross-fade
const SLICE_DWELL = 0.80;     // seconds held on each snapshot while playing
let sliceFrom = 0, sliceT = 1, sliceHold = 0;

const setYearMat = (i, m) => { for (const c of yearGroups[i][0].children) c.material = m; };

/** the world-z window the solid is clipped to, sliding during a transition */
function sliceWindow() {
  const zs = zc();
  const e = sliceT >= 1 ? 1 : sliceT * sliceT * (3 - 2 * sliceT);
  const z = zs[sliceFrom] + (zs[S.sliceI] - zs[sliceFrom]) * e;
  return [z - SLAB / 2 - 0.6, z + SLAB / 2 + 0.6];
}

function sliceGoto(i, animate = true) {
  i = ((i % NY) + NY) % NY;
  if (i === S.sliceI) return;
  sliceFrom = sliceT >= 1 ? S.sliceI : sliceFrom;
  S.sliceI = i;
  sliceT = animate ? 0 : 1;
  sliceHold = 0;
  $('#sliceIdx').value = i;
  applySlice();
}

/** per frame while in slice mode: which sheets are up, and at what opacity */
function applySlice() {
  const e = sliceT >= 1 ? 1 : sliceT * sliceT * (3 - 2 * sliceT);
  for (let i = 0; i < NY; i++) {
    const cur = i === S.sliceI, prev = i === sliceFrom && e < 1;
    yearGroups[i][0].visible = cur || prev;
    yearGroups[i][1].visible = (cur || prev) && S.ghostLines;
    if (cur || prev) setYearMat(i, cur ? ghostMat : ghostFadeMat);
  }
  ghostMat.opacity = SLICE_GHOST * (sliceFrom === S.sliceI ? 1 : e);
  ghostFadeMat.opacity = SLICE_GHOST * (1 - e);
  applyCut();
  const y = fmtY(YEARS[S.sliceI]);
  $('#sliceV').textContent = `${S.sliceI + 1}/${NY}`;
  $('#yearBig').innerHTML = e < 1
    ? `${fmtY(YEARS[sliceFrom])} <span style="color:#5a6a80">→</span> ${y}<i>between snapshots · interpolated</i>`
    : `${y}<i>snapshot ${S.sliceI + 1} of ${NY} · measured</i>`;
}

function setSlice(on, { fly = true } = {}) {
  if (on === S.slice) return;
  S.slice = on;
  $('#slice').checked = on;
  $('#yearBig').classList.toggle('on', on);
  $('#cutRange').classList.toggle('dis', on);
  $('#transport').classList.toggle('dis', !on);
  $('#sliceIdx').classList.toggle('dis', !on);
  if (on) {
    sliceFrom = S.sliceI; sliceT = 1;
    applyGhost();
    applySlice();
    if (fly) nav.flyTo(VIEWS.top, 700);
  } else {
    S.slicePlay = false; paintPlay();
    for (let i = 0; i < NY; i++) { yearGroups[i][0].visible = true; yearGroups[i][1].visible = S.ghostLines; setYearMat(i, ghostMat); }
    $('#sliceV').textContent = 'off';
    applyGhost();
    applyCut();
  }
}
const paintPlay = () => {
  $('#playBtn').innerHTML = S.slicePlay ? '&#10074;&#10074;' : '&#9654;';
  $('#playBtn').classList.toggle('on', S.slicePlay);
};

$('#slice').checked = S.slice;
$('#slice').onchange = (ev) => setSlice(ev.target.checked);
$('#sliceIdx').value = S.sliceI;
$('#sliceIdx').oninput = (ev) => { S.slicePlay = false; paintPlay(); sliceGoto(+ev.target.value); };
$('#transport').querySelectorAll('button').forEach(b => b.onclick = () => {
  if (!S.slice) setSlice(true);
  const a = b.dataset.a;
  if (a === 'play') { S.slicePlay = !S.slicePlay; sliceHold = 0; paintPlay(); return; }
  S.slicePlay = false; paintPlay();
  sliceGoto(a === 'first' ? 0 : a === 'last' ? NY - 1 : a === 'prev' ? S.sliceI - 1 : S.sliceI + 1);
});
paintPlay();
$('#transport').classList.add('dis');
$('#sliceIdx').classList.add('dis');
$('#sliceV').textContent = 'off';

// ── projection ───────────────────────────────────────────────────────────────
function syncCameraAspect() {
  const a = innerWidth / innerHeight;
  perspCam.aspect = a; perspCam.updateProjectionMatrix();
  orthoCam.left = -ORTHO_H * a / 2; orthoCam.right = ORTHO_H * a / 2;
  orthoCam.top = ORTHO_H / 2; orthoCam.bottom = -ORTHO_H / 2;
  orthoCam.updateProjectionMatrix();
  nav.viewportHeight = innerHeight;
}
function setProjection(kind) {
  S.proj = kind;
  paintSeg('proj', 'proj');
  $('#isoBtn')?.classList.toggle('on', kind === 'ortho');
  const want = kind === 'ortho' ? orthoCam : perspCam;
  if (want === nav.camera) return;
  syncCameraAspect();
  nav.useCamera(want, 42);
  camera = nav.camera;      // everything downstream reads this live binding
}

applyGhost(); applyCut();

const views = document.getElementById('views');
views.innerHTML = ['home', 'top', 'front', 'side', 'low', 'focus'].map(v => `<button data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('') +
  '<button data-v="iso" id="isoBtn">Iso</button>';
views.querySelectorAll('button').forEach(b => b.onclick = () => {
  const v = b.dataset.v;
  if (v === 'iso') setProjection(S.proj === 'ortho' ? 'persp' : 'ortho');
  else if (v === 'focus') frameEmpire();
  else nav.flyTo(VIEWS[v], 750);
});

addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = (ev.key || '').toLowerCase();
  if (k === 'r') nav.flyTo(VIEWS.home, 750);
  else if (k === 't') nav.flyTo(VIEWS.top, 750);
  else if (k === 'f') nav.flyTo(VIEWS.front, 750);
  else if (k === 'e') nav.flyTo(VIEWS.side, 750);
  else if (k === 'z') frameEmpire();
  else if (k === 'i') setProjection(S.proj === 'ortho' ? 'persp' : 'ortho');
  else if (k === 'a') setSlice(!S.slice);
  else if (k === 'p') { if (!S.slice) setSlice(true); S.slicePlay = !S.slicePlay; sliceHold = 0; paintPlay(); }
  else if (k === '[') { if (S.slice) { S.slicePlay = false; paintPlay(); sliceGoto(S.sliceI - 1); } }
  else if (k === ']') { if (S.slice) { S.slicePlay = false; paintPlay(); sliceGoto(S.sliceI + 1); } }
  else if (k === ' ') { ev.preventDefault(); const c = $('#spin'); c.checked = !c.checked; c.onchange({ target: c }); }
});

addEventListener('resize', () => {
  syncCameraAspect();
  renderer.setSize(innerWidth, innerHeight);
});

// ───────────────────────────────────────────────────────────────────── HUD
const hud = document.getElementById('hud');
let fps = 0, frames = 0, tAcc = 0, worst = 0;
const hist = [];
function updateHud() {
  const r = renderer.info.render;
  const s = SOLID_STATS;
  hud.innerHTML =
    `<span class="k">fps</span> <b>${fps.toFixed(0)}</b>  <span class="k">min</span> ${worst ? worst.toFixed(0) : '–'}<br>` +
    `<span class="k">tris drawn</span> <b>${r.triangles.toLocaleString()}</b> <span class="k">/ calls</span> ${r.calls}<br>` +
    `<span class="k">ghost</span> ${GHOST_TRIS.toLocaleString()} tri <span class="k">(${GHOST_MS}ms)</span><br>` +
    `<span class="k">solid</span> ${EMPIRE_TRIS.toLocaleString()} tri` +
    (s && s.mode === 'lofted' ? ` <span class="k">cell</span> ${s.cell}° <span class="k">parts</span> ${s.clusters} <span class="k">(${s.totalMs}ms)</span>` : s ? ` <span class="k">(${s.meshMs}ms)</span>` : '');
}

// ──────────────────────────────────────────────────────────────── main loop
const clock = new THREE.Clock();
const _vd = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, clock.getDelta());

  // ── single-slice playback ────────────────────────────────────────────────
  if (S.slice) {
    if (sliceT < 1) {
      sliceT = Math.min(1, sliceT + dt / SLICE_FADE);
      applySlice();
    } else if (S.slicePlay) {
      sliceHold += dt;
      if (sliceHold >= SLICE_DWELL) sliceGoto(S.sliceI + 1);
    }
  }

  nav.update(dt);
  relightForCamera(nav.oc.target);
  // year labels stack on top of each other in a top-down view — fade them out
  camera.getWorldDirection(_vd);
  const flat = THREE.MathUtils.clamp((Math.abs(_vd.z) - 0.72) / 0.2, 0, 1);
  // in slice mode only one date is on screen, so keep only its own tick label
  const la = 1 - flat;
  for (let i = 0; i < yearLabels.length; i++) {
    const sp = yearLabels[i];
    const a = S.slice ? (i === S.sliceI ? 1 : 0) : la;
    sp.material.opacity = a; sp.visible = a > 0.02;
  }
  renderer.render(scene, camera);

  frames++; tAcc += dt;
  hist.push(dt); if (hist.length > 240) hist.shift();
  if (tAcc >= 0.35) {
    fps = frames / tAcc; frames = 0; tAcc = 0;
    const mx = Math.max(...hist.slice(-120));
    worst = mx > 0 ? 1 / mx : 0;
    updateHud();
  }
}

syncCameraAspect();
buildEmpire();
layoutSlices();
applyCut();
busy.classList.remove('on');
tick();

// ───────────────────────────────────────────────── test / measurement hooks
window.__cube = {
  get fps() { return fps; },
  get minFps() { return worst; },
  get tris() { return renderer.info.render.triangles; },
  get calls() { return renderer.info.render.calls; },
  get solid() { return SOLID_STATS; },
  get ghostTris() { return GHOST_TRIS; },
  get ghostVerts() { return GHOST_VERTS; },
  get state() { return { ...S }; },
  get traced() { return TRACED.map(id => ({ id, name: polById.get(id).name, span: polById.get(id).span })); },
  get proj() { return nav.isOrtho() ? 'ortho' : 'persp'; },
  get pivotPx() { return nav.pivotPx; },
  get pivotAlpha() { return nav._pivotA; },
  /** on-screen radius of the pivot marker, in CSS pixels — for the size test */
  get pivotScreenRadius() {
    const m = nav.pivotMarker;
    const a = m.position.clone(), b = m.position.clone().addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), m.scale.x);
    const pa = a.project(camera), pb = b.project(camera);
    return Math.abs(pb.x - pa.x) * 0.5 * renderer.domElement.clientWidth;
  },
  get camera() { return { pos: camera.position.toArray().map(n => +n.toFixed(1)), target: nav.oc.target.toArray().map(n => +n.toFixed(1)) }; },
  ready: true
};
window.__api = {
  /** accepts a polity id, an exact name, or anything the search box would take */
  select(q, lineage) {
    if (lineage !== undefined) { S.lineage = lineage; paintSeg('lineage', 'lineage'); paintLineageLabel(); }
    const id = polById.has(q) ? q : (rankMatches(String(q))[0]?.id);
    if (!id) return null;
    S.polity = id; $('#sov').value = id; buildEmpire();
    return SOLID_STATS;
  },
  lineage(n) { S.lineage = n; paintSeg('lineage', 'lineage'); paintLineageLabel(); buildEmpire(); return TRACED; },
  /** drive the filter box exactly as a user would, so the bug stays fixed */
  type(text) {
    const el = $('#filter'); el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return rankMatches(text).slice(0, 5).map(p => p.id);
  },
  caps(on) { S.caps = on; $('#caps').checked = on; buildEmpire(); applyCut(); },
  slice(on, i) { if (i !== undefined) { S.sliceI = i; sliceFrom = i; sliceT = 1; $('#sliceIdx').value = i; } setSlice(on, { fly: false }); if (on) applySlice(); return S.sliceI; },
  sliceGo(i, animate = true) { sliceGoto(i, animate); return { i: S.sliceI, t: sliceT }; },
  slicePlay(on) { S.slicePlay = on; sliceHold = 0; paintPlay(); },
  proj(kind) { setProjection(kind); return nav.currentView(); },
  polities: () => POL.map(p => ({ id: p.id, name: p.name, region: p.region, span: p.span, possible: p.possible })),
  /** diagnostic: poke the cap materials (colour / depthTest) to isolate stencil vs depth */
  capDebug(props) { for (const c of capSpecs) Object.assign(c.mat, props), (c.mat.needsUpdate = true); },
  capsInfo() {
    const caps = capGroup.children.filter(c => c.userData.capSign !== undefined);
    return {
      caps: caps.length,
      stencilMeshes: capGroup.children.length - caps.length,
      visible: capGroup.visible,
      live: caps.map(c => c.visible),
      z: caps.map(c => +(c.position.z + (c.userData.capSign > 0 ? CAP_EPS : -CAP_EPS)).toFixed(3))
    };
  },
  sliceInfo() {
    return {
      on: S.slice, i: S.sliceI, year: YEARS[S.sliceI], t: sliceT, from: sliceFrom, playing: S.slicePlay,
      visibleYears: yearGroups.filter(([g]) => g.visible).length,
      window: cutWindow().map(v => +v.toFixed(3)),
      readout: document.getElementById('yearBig').textContent
    };
  },
  polityStats: () => PDATA.stats,
  mode(m) { S.mode = m; paintSeg('mode', 'mode'); buildEmpire(); applyCut(); },
  res(v) { S.res = v; paintSeg('res', 'res'); buildEmpire(); },
  ghost(v) { S.ghost = v; $('#ghost').value = v; applyGhost(); },
  cut(lo, hi = 1) { S.cutLo = lo; S.cutHi = hi; applyCut(); return [zAtF(lo), zAtF(hi)]; },
  spacing(v) { S.spacing = v; paintSeg('spacing', 'spacing'); layoutSlices(); buildEmpire(); applyCut(); },
  outlines(v) { S.outlines = v; $('#outlines').checked = v; buildEmpire(); },
  ghostLines(v) { S.ghostLines = v; $('#ghostLines').checked = v; applyGhost(); if (S.slice) applySlice(); },
  view(name, ms = 0) {
    if (name === 'focus') { frameEmpire(ms || 1); return true; }
    const v = VIEWS[name]; if (!v) return false; ms ? nav.flyTo(v, ms) : nav.applyView(v); return true;
  },
  fade(near, far) { FADE.near.value = near; FADE.far.value = far; },
  xray(v) { empireXrayMat.opacity = v; empireXrayMat.visible = v > 0.001; },
  camera(pos, target) { camera.position.fromArray(pos); nav.oc.target.fromArray(target); camera.lookAt(nav.oc.target); camera.updateMatrixWorld(); },
  /** press and hold the pivot: exposes the marker for a screenshot without a real drag */
  holdPivot(on) { nav._pivotTarget = on ? 1 : 0; nav._dragging = on; },
  spin(on, speed = 1.6) { nav.oc.autoRotate = on; nav.oc.autoRotateSpeed = speed; $('#spin').checked = on; },
  resetPerf() { hist.length = 0; worst = 0; frames = 0; tAcc = 0; },
  hideUi(v) { for (const id of ['ui', 'views', 'hud', 'title']) document.getElementById(id).style.display = v ? 'none' : ''; },
  /** diagnostic: show one slab, opaque, so winding + hole handling can be eyeballed */
  isolateYear(i) {
    yearGroups.forEach(([g, gl], k) => { g.visible = i < 0 || k === i; gl.visible = (i < 0 || k === i) && S.ghostLines; });
    ghostMat.transparent = i >= 0 ? false : true;
    ghostMat.opacity = i >= 0 ? 1 : S.ghost;
    ghostMat.side = i >= 0 ? THREE.FrontSide : THREE.FrontSide;
    ghostMat.needsUpdate = true;
    return i >= 0 ? YEARS[i] : null;
  },
  /** raycast a client-space point to a world position (for navigation tests) */
  worldAtScreen(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    nav.raycaster.setFromCamera(nd, camera);
    const hit = nav.raycaster.intersectObject(scene, true).filter(h => h.object.visible && h.object.userData.pickable !== false)[0];
    return hit ? hit.point.toArray() : null;
  },
  screenOf(p) {
    const v = new THREE.Vector3().fromArray(p).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return [(v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top];
  },
  basis() {
    const m = camera.matrixWorld.elements;
    return { right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], fwd: [-m[8], -m[9], -m[10]],
             pos: camera.position.toArray(), target: nav.oc.target.toArray(), camUp: camera.up.toArray() };
  },
  spherical() { const v = nav.currentView(); return { r: v.radius, theta: v.theta, phi: v.phi, fov: v.fov, target: v.target.toArray() }; },
  /** orbit to an absolute (theta, phi, radius) around the current target */
  orbit(theta, phi, radius, ms = 0) {
    const v = nav.currentView();
    const to = { target: v.target, theta: theta ?? v.theta, phi: phi ?? v.phi, radius: radius ?? v.radius, fov: v.fov };
    ms ? nav.flyTo(to, ms) : nav.applyView(to);
    return nav.currentView();
  },
  audit() {
    let tri = 0, line = 0, sprite = 0, meshes = 0;
    scene.traverse(o => {
      if (!o.visible || !o.geometry) return;
      const n = o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count ?? 0);
      if (o.isMesh) { tri += n / 3; meshes++; } else if (o.isLineSegments) line += n / 2; else if (o.isSprite) sprite++;
    });
    return { sceneTriangles: tri, sceneLines: line, sprites: sprite, meshes, drawnTriangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  },
  sovereigns: () => DATA.sovereigns.slice(0, 60).map(s => s.name)
};
