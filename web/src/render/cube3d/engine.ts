/* =============================================================================
   engine.ts — the volumetric space-time cube.

   This is the ONLY part of experiments/cube3d that was rewritten rather than
   ported: the prototype's src/main.js was app wiring (its own DOM, its own
   window resize, its own <style> palette). The three modules beside it —
   slabs.ts, solid.ts, CubeControls.ts — dropped in with type annotations only.

   WHAT CHANGED, AND WHY
     · No DOM of its own. Everything it wants to say leaves through `hooks`;
       everything it is told arrives through method calls. src/render/cube.ts
       owns the Survey markup and is the only file that touches an element.
     · Colours come from the Survey tokens (tokens() in shared.ts), not from a
       hard-coded palette, and are re-read on every theme change. The traced
       polity takes sovColor() — the same hue the world map and the core sample
       paint it — so the three views agree about who is who. The chrome accent
       appears exactly once, on the pivot marker, which is chrome: it means
       "where you are", which is precisely what a pivot is.
     · Sized from its canvas, not from innerWidth/innerHeight, and the render
       loop stops dead when the canvas is hidden — ten other views share this
       page and a background rAF on a WebGL scene is not free.

   It is loaded through a dynamic import (see cube.ts) so three.js and earcut —
   206 KB gzipped between them — stay out of first paint.
   ============================================================================= */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SlabBuilder, OutlineBuilder, type SlabPoly } from './slabs';
import { buildSovereignVolumes, type PolyRef } from './solid';
import { CubeControls, type CubeCamera, type View } from './CubeControls';
import { fmtY, fontMono, sovColor, tokens } from '../shared';

// ───────────────────────────────────────────────────────── frame of reference
const SX = 1, SY = 1;          // 1 world unit == 1 degree
const H = 300;                 // height of the time axis, world units
const SLAB = 6;                // slab thickness (the "weight" of a map sheet)
const LON0 = -180, LON1 = 180, LAT0 = -90, LAT1 = 90;
const ORTHO_H = 600;           // base ortho frustum height, world units
const Z_BOT = -H / 2 - SLAB, Z_TOP = H / 2 + SLAB;
const SLICE_GHOST = 0.92;      // a lone sheet at 0.16 is invisible
const SLICE_FADE = 0.30;       // seconds of cross-fade
const SLICE_DWELL = 0.80;      // seconds held on each snapshot while playing

/**
 * REGIONS, in the order the trace list is grouped. The polity table tags AF
 * separately even though those rows live in the ME and AM files.
 *
 * Deliberately duplicated in cube.ts rather than exported from here: cube.ts
 * imports this module for TYPES ONLY (`import type`, which erases), and one
 * value import would drag three.js back into the first-paint bundle.
 */
const REG_ORDER = ['EU', 'ME', 'AF', 'AS', 'AM'];

// ───────────────────────────────────────────────────────────────── the data
interface Feature { n: string; s: string; a: number; c: number[]; bb: number[]; p: SlabPoly[] }
interface WorldBlock { years: number[]; byYear: Record<string, Feature[]>; sovereigns: { name: string; span: number }[] }
export interface Polity {
  id: string; name: string; note: string; region: string;
  start: number; end: number; from: string[]; to: string[];
  weight: number; span: number; area: number; possible: number;
  match: Record<string, string[]>;
}

// ───────────────────────────────────────────────────────────────── the state
export type SolidMode = 'lofted' | 'prisms' | 'off';
export type MeshRes = 'draft' | 'normal' | 'fine';
export type Spacing = 'even' | 'true';
export type Projection = 'persp' | 'ortho';
export type ViewName = 'home' | 'top' | 'front' | 'side' | 'low';

export interface CubeState {
  polity: string;
  /** 0 = this polity only; n = follow n links of ancestry AND descent */
  lineage: number;
  mode: SolidMode;
  ghost: number;
  spacing: Spacing;
  res: MeshRes;
  outlines: boolean;
  ghostLines: boolean;
  /** the time cut, as fractions of the block height */
  cutLo: number; cutHi: number;
  /** stencil-capped cross-sections at the cut */
  caps: boolean;
  slice: boolean;
  sliceI: number;
  slicePlay: boolean;
  proj: Projection;
  spin: boolean;
}

// ───────────────────────────────────────────────────────── what it reports
export interface SolidStats {
  mode: SolidMode; triangles: number; vertices: number;
  cell?: number; clusters?: number; ms: number;
}
export interface CubeStats {
  fps: number; minFps: number; tris: number; calls: number;
  ghostTris: number; ghostMs: number; solid: SolidStats | null;
}
export interface TraceInfo {
  id: string; name: string; note: string; colour: string;
  present: number[]; total: number; linked: number;
  chain: { id: string; name: string; span: number; sel: boolean }[];
}
export interface SliceInfo {
  on: boolean; i: number; n: number; year: number; fromYear: number;
  /** true while the cross-fade is mid-flight — the readout must say so */
  interpolated: boolean;
}
export interface CutInfo { cutting: boolean; lo: number; hi: number; label: string }

export interface CubeHooks {
  onBusy?: (msg: string | null) => void;
  onTrace?: (t: TraceInfo) => void;
  onStats?: (s: CubeStats) => void;
  onSlice?: (s: SliceInfo) => void;
  onCut?: (c: CutInfo) => void;
  /** the engine changed state on its own — repaint every control */
  onState?: () => void;
}

const RES: Record<MeshRes, { res: number; sub: number }> = {
  draft: { res: 90, sub: 3 }, normal: { res: 150, sub: 4 }, fine: { res: 230, sub: 5 },
};

// scratch vectors, so the frame loop allocates nothing
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 0, 1), _l = new THREE.Vector3();
const _vd = new THREE.Vector3();

/**
 * EVERY CSS colour entering the scene goes through the BROWSER'S parser, not
 * three's.
 *
 * THREE.Color.setStyle() only understands the comma form of hsl() —
 * `hsl(9, 43%, 53%)` — and silently leaves the colour WHITE for the
 * space-separated CSS Color Level 4 form. sovColor() in shared.ts emits exactly
 * that form for every sovereign outside its hand-written FAMOUS table, so the
 * traced solid rendered white for most of the 1,399 sovereigns in the data, and
 * the light rig then tinted the white cream and lavender. It fails without a
 * warning, because setStyle only warns on an unknown colour *name*.
 *
 * A 2-D context's fillStyle setter normalises any CSS colour the browser
 * understands down to `#rrggbb`, which three parses correctly. One round trip
 * and the whole class of bug is gone — including any future token written in
 * rgb(), color(), oklch() or a named colour.
 */
let _cssCtx: CanvasRenderingContext2D | null = null;
function cssColor(css: string): THREE.Color {
  if (!_cssCtx) _cssCtx = document.createElement('canvas').getContext('2d');
  if (!_cssCtx) return new THREE.Color().setStyle(css);
  _cssCtx.fillStyle = '#000000';
  _cssCtx.fillStyle = css;
  const norm = _cssCtx.fillStyle;
  return new THREE.Color().setStyle(typeof norm === 'string' ? norm : '#000000');
}

/** shift a colour in HSL space */
function hsl(css: string | THREE.Color, ds: number, dl: number) {
  const c = css instanceof THREE.Color ? css.clone() : cssColor(css);
  const o = { h: 0, s: 0, l: 0 };
  c.getHSL(o);
  return c.setHSL(o.h, Math.min(1, o.s * ds), Math.min(1, o.l * dl));
}

/** lighten a CSS colour by `amt` in HSL — the section face and the date rules */
function lighten(css: string, amt: number) {
  const c = cssColor(css);
  const o = { h: 0, s: 0, l: 0 };
  c.getHSL(o);
  return c.setHSL(o.h, o.s, Math.min(1, o.l + amt));
}

/** relative luminance of a token colour, so the engine can tell the themes apart */
function luma(css: string) {
  const c = cssColor(css);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function bboxOf(ring: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    if (ring[i] < x0) x0 = ring[i]; if (ring[i] > x1) x1 = ring[i];
    if (ring[i + 1] < y0) y0 = ring[i + 1]; if (ring[i + 1] > y1) y1 = ring[i + 1];
  }
  return [x0, y0, x1, y1];
}

// =============================================================================
export class CubeEngine {
  readonly S: CubeState;
  readonly years: number[];
  private hooks: CubeHooks;
  private canvas: HTMLCanvasElement;

  private DATA: WorldBlock;
  private polById: Map<string, Polity>;
  private listable: Polity[];
  private NY: number;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private perspCam: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;
  private camera: CubeCamera;
  private nav: CubeControls;

  private lightKey: THREE.DirectionalLight;
  private lightFill: THREE.DirectionalLight;
  private lightRim: THREE.DirectionalLight;

  private ghostGroup = new THREE.Group();
  private ghostLineGroup = new THREE.Group();
  private empireGroup = new THREE.Group();
  private capGroup = new THREE.Group();
  private frameGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private yearGroups: [THREE.Group, THREE.Group][] = [];
  private yearLabels: THREE.Sprite[] = [];
  private compass: THREE.Sprite[] = [];
  private tickGeo = new THREE.BufferGeometry();

  private ghostMat!: THREE.MeshLambertMaterial;
  private ghostFadeMat!: THREE.MeshLambertMaterial;
  private ghostLineMat!: THREE.LineBasicMaterial;
  private frameMat!: THREE.LineBasicMaterial;
  private empireMat!: THREE.MeshStandardMaterial;
  private empirePrismMat!: THREE.MeshStandardMaterial;
  private empireLineMat!: THREE.LineBasicMaterial;
  private empireXrayMat!: THREE.MeshBasicMaterial;
  private capMats: THREE.MeshStandardMaterial[] = [];
  private bandCol = { value: new THREE.Color(1, 0.84, 0.6) };

  private planeLo = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e5);   // keep z >= zLo
  private planeHi = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5);  // keep z <= zHi
  private CLIP: THREE.Plane[];
  private clipSolidOn = false;
  private clipGhostOn = false;

  private FADE = { near: { value: 55 }, far: { value: 300 } };
  private BANDS = { zc: { value: new Float32Array(32) }, n: { value: 0 }, half: { value: SLAB / 2 } };

  private zEven: number[];
  private zTrue: number[];

  private GHOST_TRIS = 0;
  private GHOST_MS = 0;
  private SOLID_STATS: SolidStats | null = null;
  private TRACED: string[] = [];
  private traceColour = '#888888';
  private dark = true;

  private capSpecs: { plane: THREE.Plane; sign: number; mat: THREE.MeshStandardMaterial }[] = [];
  private capZ: [number, number] = [0, 0];
  private CAP_GEO = new THREE.PlaneGeometry(760, 420);

  // THREE.Clock is deprecated in r185 (it warns on construction). Timer is the
  // replacement, and its update()/getDelta() split is a better fit for a frame
  // loop anyway: dt is computed once per frame and read as often as needed.
  private clock = new THREE.Timer();
  private raf = 0;
  running = false;
  private w = 1; private h = 1;
  private fps = 0; private frames = 0; private tAcc = 0; private worst = 0;
  private hist: number[] = [];

  private sliceFrom = 0; private sliceT = 1; private sliceHold = 0;
  private VIEWS: Record<ViewName, View>;

  // -------------------------------------------------------------------- boot
  private constructor(canvas: HTMLCanvasElement, data: WorldBlock, pol: Polity[], state: CubeState, hooks: CubeHooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.S = state;
    this.DATA = data;
    this.polById = new Map(pol.map(p => [p.id, p]));
    this.years = data.years;
    this.NY = data.years.length;

    // every curated polity, grouped by region, most-resolved first inside each
    this.listable = pol.slice().sort((a, b) =>
      (REG_ORDER.indexOf(a.region) - REG_ORDER.indexOf(b.region)) ||
      (b.span - a.span) || (b.weight - a.weight) || a.name.localeCompare(b.name));

    const y0 = this.years[0], y1 = this.years[this.NY - 1];
    this.zEven = this.years.map((_, i) => -H / 2 + (i / (this.NY - 1)) * H);
    this.zTrue = this.years.map(y => -H / 2 + ((y - y0) / (y1 - y0)) * H);

    this.CLIP = [this.planeLo, this.planeHi];

    const r = canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));

    // `stencil: true` is not the three.js default and the capped time cut needs
    // it. alpha: true so the Survey ground and its engraved graticule stay
    // visible under the block — this WebGL view sits IN the chart film, not on
    // top of a black rectangle of its own.
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true;
    // filmic rolloff: with five lights on a saturated solid, plain linear
    // clamping blows the highlights to white and the volume stops reading as 3-D
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    /**
     * TWO CAMERAS, one view state. A 42-degree perspective fans the 18 slices
     * outward: from the top the world map is a splayed pile and columns lean.
     * Orthographic fixes exactly that — parallel projection keeps every slice at
     * the same scale and every vertical column vertical, which is what you want
     * for reading the block as a diagram.
     */
    const a = this.w / this.h;
    this.perspCam = new THREE.PerspectiveCamera(42, a, 1, 6000);
    this.orthoCam = new THREE.OrthographicCamera(-ORTHO_H * a / 2, ORTHO_H * a / 2, ORTHO_H / 2, -ORTHO_H / 2, -900, 6000);
    this.camera = this.perspCam;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.16));
    this.scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x241a10, 0.7));

    /**
     * Camera-relative three-point rig. A world-fixed key light means that from
     * some orbit angles it sits right behind the camera and the solid flattens
     * into a flash-photo decal. Keeping key / fill / rim at fixed angles
     * *relative to the view* guarantees the same readable modelling from every
     * direction — the same trick CAD viewers use.
     */
    this.lightKey = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.lightFill = new THREE.DirectionalLight(0x86b0ff, 0.75);
    this.lightRim = new THREE.DirectionalLight(0xffe0b0, 1.05);
    this.scene.add(this.lightKey, this.lightKey.target, this.lightFill, this.lightFill.target, this.lightRim, this.lightRim.target);

    // image-based lighting: soft directional variation across curved surfaces,
    // which is what makes a smooth volume read as a volume rather than a decal
    {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      // 0.06 rad of blur asks the PMREM for 30 samples against a hard cap of 20
      // and warns; 0.04 is the largest that does not, and is visually identical
      // at 26% intensity.
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.26;
      pmrem.dispose();
    }

    this.buildMaterials();
    this.scene.add(this.ghostGroup, this.ghostLineGroup, this.frameGroup, this.labelGroup, this.empireGroup, this.capGroup);

    this.buildGhost();
    this.buildFrame();

    const bounds = new THREE.Box3(
      new THREE.Vector3(LON0 * SX, LAT0 * SY, Z_BOT),
      new THREE.Vector3(LON1 * SX, LAT1 * SY, Z_TOP));
    this.nav = new CubeControls(this.camera, canvas, this.scene, bounds);
    this.nav.viewportHeight = this.h;
    this.nav.orthoHeight = ORTHO_H;
    this.nav.setPivotColor(cssColor(tokens().accent));
    this.scene.add(this.nav.pivotMarker);

    // NB: `fov` is explicit. Without it, flying Home from the Top view (fov 12)
    // kept the long lens, so "home" was not the same place twice.
    const HOME: View = { target: new THREE.Vector3(0, 0, 0), radius: 720, theta: -0.62, phi: 1.06, fov: 42 };
    /**
     * Axis views use a long focal length (fov 12-14) at a proportionally larger
     * radius. A wide-angle camera looking straight down a 300-unit stack makes
     * the 18 slices splay outwards like a fan and the world map becomes
     * unreadable; near-orthographic projection makes the top view a map again.
     */
    this.VIEWS = {
      home: HOME,
      top: { target: new THREE.Vector3(0, 0, 0), radius: 1650, theta: 0, phi: 0.0016, fov: 12 },
      front: { target: new THREE.Vector3(0, 0, 0), radius: 1750, theta: 0, phi: Math.PI / 2, fov: 14 },
      side: { target: new THREE.Vector3(0, 0, 0), radius: 1500, theta: Math.PI / 2, phi: Math.PI / 2, fov: 14 },
      low: { target: new THREE.Vector3(0, 0, 0), radius: 520, theta: -0.9, phi: 1.35, fov: 42 },
    };
    this.nav.applyView(HOME);
    this.nav.setHome(HOME);
    this.nav.oc.target.set(0, 0, 0);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    addEventListener('keydown', this.onKey);
  }

  static async create(canvas: HTMLCanvasElement, state: CubeState, hooks: CubeHooks) {
    hooks.onBusy?.('loading the world…');
    const [DATA, PDATA] = await Promise.all([
      fetch('/data/world-block.json').then(r => { if (!r.ok) throw new Error('world-block.json → HTTP ' + r.status); return r.json(); }),
      fetch('/data/polities.json').then(r => { if (!r.ok) throw new Error('polities.json → HTTP ' + r.status); return r.json(); }),
    ]) as [WorldBlock, { polities: Polity[] }];
    hooks.onBusy?.('extruding the world…');
    // let the busy label paint before the synchronous extrusion of 18 snapshots
    await new Promise(r => setTimeout(r, 0));
    const e = new CubeEngine(canvas, DATA, PDATA.polities, state, hooks);
    e.layoutSlices();
    e.buildEmpire();
    e.applyGhost();
    e.applyCut();
    if (state.slice) { e.sliceFrom = state.sliceI; e.sliceT = 1; e.applySlice(); }
    if (state.proj === 'ortho') e.setProjection('ortho');
    e.setSpin(state.spin);
    hooks.onBusy?.(null);
    return e;
  }

  // ─────────────────────────────────────────────────────────────── the palette
  /**
   * Every colour in the scene, read out of the Survey tokens. Called again on
   * every theme change (retheme()), which is why nothing here is a constant.
   *
   * The one asymmetry between the themes is the ghost. On the dark ground a pale
   * grey slab at 16% is a haze; on the light ground the same slab is invisible,
   * so light takes a graphite ghost and a little more opacity — the pencil-wash
   * version of the same idea.
   */
  private palette() {
    const T = tokens();
    const dark = luma(T.bg) < 0.5;
    this.dark = dark;
    return {
      dark,
      ghost: dark ? T.ink3 : T.ink2,
      ghostGain: dark ? 1 : 1.5,
      ghostLine: dark ? T.ink2 : T.ink3,
      frame: T.line,
      label: T.ink3,
    };
  }

  private buildMaterials() {
    const P = this.palette();
    /**
     * Near-camera fade. The block is 300 units tall and you fly *into* it;
     * without this, the slabs between you and whatever you flew in to look at
     * pile up into an opaque milk fog. Fading anything within ~`near` world
     * units of the eye opens the stack up as you approach, like haze in Google
     * Earth.
     */
    const nearFade = <M extends THREE.Material>(mat: M): M => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uFadeNear = this.FADE.near;
        sh.uniforms.uFadeFar = this.FADE.far;
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
    };

    // FrontSide, not DoubleSide: the winding is guaranteed outward, so front
    // faces are all we ever need — and a transparent DoubleSide material costs
    // three.js a second full draw pass per object.
    this.ghostMat = nearFade(new THREE.MeshLambertMaterial({
      color: cssColor(P.ghost), transparent: true, opacity: this.S.ghost,
      depthWrite: true, side: THREE.FrontSide,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 6,
    }));
    // the outgoing snapshot during a single-slice cross-fade, so two sheets can
    // hold two different opacities at once
    this.ghostFadeMat = nearFade(this.ghostMat.clone());
    this.ghostLineMat = nearFade(new THREE.LineBasicMaterial({
      color: cssColor(P.ghostLine), transparent: true, opacity: 0.22, depthWrite: false,
    }));
    this.frameMat = new THREE.LineBasicMaterial({
      color: cssColor(P.frame), transparent: true, opacity: 0.85,
    });

    /**
     * Date banding, painted into the solid's own shader rather than drawn as
     * lines on top of it. The isosurface can sit up to half a grid cell outside
     * the exact polygon, which is far more than any polygon-offset can
     * compensate for, so overlaid line rings disappear into the surface from
     * most angles. Modulating the material by world Z is exact and works from
     * every direction:
     *   - a bright rule at the top and bottom face of every snapshot slab
     *   - measured slabs kept at full colour, interpolated gaps slightly darker
     * so you can see at a glance which parts of the volume are data and which
     * are inference.
     */
    const bandShader = <M extends THREE.Material>(mat: M): M => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uBandZ = this.BANDS.zc; sh.uniforms.uBandN = this.BANDS.n; sh.uniforms.uBandH = this.BANDS.half;
        sh.uniforms.uBandCol = this.bandCol;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vWZ;\nvarying float vWNz;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWZ = (modelMatrix * vec4(transformed, 1.0)).z;\nvWNz = normalize(mat3(modelMatrix) * objectNormal).z;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uBandZ[32];\nuniform int uBandN;\nuniform float uBandH;\nuniform vec3 uBandCol;\nvarying float vWZ;\nvarying float vWNz;')
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
        diffuseColor.rgb = mix(diffuseColor.rgb, uBandCol, edge * 0.6);
      }`);
      };
      mat.customProgramCacheKey = () => 'bandZ';
      return mat;
    };

    const solidOpts = {
      roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide, emissiveIntensity: 1,
      polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 14,
    };
    this.empireMat = bandShader(new THREE.MeshStandardMaterial({ ...solidOpts }));
    this.empirePrismMat = bandShader(new THREE.MeshStandardMaterial({ ...solidOpts }));
    // The traced state's real outline at every snapshot, drawn on the surface of
    // the interpolated solid: "these rings are data, everything between them is
    // interpolation".
    this.empireLineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    /**
     * X-ray pass — "show me the empire even when the world is in the way".
     *
     * The same geometry drawn a second time with `depthFunc: GreaterDepth`, i.e.
     * ONLY where it fails the ordinary depth test — where a ghost slab is in
     * front of it. Where the solid is directly visible the depths are equal, the
     * test fails, and nothing is drawn, so the lit shading is left completely
     * intact. (This works because the ghost slabs write depth; an earlier
     * version used depthTest:false and washed the solid out into a flat blob.)
     */
    this.empireXrayMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.14, depthWrite: false,
      depthTest: true, depthFunc: THREE.GreaterDepth,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });

    this.capSpecs = [
      { plane: this.planeLo, sign: 1, mat: this.makeCapMat(this.planeHi) },
      { plane: this.planeHi, sign: -1, mat: this.makeCapMat(this.planeLo) },
    ];
    this.capMats = this.capSpecs.map(c => c.mat);
    this.applyTraceColour();
  }

  /**
   * Every material that quotes the traced polity's own hue. That hue is
   * sovColor()'s — the map's and the core sample's — never the chrome accent:
   * this is the largest saturated shape on the screen and it is DATA.
   *
   * PRE-COMPENSATED, and it has to be. A canvas renderer paints the token hex
   * flat; a lit MeshStandardMaterial multiplies it by a 2.1-intensity key plus
   * fill, rim, hemisphere and an environment map, and neutral tone mapping then
   * rolls the result toward white. The Survey sovereign palette is far less
   * saturated than the prototype's amber (S 34-52% against 85%), so it bleached:
   * traced at default exposure, the Inca Empire came out cream and pale blue —
   * the colour of the lights, not of the empire. Winding saturation up and
   * lightness down by the same amount the rig adds back lands the lit surface on
   * the hue a reader can match to the map.
   */
  private applyTraceColour() {
    // Wound up in saturation, down in lightness: the rig and the tone mapping
    // add both back.
    const base = hsl(this.traceColour, 1.05, 0.65);
    const hi = lighten(this.traceColour, this.dark ? 0.24 : 0.18);
    // HALF THE SURFACE IS UNLIT, on purpose. `emissive` is not multiplied by any
    // light, so this fraction of the colour survives whatever direction a face
    // happens to point — which is what stops a face lit only by the cool fill
    // and the blue hemisphere from turning a terracotta empire lavender. The
    // remaining, lit half still does all the modelling.
    for (const m of [this.empireMat, this.empirePrismMat]) {
      m.color.copy(base.clone().multiplyScalar(0.78));
      m.emissive.copy(base.clone().multiplyScalar(0.62));
      m.needsUpdate = true;
    }
    this.empireLineMat.color.copy(hi);
    this.empireXrayMat.color.copy(hi);
    this.bandCol.value.copy(hi);
    for (const m of this.capMats) {
      // A cut face in a technical drawing is LIGHTER than the body it came from —
      // that difference is what tells you it is a section and not a surface. Off
      // the pre-compensated base, not the raw token, or the cap outruns the body
      // by far more than a section face should.
      m.color.copy(hsl(base, 1, 1.5));
      m.emissive.copy(base.clone().multiplyScalar(0.5));
    }
  }

  // ───────────────────────────────────────────────────────── ghost land mass
  /**
   * Each year is built as CHUNKS (4 longitude bands x 2 latitude bands) rather
   * than one merged mesh for the whole world. Merging everything would be a
   * single draw call, but a world-sized bounding sphere is never frustum-culled,
   * so once you fly inside the block all eighteen full-screen transparent sheets
   * are still rasterised even when only a corner of each is on screen — and this
   * scene is fill-rate bound, not draw-call bound.
   */
  private buildGhost() {
    const CHUNK_X = 4, CHUNK_Y = 2, NC = CHUNK_X * CHUNK_Y;
    const chunkOf = (bb: number[]) => {
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      const ix = Math.min(CHUNK_X - 1, Math.max(0, Math.floor((cx - LON0) / (360 / CHUNK_X))));
      const iy = Math.min(CHUNK_Y - 1, Math.max(0, Math.floor((cy - LAT0) / (180 / CHUNK_Y))));
      return ix + iy * CHUNK_X;
    };
    const t0 = performance.now();
    for (let i = 0; i < this.NY; i++) {
      const feats = this.DATA.byYear[this.years[i]];
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
        this.GHOST_TRIS += sbs[c].tris;
        const m = new THREE.Mesh(sbs[c].toBufferGeometry(), this.ghostMat);
        m.userData.pickable = true; m.renderOrder = 2; g.add(m);
        const l = new THREE.LineSegments(obs[c].toBufferGeometry(), this.ghostLineMat);
        l.userData.pickable = false; l.renderOrder = 3; gl.add(l);
      }
      this.ghostGroup.add(g); this.ghostLineGroup.add(gl); this.yearGroups.push([g, gl]);
    }
    this.GHOST_MS = Math.round(performance.now() - t0);
  }

  private zc() { return this.S.spacing === 'even' ? this.zEven : this.zTrue; }

  layoutSlices() {
    const z = this.zc();
    this.BANDS.zc.value.set(z); this.BANDS.n.value = Math.min(32, z.length);
    for (let i = 0; i < this.NY; i++) { this.yearGroups[i][0].position.z = z[i]; this.yearGroups[i][1].position.z = z[i]; }
    this.layoutLabels();
  }

  // ──────────────────────────────────────────────────────── block frame + axis
  private buildFrame() {
    const c = [[LON0, LAT0], [LON1, LAT0], [LON1, LAT1], [LON0, LAT1]];
    const pts: number[] = [];
    for (const zz of [Z_BOT, Z_TOP]) for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      pts.push(a[0] * SX, a[1] * SY, zz, b[0] * SX, b[1] * SY, zz);
    }
    for (const p of c) pts.push(p[0] * SX, p[1] * SY, Z_BOT, p[0] * SX, p[1] * SY, Z_TOP);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const ls = new THREE.LineSegments(g, this.frameMat); ls.userData.pickable = false;
    this.frameGroup.add(ls);

    this.yearLabels = this.years.map(y => {
      const s = this.makeLabel(fmtY(y), 30);
      this.labelGroup.add(s); return s;
    });
    const tickLine = new THREE.LineSegments(this.tickGeo, this.frameMat);
    tickLine.userData.pickable = false; this.frameGroup.add(tickLine);

    for (const [t, x, y] of [['N', 0, LAT1 + 16], ['S', 0, LAT0 - 16], ['W', LON0 - 22, 0], ['E', LON1 + 22, 0]] as [string, number, number][]) {
      const s = this.makeLabel(t, 30, 700, 0.62);
      s.position.set(x * SX, y * SY, Z_BOT - 4);
      this.labelGroup.add(s); this.compass.push(s);
    }
    {
      const s = this.makeLabel('▲ TIME', 26, 700, 0.72);
      s.position.set(LON0 * SX - 40, LAT1 * SY, Z_TOP + 22);
      this.labelGroup.add(s); this.compass.push(s);
    }
  }

  /**
   * A year is a MEASUREMENT, so every label inside the block is set in the mono
   * face — read through fontMono() so it tracks whatever next/font minted, not a
   * literal family name.
   */
  private makeLabel(text: string, size = 34, bold: number = 500, dim = 1) {
    const P = this.palette();
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = fontMono(size, bold);
    ctx.font = font;
    const pad = 8;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = size + pad * 2;
    c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    x.font = font; x.fillStyle = P.label; x.globalAlpha = dim;
    x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(text, pad, h / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(w * 0.34, h * 0.34, 1);
    sp.userData.pickable = false;
    sp.renderOrder = 900;
    sp.userData.label = { text, size, bold, dim };
    return sp;
  }

  private layoutLabels() {
    const z = this.zc();
    const pts: number[] = [];
    for (let i = 0; i < this.NY; i++) {
      this.yearLabels[i].position.set(LON0 * SX - 34, LAT1 * SY, z[i]);
      pts.push(LON0 * SX, LAT1 * SY, z[i], LON0 * SX - 14, LAT1 * SY, z[i]);
    }
    pts.push(LON0 * SX, LAT1 * SY, Z_BOT, LON0 * SX, LAT1 * SY, Z_TOP);
    this.tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this.tickGeo.computeBoundingSphere();
  }

  // ────────────────────────────────────────────────────────── the traced solid
  /**
   * A lineage is DIRECTED: ancestors are reached only through `from`, successors
   * only through `to`. Walking undirected would hop sideways off a fork and drag
   * in half the graph (Rome's undirected 2-hop neighbourhood is 13 polities and
   * its full closure is 79). Directed and depth-limited, Rome at 3 hops is the
   * chain you actually want: Republic -> Empire -> {West, Byzantium} -> Ottoman.
   */
  private lineageOf(id: string, depth: number) {
    const seen = new Set([id]);
    if (!this.polById.has(id) || depth <= 0) return [...seen];
    for (const key of ['to', 'from'] as const) {
      let front = [id];
      for (let k = 0; k < depth && front.length; k++) {
        const next: string[] = [];
        for (const c of front) for (const n of (this.polById.get(c)?.[key] ?? [])) if (!seen.has(n)) { seen.add(n); next.push(n); }
        front = next;
      }
    }
    return [...seen];
  }

  /** the polities currently being traced, ordered oldest-first */
  tracedIds() {
    return this.lineageOf(this.S.polity, this.S.lineage)
      .filter(id => this.polById.has(id))
      .sort((a, b) => this.polById.get(a)!.start - this.polById.get(b)!.start);
  }

  /**
   * Presence of a set of polity ids, snapshot by snapshot. The sovereign strings
   * are looked up PER SNAPSHOT rather than pooled across all of them, so the time
   * gate baked into the join is preserved: "Egypt" means Ancient Egypt at 3000
   * BCE and nothing at all in 1994.
   */
  private presenceOfIds(ids: string[]) {
    const polys: (PolyRef[] | null)[] = [], feats: Feature[][] = [];
    this.years.forEach((y) => {
      const want = new Set<string>();
      for (const id of ids) { const m = this.polById.get(id)?.match?.[y]; if (m) for (const n of m) want.add(n); }
      const ps: PolyRef[] = [], f: Feature[] = [];
      if (want.size) for (const ft of this.DATA.byYear[y]) if (want.has(ft.s)) {
        f.push(ft);
        for (const p of ft.p) ps.push({ rings: [p.o, ...p.h], bb: bboxOf(p.o) });
      }
      polys.push(ps.length ? ps : null); feats.push(f);
    });
    return { polys, feats };
  }

  /**
   * Which sovereign string this trace is best known by — and therefore which
   * colour it takes.
   *
   * Deliberately the SELECTED polity's own strings, not the whole lineage's.
   * Ranking the lineage by area instead gave Rome-at-3-links the Spanish
   * Empire's gold, because Spain is the biggest thing three directed hops from
   * Rome — the block changed colour when you changed the lineage depth, which
   * is exactly the wrong signal. The panel names one polity and the caption
   * swatches one hue; this is that hue.
   *
   * sovColor() is shared with map.ts and core.ts, so one empire is one hue in
   * all three views.
   */
  private colourFor(feats: Feature[][]) {
    const mine = this.polById.get(this.S.polity);
    const own = new Set<string>();
    if (mine) for (const y of this.years) for (const s of (mine.match?.[y] ?? [])) own.add(s);
    const area = new Map<string, number>();
    for (const row of feats) for (const f of row) if (own.has(f.s)) area.set(f.s, (area.get(f.s) ?? 0) + f.a);
    let best: string | null = null, bestA = -1;
    for (const [s, a] of area) if (a > bestA) { bestA = a; best = s; }
    // a polity with no geometry anywhere still gets a stable colour, off its name
    return sovColor(best ?? mine?.name ?? this.S.polity);
  }

  private clearGroup(g: THREE.Group) {
    for (const c of g.children) { if (!c.userData.noDispose) (c as THREE.Mesh).geometry?.dispose(); }
    g.clear();
  }

  private addXray(geom: THREE.BufferGeometry) {
    const x = new THREE.Mesh(geom, this.empireXrayMat);
    x.userData.pickable = false; x.renderOrder = 940;
    x.userData.noDispose = true;      // geometry is shared with the lit mesh
    this.empireGroup.add(x);
  }

  buildEmpire() {
    this.clearGroup(this.empireGroup);
    this.SOLID_STATS = null;
    const ids = this.tracedIds();
    this.TRACED = ids;
    const { polys, feats } = this.presenceOfIds(ids);
    const z = this.zc();
    const present = this.years.filter((_, i) => polys[i]);

    const col = this.colourFor(feats);
    if (col !== this.traceColour) { this.traceColour = col; this.applyTraceColour(); }
    this.describeTrace(ids, present);

    if (!present.length) { this.buildCaps([]); this.applyCut(); return; }

    // crisp per-snapshot outlines — anchors the smooth solid to the actual data
    if (this.S.outlines) {
      const ob = new OutlineBuilder();
      for (let i = 0; i < this.NY; i++) {
        if (!feats[i].length) continue;
        for (const f of feats[i]) for (const p of f.p) {
          ob.addPolygon(p, z[i] + SLAB / 2, SX, SY);
          ob.addPolygon(p, z[i] - SLAB / 2, SX, SY);
        }
      }
      const l = new THREE.LineSegments(ob.toBufferGeometry(), this.empireLineMat);
      l.userData.pickable = false; l.renderOrder = 5;
      this.empireGroup.add(l);
    }

    if (this.S.mode === 'off') { this.buildCaps([]); this.applyCut(); return; }

    if (this.S.mode === 'prisms') {
      const sb = new SlabBuilder();
      const t0 = performance.now();
      for (let i = 0; i < this.NY; i++) for (const f of feats[i]) for (const p of f.p) sb.addPolygon(p, z[i] - SLAB / 2, z[i] + SLAB / 2, SX, SY);
      const g = sb.toBufferGeometry();
      const m = new THREE.Mesh(g, this.empirePrismMat);
      m.userData.pickable = true; this.empireGroup.add(m);
      this.addXray(g);
      this.buildCaps([g]);
      this.SOLID_STATS = { mode: 'prisms', triangles: sb.tris, vertices: sb.v, ms: +(performance.now() - t0).toFixed(1) };
      this.applyCut(); return;
    }

    const { res, sub } = RES[this.S.res];
    const t0 = performance.now();
    const vol = buildSovereignVolumes({
      presence: polys, zc: z, half: SLAB / 2, res, sub, band: 6, smooth: 2,
      lonToX: (l) => l * SX, latToY: (l) => l * SY,
    });
    if (!vol) { this.buildCaps([]); this.applyCut(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(vol.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(vol.normals, 3));
    g.setIndex(new THREE.BufferAttribute(vol.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.empireMat);
    m.userData.pickable = true; m.renderOrder = 1;
    this.empireGroup.add(m);
    this.addXray(g);
    this.buildCaps([g]);
    this.SOLID_STATS = {
      mode: 'lofted', triangles: vol.stats.triangles, vertices: vol.stats.vertices,
      cell: vol.stats.cell, clusters: vol.stats.clusters, ms: +(performance.now() - t0).toFixed(1),
    };
    this.applyCut();
  }

  /** the headline, the polity's own one-line note, and the lineage chips */
  private describeTrace(ids: string[], present: number[]) {
    const sel = this.polById.get(this.S.polity);
    const live = ids.filter(i => this.polById.get(i)!.span > 0);
    this.hooks.onTrace?.({
      id: this.S.polity,
      name: sel ? sel.name : this.S.polity,
      note: sel ? sel.note : '',
      colour: this.traceColour,
      present, total: this.NY,
      linked: this.S.lineage ? Math.max(0, live.length - 1) : 0,
      chain: ids.map(i => this.polById.get(i)!).map(p => ({ id: p.id, name: p.name, span: p.span, sel: p.id === this.S.polity })),
    });
  }

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
  private stencilMat(plane: THREE.Plane, op: THREE.StencilOp) {
    return new THREE.MeshBasicMaterial({
      depthWrite: false, depthTest: false, colorWrite: false,
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: op, stencilZFail: op, stencilZPass: op,
      clippingPlanes: [plane],
    });
  }

  private makeCapMat(other: THREE.Plane) {
    // ORDER MATTERS. The whole cap pass runs BEFORE the solid (negative
    // renderOrder). Drawn after the solid, the cap loses the depth test to
    // whatever sliver of the solid sits between the eye and the plane and comes
    // out full of holes. Drawn first, into an empty depth buffer, it lays down
    // the section face and its depth; the solid then wins wherever it is
    // genuinely nearer, and the two caps occlude each other correctly.
    return new THREE.MeshStandardMaterial({
      roughness: 0.5, metalness: 0.0, emissiveIntensity: 1, side: THREE.DoubleSide,
      depthTest: true, depthWrite: true,
      clippingPlanes: [other],
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    });
  }

  /** rebuild the stencil + cap meshes for whatever geometry the solid now has */
  private buildCaps(geoms: THREE.BufferGeometry[]) {
    // geometry is shared with the lit solid, but each stencil mesh owns its
    // material (side + stencil op differ per mesh), so those must be released
    for (const c of this.capGroup.children) {
      if (c.userData.capSign !== undefined) continue;
      const m = (c as THREE.Mesh).material;
      if (m && !Array.isArray(m)) m.dispose();
    }
    this.capGroup.clear();
    if (!this.S.caps || !geoms.length) return;
    let zmin = Infinity, zmax = -Infinity;
    for (const g of geoms) {
      g.computeBoundingBox();
      zmin = Math.min(zmin, g.boundingBox!.min.z); zmax = Math.max(zmax, g.boundingBox!.max.z);
    }
    this.capZ = [zmin, zmax];
    let order = -30;
    const passes: [THREE.Side, THREE.StencilOp][] = [
      [THREE.BackSide, THREE.IncrementWrapStencilOp],
      [THREE.FrontSide, THREE.DecrementWrapStencilOp],
    ];
    this.capSpecs.forEach((spec, k) => {
      for (const g of geoms) {
        for (const [side, op] of passes) {
          const m = this.stencilMat(spec.plane, op); m.side = side;
          const mesh = new THREE.Mesh(g, m);
          mesh.renderOrder = order++;
          mesh.userData.pickable = false; mesh.userData.noDispose = true; mesh.userData.capIdx = k;
          this.capGroup.add(mesh);
        }
      }
      const cap = new THREE.Mesh(this.CAP_GEO, spec.mat);
      cap.userData.pickable = false; cap.userData.noDispose = true; cap.userData.capIdx = k;
      cap.renderOrder = order++;
      cap.userData.capSign = spec.sign;
      // the stencil must be zeroed before the next plane's pass counts anything
      cap.onAfterRender = (r) => r.clearStencil();
      this.capGroup.add(cap);
    });
    this.placeCaps();
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
  private placeCaps() {
    // A plane that misses the solid entirely has nothing to cap, and its stencil
    // pass would still redraw the whole solid twice. Skipping it halves the cost
    // in the common case where the cut only bites one end.
    const CAP_EPS = 0.06;
    const at = [-this.planeLo.constant, this.planeHi.constant];
    const live = at.map(z => z > this.capZ[0] && z < this.capZ[1]);
    for (const c of this.capGroup.children) {
      const k = c.userData.capIdx as number;
      c.visible = live[k];
      if (c.userData.capSign === undefined) continue;
      c.position.set(0, 0, at[k] + (c.userData.capSign > 0 ? -CAP_EPS : CAP_EPS));
    }
  }

  /**
   * Which materials the cut clips. The block FRAME and the year labels are left
   * unclipped on purpose: seeing the whole time axis around an isolated era is
   * how you know *where* the era sits.
   *
   * Clipping is attached and detached rather than left permanently on: a clip
   * plane compiles to a `discard`, and this scene is fill-rate bound — the same
   * reason the ghost shader deliberately avoids an alpha discard.
   */
  private setClipActive(onSolid: boolean, onGhost = onSolid) {
    if (onSolid !== this.clipSolidOn) {
      this.clipSolidOn = onSolid;
      for (const m of [this.empireMat, this.empirePrismMat, this.empireLineMat, this.empireXrayMat] as THREE.Material[]) {
        m.clippingPlanes = onSolid ? this.CLIP : null; m.needsUpdate = true;
      }
    }
    if (onGhost !== this.clipGhostOn) {
      this.clipGhostOn = onGhost;
      for (const m of [this.ghostMat, this.ghostFadeMat, this.ghostLineMat] as THREE.Material[]) {
        m.clippingPlanes = onGhost ? this.CLIP : null; m.needsUpdate = true;
      }
    }
  }

  // ─────────────────────────────────────────────────────── ghost / cut / slice
  applyGhost() {
    this.ghostMat.opacity = this.S.slice ? SLICE_GHOST : this.S.ghost * this.palette().ghostGain;
    this.empireXrayMat.opacity = Math.min(0.3, this.S.ghost * 0.9);
    this.empireXrayMat.visible = this.S.ghost > 0.02 && !this.S.slice;
    this.ghostGroup.visible = this.S.slice || this.S.ghost > 0.005;
    this.ghostLineMat.opacity = this.S.slice ? 0.5 : Math.min(0.32, this.S.ghost * 0.8);
    this.ghostLineGroup.visible = this.S.ghostLines && (this.S.slice || this.S.ghost > 0.005);
  }

  private zAtF(f: number) { return Z_BOT + (Z_TOP - Z_BOT) * f; }
  private fAtZ(z: number) { return (z - Z_BOT) / (Z_TOP - Z_BOT); }

  /** the (fractional) year at a world height, so the cut labels read as dates */
  private yearAtZ(z: number) {
    const zs = this.zc();
    if (z <= zs[0]) return this.years[0];
    for (let i = 0; i < this.NY - 1; i++) if (z <= zs[i + 1]) {
      const t = (z - zs[i]) / (zs[i + 1] - zs[i]);
      return this.years[i] + t * (this.years[i + 1] - this.years[i]);
    }
    return this.years[this.NY - 1];
  }
  private labelZ(z: number) { return fmtY(Math.round(this.yearAtZ(z))); }

  /** the world-z window the cut keeps */
  private cutWindow(): [number, number] {
    return this.S.slice ? this.sliceWindow() : [this.zAtF(this.S.cutLo), this.zAtF(this.S.cutHi)];
  }

  applyCut() {
    const [lo, hi] = this.cutWindow();
    this.planeLo.constant = -lo;
    this.planeHi.constant = hi;
    const cutting = this.S.slice || this.S.cutLo > 0.0015 || this.S.cutHi < 0.9985;
    // In slice mode the ghost is controlled per-snapshot instead. Clipping it too
    // would blank both sheets mid-cross-fade, when the window sits between slabs.
    this.setClipActive(cutting, cutting && !this.S.slice);
    this.placeCaps();
    this.capGroup.visible = cutting && this.S.caps && this.S.mode !== 'off';
    this.hooks.onCut?.({
      cutting, lo: this.S.cutLo, hi: this.S.cutHi,
      label: this.S.slice ? 'slice mode'
        : cutting ? `${this.labelZ(this.zAtF(this.S.cutLo))} → ${this.labelZ(this.zAtF(this.S.cutHi))}` : 'whole block',
    });
  }

  /**
   * Handles snap to the top and bottom faces of a snapshot slab, so isolating
   * whole eras is the default and a mid-slab section — the thing that shows off
   * the cap — is a deliberate drag.
   */
  snapCut(f: number, which: 'lo' | 'hi') {
    const z = this.zAtF(f), zs = this.zc(), half = SLAB / 2 + 0.5;
    let best: number | null = null, bd = 5;
    for (let i = 0; i < this.NY; i++) {
      const t = which === 'lo' ? zs[i] - half : zs[i] + half;
      const d = Math.abs(z - t);
      if (d < bd) { bd = d; best = t; }
    }
    return best === null ? f : Math.min(1, Math.max(0, this.fAtZ(best)));
  }

  setCut(f: number, which: 'lo' | 'hi') {
    f = this.snapCut(f, which);
    if (which === 'lo') this.S.cutLo = Math.min(f, this.S.cutHi - 0.004);
    else this.S.cutHi = Math.max(f, this.S.cutLo + 0.004);
    this.applyCut();
  }

  setCaps(on: boolean) { this.S.caps = on; this.buildEmpire(); this.applyCut(); }

  // ── single-slice mode ──────────────────────────────────────────────────────
  /**
   * Exactly one snapshot on screen at a time, meant to be watched from straight
   * above; playback steps through all eighteen so a region's evolution reads as
   * motion.
   *
   * HONESTY. The ghost world CROSS-FADES between two discrete sheets — it never
   * invents a map for an in-between date. The traced solid is a different kind of
   * object: it is already a continuous interpolated volume, so its clip window
   * SLIDES from one slab to the next, and the readout says "1600 → 1715 ·
   * interpolated" for exactly as long as what you are looking at is inference
   * rather than data.
   */
  private sliceWindow(): [number, number] {
    const zs = this.zc();
    const e = this.sliceT >= 1 ? 1 : this.sliceT * this.sliceT * (3 - 2 * this.sliceT);
    const z = zs[this.sliceFrom] + (zs[this.S.sliceI] - zs[this.sliceFrom]) * e;
    return [z - SLAB / 2 - 0.6, z + SLAB / 2 + 0.6];
  }

  private setYearMat(i: number, m: THREE.Material) {
    for (const c of this.yearGroups[i][0].children) (c as THREE.Mesh).material = m;
  }

  /** per frame while in slice mode: which sheets are up, and at what opacity */
  applySlice() {
    const e = this.sliceT >= 1 ? 1 : this.sliceT * this.sliceT * (3 - 2 * this.sliceT);
    for (let i = 0; i < this.NY; i++) {
      const cur = i === this.S.sliceI, prev = i === this.sliceFrom && e < 1;
      this.yearGroups[i][0].visible = cur || prev;
      this.yearGroups[i][1].visible = (cur || prev) && this.S.ghostLines;
      if (cur || prev) this.setYearMat(i, cur ? this.ghostMat : this.ghostFadeMat);
    }
    this.ghostMat.opacity = SLICE_GHOST * (this.sliceFrom === this.S.sliceI ? 1 : e);
    this.ghostFadeMat.opacity = SLICE_GHOST * (1 - e);
    this.applyCut();
    this.hooks.onSlice?.({
      on: true, i: this.S.sliceI, n: this.NY,
      year: this.years[this.S.sliceI], fromYear: this.years[this.sliceFrom],
      interpolated: e < 1,
    });
  }

  sliceGoto(i: number, animate = true) {
    i = ((i % this.NY) + this.NY) % this.NY;
    if (i === this.S.sliceI) return;
    this.sliceFrom = this.sliceT >= 1 ? this.S.sliceI : this.sliceFrom;
    this.S.sliceI = i;
    this.sliceT = animate ? 0 : 1;
    this.sliceHold = 0;
    this.applySlice();
  }

  /**
   * Single slice is a MODE, and it moves the camera to enter — overhead, because
   * one snapshot at a time is a map and a map is read from above. A mode that
   * moves the camera has to put it back, or turning it off leaves the reader
   * staring down at a block they were looking at from the side a moment ago.
   *
   * Put back only what we moved, though: if the reader has orbited away from
   * top since we flew there, that is where they want to be, and flying them
   * home would be the control arguing with them. So the return trip is kept
   * only while the camera is still where we parked it.
   */
  private sliceReturn: View | null = null;
  private atView(v: View, tol = 0.06) {
    const c = this.nav.currentView();
    const dth = Math.abs(((c.theta - v.theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    return Math.abs(c.phi - v.phi) < tol && dth < tol
      && Math.abs(c.radius - v.radius) < v.radius * 0.08
      && c.target.distanceTo(v.target) < 4;
  }

  setSlice(on: boolean, { fly = true } = {}) {
    if (on === this.S.slice) return;
    this.S.slice = on;
    if (on) {
      this.sliceFrom = this.S.sliceI; this.sliceT = 1;
      this.applyGhost();
      this.applySlice();
      if (fly) { this.sliceReturn = this.nav.currentView(); this.nav.flyTo(this.VIEWS.top, 700); }
    } else {
      const back = this.sliceReturn; this.sliceReturn = null;
      if (fly && back && this.atView(this.VIEWS.top)) this.nav.flyTo(back, 700);
      this.S.slicePlay = false;
      for (let i = 0; i < this.NY; i++) {
        this.yearGroups[i][0].visible = true;
        this.yearGroups[i][1].visible = this.S.ghostLines;
        this.setYearMat(i, this.ghostMat);
      }
      this.applyGhost();
      this.applyCut();
      this.hooks.onSlice?.({
        on: false, i: this.S.sliceI, n: this.NY, year: this.years[this.S.sliceI],
        fromYear: this.years[this.sliceFrom], interpolated: false,
      });
    }
    this.hooks.onState?.();
  }

  setPlay(on: boolean) { this.S.slicePlay = on; this.sliceHold = 0; }

  // ── projection + views ─────────────────────────────────────────────────────
  private syncCameraAspect() {
    const a = this.w / this.h;
    this.perspCam.aspect = a; this.perspCam.updateProjectionMatrix();
    this.orthoCam.left = -ORTHO_H * a / 2; this.orthoCam.right = ORTHO_H * a / 2;
    this.orthoCam.top = ORTHO_H / 2; this.orthoCam.bottom = -ORTHO_H / 2;
    this.orthoCam.updateProjectionMatrix();
    this.nav.viewportHeight = this.h;
  }

  setProjection(kind: Projection) {
    this.S.proj = kind;
    const want = kind === 'ortho' ? this.orthoCam : this.perspCam;
    if (want === this.nav.camera) return;
    this.syncCameraAspect();
    this.nav.useCamera(want, 42);
    this.camera = this.nav.camera;
  }

  flyTo(name: ViewName, ms = 750) { this.nav.flyTo(this.VIEWS[name], ms); }

  /** frame the traced solid: fly to it and pull the ghost back so it can be seen */
  frameEmpire(ms = 800) {
    const box = new THREE.Box3();
    let any = false;
    for (const c of this.empireGroup.children) {
      const g = (c as THREE.Mesh).geometry;
      if (!g || c.userData.noDispose) continue;
      g.computeBoundingBox();
      box.union(g.boundingBox!); any = true;
    }
    if (!any) return;
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    // perspective fit: half-diagonal / tan(fov/2), with headroom for the panel
    const r = Math.max(sz.length() * 0.5 / Math.tan(THREE.MathUtils.degToRad(42) / 2) * 1.25, 70);
    const cur = this.nav.currentView();
    this.nav.flyTo({ target: c, radius: r, theta: cur.theta, phi: THREE.MathUtils.clamp(cur.phi, 0.75, 1.4), fov: 42 }, ms);
    if (this.S.ghost > 0.07) { this.S.ghost = 0.07; this.applyGhost(); this.hooks.onState?.(); }
  }

  setSpin(on: boolean) { this.S.spin = on; this.nav.oc.autoRotate = on; this.nav.oc.autoRotateSpeed = 0.9; }

  // ── the trace list ─────────────────────────────────────────────────────────
  polities() { return this.listable; }
  polity(id: string) { return this.polById.get(id); }
  traced() { return this.TRACED; }

  /**
   * Ranked search over the curated table. The stem rule is the load-bearing
   * part: people type the country and the table holds the adjective, so "rome"
   * has to reach "Roman Empire" though it is not a substring of it and never
   * will be. Two words count as the same stem if they agree on at least three
   * leading characters and on 60% of the shorter one — rome/roman,
   * persia/persian, china/chinese. A first-word stem hit ranks above a
   * later-word one, so "rome" lands on the Roman Empire rather than the Holy
   * Roman Empire.
   */
  rank(q: string): Polity[] {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const esc = ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = new RegExp('\\b' + esc);
    const stem = (a: string, b: string) => {
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i >= 3 && i >= 0.6 * Math.min(a.length, b.length);
    };
    const out: { p: Polity; r: number }[] = [];
    for (const p of this.listable) {
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
    out.sort((a, b) => (a.r - b.r)
      || ((b.p.span > 0 ? 1 : 0) - (a.p.span > 0 ? 1 : 0))
      || (b.p.span - a.p.span) || (b.p.weight - a.p.weight));
    return out.map(o => o.p);
  }

  select(id: string) {
    if (!this.polById.has(id) || id === this.S.polity) return false;
    this.S.polity = id;
    this.buildEmpire();
    return true;
  }

  /**
   * NOTHING TRACED. The counterpart of select(), and the reason it exists:
   * dismissing the selection card clears the map's highlight, so it has to clear
   * the block's too, or the card and the canvas disagree about what is selected —
   * a lit solid with no card explaining it.
   *
   * An empty S.polity is a legal state everywhere downstream by construction:
   * lineageOf('') returns [''], tracedIds() drops it for not being in polById, so
   * buildEmpire() clears the group, builds no caps and reports an empty trace.
   * The ghost world, the cut, the slice and the camera are all untouched — this
   * puts out the light, it does not reset the view.
   */
  clearTrace() {
    if (!this.S.polity) return false;
    this.S.polity = '';
    this.buildEmpire();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────── theme
  /** re-read the Survey tokens: the shell's theme toggle changed underneath us */
  retheme() {
    const P = this.palette();
    this.ghostMat.color.copy(cssColor(P.ghost));
    this.ghostFadeMat.color.copy(cssColor(P.ghost));
    this.ghostLineMat.color.copy(cssColor(P.ghostLine));
    this.frameMat.color.copy(cssColor(P.frame));
    this.nav.setPivotColor(cssColor(tokens().accent));
    this.applyTraceColour();
    this.applyGhost();
    // the block's own labels are canvas textures, so new ink means new textures
    for (const sp of [...this.yearLabels, ...this.compass]) this.redrawLabel(sp);
  }

  private redrawLabel(sp: THREE.Sprite) {
    const d = sp.userData.label as { text: string; size: number; bold: number; dim: number };
    const fresh = this.makeLabel(d.text, d.size, d.bold, d.dim);
    const mat = sp.material as THREE.SpriteMaterial;
    const freshMat = fresh.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = freshMat.map;
    mat.needsUpdate = true;
    freshMat.map = null;
    freshMat.dispose();
  }

  // ─────────────────────────────────────────────────────────────────── frame
  resize(w: number, h: number) {
    if (w < 1 || h < 1) return;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.syncCameraAspect();
    this.renderer.setSize(w, h, false);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.update();                         // discard the idle gap
    this.raf = requestAnimationFrame(this.tick);
  }
  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    this.clock.update();
    const dt = Math.min(0.1, this.clock.getDelta());

    // ── single-slice playback ──────────────────────────────────────────────
    if (this.S.slice) {
      if (this.sliceT < 1) {
        this.sliceT = Math.min(1, this.sliceT + dt / SLICE_FADE);
        this.applySlice();
      } else if (this.S.slicePlay) {
        this.sliceHold += dt;
        if (this.sliceHold >= SLICE_DWELL) this.sliceGoto(this.S.sliceI + 1);
      }
    }

    this.nav.update(dt);
    this.relightForCamera(this.nav.oc.target);

    // year labels stack on top of each other in a top-down view — fade them out
    this.camera.getWorldDirection(_vd);
    const flat = THREE.MathUtils.clamp((Math.abs(_vd.z) - 0.72) / 0.2, 0, 1);
    const la = 1 - flat;
    for (let i = 0; i < this.yearLabels.length; i++) {
      const sp = this.yearLabels[i];
      // in slice mode only one date is on screen, so keep only its own tick label
      const a = this.S.slice ? (i === this.S.sliceI ? 1 : 0) : la;
      sp.material.opacity = a; sp.visible = a > 0.02;
    }

    this.renderer.render(this.scene, this.camera);

    this.frames++; this.tAcc += dt;
    this.hist.push(dt); if (this.hist.length > 240) this.hist.shift();
    if (this.tAcc >= 0.35) {
      this.fps = this.frames / this.tAcc; this.frames = 0; this.tAcc = 0;
      const mx = Math.max(...this.hist.slice(-120));
      this.worst = mx > 0 ? 1 / mx : 0;
      this.hooks.onStats?.(this.stats());
    }
  };

  stats(): CubeStats {
    const r = this.renderer.info.render;
    return {
      fps: this.fps, minFps: this.worst, tris: r.triangles, calls: r.calls,
      ghostTris: this.GHOST_TRIS, ghostMs: this.GHOST_MS, solid: this.SOLID_STATS,
    };
  }
  resetPerf() { this.hist.length = 0; this.worst = 0; this.frames = 0; this.tAcc = 0; }

  private relightForCamera(target: THREE.Vector3) {
    this.camera.getWorldDirection(_f);
    _r.crossVectors(_f, _u).normalize();
    const place = (light: THREE.DirectionalLight, a: number, b: number, c: number) => {
      _l.set(0, 0, 0).addScaledVector(_f, a).addScaledVector(_r, b).addScaledVector(_u, c).normalize();
      light.position.copy(target).addScaledVector(_l, -900);
      light.target.position.copy(target);
      light.target.updateMatrixWorld();
    };
    place(this.lightKey, 0.55, -0.70, 0.45);   // upper left, 45deg off the view axis
    place(this.lightFill, 0.40, 0.85, -0.25);  // lower right, cool
    place(this.lightRim, -0.85, 0.20, 0.45);   // behind the subject, warm edge
  }

  // ─────────────────────────────────────────────────────────────── keyboard
  /**
   * The shell owns ← → and space, but only in views whose rail is 'live'; the
   * cube's rail is 'legend', so these letters are free. Guarded on `running`,
   * which is false whenever the cube canvas is not the visible view.
   */
  private onKey = (ev: KeyboardEvent) => {
    if (!this.running) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = (ev.key || '').toLowerCase();
    if (k === 'r') this.flyTo('home');
    else if (k === 't') this.flyTo('top');
    else if (k === 'f') this.flyTo('front');
    else if (k === 'e') this.flyTo('side');
    else if (k === 'z') this.frameEmpire();
    else if (k === 'i') { this.setProjection(this.S.proj === 'ortho' ? 'persp' : 'ortho'); this.hooks.onState?.(); }
    else if (k === 'a') this.setSlice(!this.S.slice);
    else if (k === 'p') { if (!this.S.slice) this.setSlice(true); this.setPlay(!this.S.slicePlay); this.hooks.onState?.(); }
    else if (k === '[') { if (this.S.slice) { this.setPlay(false); this.sliceGoto(this.S.sliceI - 1); this.hooks.onState?.(); } }
    else if (k === ']') { if (this.S.slice) { this.setPlay(false); this.sliceGoto(this.S.sliceI + 1); this.hooks.onState?.(); } }
    else return;
    ev.preventDefault();
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    this.hooks.onBusy?.('the browser dropped the WebGL context — switch views and back');
  };

  // ───────────────────────────────────────────────────────────────── teardown
  dispose() {
    this.stop();
    removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.nav.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry && !o.userData.noDispose) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
