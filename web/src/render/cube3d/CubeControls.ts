/**
 * CubeControls — navigation that behaves the way people expect from
 * Google Earth / Fusion / SketchUp, built on three's OrbitControls.
 *
 * What OrbitControls already gets right and we keep:
 *   - it is an *up-vector* controller, so roll is structurally impossible.
 *     There is no way to end up with a tilted horizon, ever.
 *   - polar angle is clamped just short of the poles, so azimuth never becomes
 *     undefined: no gimbal snap when you drag past straight-down.
 *   - damping gives real inertia — the pending delta decays after pointer-up
 *     instead of stopping dead.
 *   - zoomToCursor keeps the point under the pointer pinned while dollying.
 *
 * What we add, because OrbitControls on its own feels wrong on a tall block:
 *   1. DEPTH-PICKED PIVOT. On pointer-down we raycast the scene and move the
 *      orbit target *along the current view axis* to the depth of whatever is
 *      under the cursor. Because the new target is on the existing view ray,
 *      the camera neither moves nor re-aims — zero visual jump — but the orbit
 *      now happens around the thing you are looking at instead of the world
 *      origin. This is the single biggest reason the old cube felt bad: it
 *      always spun around a fixed centre, so anything you zoomed into swung
 *      off screen the moment you dragged.
 *   2. A VISIBLE PIVOT — an instrument mark, not an overlay. A hairline ring
 *      with four tick marks sits at the target while you drag. It is sized in
 *      SCREEN PIXELS (not world units), so it is the same small mark whether
 *      you are 3000 units out or 15 units deep inside the block, under either
 *      projection; and it eases in and out rather than popping.
 *   3. FLY-TO. Home / Top / Front / Side / double-click-to-focus are eased
 *      tweens in spherical space, so you always know where you ended up and
 *      can always get back.
 *   4. TWO PROJECTIONS. A perspective and an orthographic camera share one
 *      view state (target, radius, theta, phi, fov). Under orthographic, `fov`
 *      is a fiction we keep for continuity: it is converted to a frustum zoom
 *      via `zoom = orthoHeight / (2 * radius * tan(fov/2))`, which means every
 *      saved view frames exactly the same thing in both modes and the toggle
 *      is scale-free. Zoom-to-cursor, panning and the depth pivot are all
 *      handled by OrbitControls' own orthographic branches.
 *
 * PORTED from experiments/cube3d/src/nav/CubeControls.js. Behaviour is
 * unchanged; the diff is TypeScript annotations plus one narrowing helper
 * (`isOrthoCam`) standing in for the JS version's duck-typed
 * `camera.isOrthographicCamera` tests.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** the two cameras that share one view state */
export type CubeCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
const isOrthoCam = (c: CubeCamera): c is THREE.OrthographicCamera =>
  (c as THREE.OrthographicCamera).isOrthographicCamera === true;

/** a complete view: where the orbit target is, and how it is framed */
export interface View { target: THREE.Vector3; radius: number; theta: number; phi: number; fov: number }
/** a view to fly to — `fov` may be left to whatever the camera already has */
export interface ViewSpec { target: THREE.Vector3; radius: number; theta: number; phi: number; fov?: number }

/** OrbitControls damping internals the fly-to has to zero out */
interface OCInternals { _sphericalDelta?: THREE.Vector3; _panOffset?: THREE.Vector3; _scale?: number }

export class CubeControls {
  oc: OrbitControls;
  camera: CubeCamera;
  dom: HTMLElement;
  pickRoot: THREE.Object3D;
  bounds: THREE.Box3;
  glideTau: number;
  raycaster: THREE.Raycaster;
  pivotPx: number;
  viewportHeight: number;
  orthoHeight: number;
  orthoBack: number;
  pivotMarker: THREE.Group;
  private _pointer: THREE.Vector2;
  private _tween: { from: View; to: View; t0: number; ms: number } | null;
  private _dragging: boolean;
  private _matRing: THREE.LineBasicMaterial;
  private _matTick: THREE.LineBasicMaterial;
  private _matDot: THREE.MeshBasicMaterial;
  private _pivotA: number;
  private _pivotTarget: number;
  private _home: View | null = null;
  private _lastWheelPivot = 0;

  /**
   * @param pickRoot   objects the pivot raycast may hit
   * @param bounds     the block, used as a pivot fallback
   */
  constructor(camera: CubeCamera, dom: HTMLElement, pickRoot: THREE.Object3D, bounds: THREE.Box3) {
    camera.up.set(0, 0, 1);                       // time is up
    const oc = new OrbitControls(camera, dom);
    this.oc = oc;
    this.camera = camera;
    this.dom = dom;
    this.pickRoot = pickRoot;
    this.bounds = bounds;

    oc.enableDamping = true;
    // OrbitControls applies damping once per update(), so a fixed dampingFactor
    // means the glide is twice as short on a 120 Hz display as on a 60 Hz one.
    // We recompute it from the real frame time each tick against a fixed time
    // constant, so the feel is identical on every machine.
    this.glideTau = 0.20;                         // seconds to decay to 1/e
    oc.dampingFactor = 0.075;
    oc.rotateSpeed = 0.85;
    oc.panSpeed = 0.9;
    oc.zoomSpeed = 0.9;
    oc.screenSpacePanning = true;                 // pan in the plane of the screen, not the ground
    oc.zoomToCursor = true;
    oc.minDistance = 12;
    oc.maxDistance = 3200;
    // the orthographic equivalents of minDistance/maxDistance: an ortho camera
    // does not dolly, it changes frustum size, so the same limits have to be
    // expressed as zoom bounds (600 / 2*r*tan(21deg) at r = 3200 and r = 12)
    oc.minZoom = 0.2;
    oc.maxZoom = 70;
    oc.minPolarAngle = 0.0015;                    // never exactly at the pole
    oc.maxPolarAngle = Math.PI - 0.0015;
    oc.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    oc.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    oc.keyPanSpeed = 22;
    oc.listenToKeyEvents(window);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line!.threshold = 3;
    this._pointer = new THREE.Vector2();
    this._tween = null;
    this._dragging = false;

    // pivot marker ---------------------------------------------------------
    // Built in a unit frame (radius 1 == PIVOT_PX screen pixels) and scaled per
    // frame from the projection, so its size on screen never changes. Lines,
    // not filled rings: a 1-px stroke reads as a precise instrument mark.
    this.pivotPx = 9;                 // ring radius, CSS pixels
    this.viewportHeight = (typeof innerHeight === 'number' ? innerHeight : 1000);
    this.orthoHeight = 600;           // base ortho frustum height, world units
    this.orthoBack = 900;             // how far behind the eye the ortho near plane sits

    const circle = (r: number, n: number) => {
      const p: number[] = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push(Math.cos(a) * r, Math.sin(a) * r, 0); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
      return g;
    };
    const ticks = () => {
      const p: number[] = [], a = 1.45, b = 2.05;   // start outside the ring, leave the centre clear
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.push(dx * a, dy * a, 0, dx * b, dy * b, 0);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
      return g;
    };
    this._matRing = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this._matTick = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this._matDot = new THREE.MeshBasicMaterial({ color: 0xfff0d6, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.pivotMarker = new THREE.Group();
    this.pivotMarker.add(
      new THREE.LineLoop(circle(1, 64), this._matRing),
      new THREE.LineSegments(ticks(), this._matTick),
      new THREE.Mesh(new THREE.CircleGeometry(0.17, 10), this._matDot)
    );
    this.pivotMarker.traverse(o => { o.userData.pickable = false; o.renderOrder = 999; });
    this.pivotMarker.renderOrder = 999;
    this._pivotA = 0;          // current eased alpha
    this._pivotTarget = 0;     // 0 or 1

    dom.addEventListener('pointerdown', this._onDown, { capture: true });
    dom.addEventListener('pointerup', this._onUp, { capture: true });
    dom.addEventListener('pointercancel', this._onUp, { capture: true });
    dom.addEventListener('dblclick', this._onDblClick);
    dom.addEventListener('contextmenu', (e: Event) => e.preventDefault());
    dom.addEventListener('wheel', this._onWheel, { passive: true, capture: true });
  }

  // -------------------------------------------------------------- pivoting
  private _ndc(e: { clientX: number; clientY: number }) {
    const r = this.dom.getBoundingClientRect();
    this._pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this._pointer;
  }

  /** world point under the cursor: geometry hit, else block-box hit, else block centre plane */
  pickPoint(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.pickRoot, true)
      .filter(h => h.object.visible && h.object.userData.pickable !== false);
    if (hits.length) return hits[0].point.clone();
    const box = this.raycaster.ray.intersectBox(this.bounds, new THREE.Vector3());
    if (box) return box;
    return null;
  }

  /**
   * Move the orbit target to the depth of `point` *along the current view axis*.
   * Keeping the target on the view ray means the camera does not have to turn,
   * so there is no jump — only the orbit radius changes.
   */
  setPivotAtDepth(point: THREE.Vector3 | null) {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    let depth;
    if (point) depth = point.clone().sub(cam.position).dot(dir);
    else depth = this.bounds.getCenter(new THREE.Vector3()).sub(cam.position).dot(dir);
    if (!isFinite(depth)) return;
    depth = Math.min(Math.max(depth, this.oc.minDistance * 1.05), this.oc.maxDistance * 0.9);
    this.oc.target.copy(cam.position).addScaledVector(dir, depth);
  }

  private _onDown = (e: PointerEvent) => {
    if (this._tween) { this._tween = null; this.oc.enabled = true; }
    if (e.button === 0 || e.button === 1) {
      this.setPivotAtDepth(this.pickPoint(e));
      this._dragging = true;
      this._pivotTarget = 1;
    }
  };

  private _onUp = () => { this._dragging = false; this._pivotTarget = 0; };

  // zoom-to-cursor works best when the target is also at the cursor's depth
  private _onWheel = (e: WheelEvent) => {
    if (this._dragging) return;
    const now = performance.now();
    if (now - (this._lastWheelPivot || 0) < 180) return;   // don't raycast every wheel tick
    this._lastWheelPivot = now;
    this.setPivotAtDepth(this.pickPoint(e));
  };

  private _onDblClick = (e: MouseEvent) => {
    const p = this.pickPoint(e);
    if (!p) return;
    // pure translation: keep orientation, recentre on the clicked point, close in a little
    const off = this.camera.position.clone().sub(this.oc.target);
    const r = off.length();
    const sph = new THREE.Spherical().setFromVector3(off.clone().applyQuaternion(this._upQuat()));
    this.flyTo({ target: p, radius: Math.max(this.oc.minDistance * 1.4, r * 0.55), theta: sph.theta, phi: sph.phi }, 620);
  };

  private _upQuat() { return new THREE.Quaternion().setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0)); }

  // ------------------------------------------------------------------ views
  isOrtho() { return isOrthoCam(this.camera); }

  /**
   * World units per screen pixel at the orbit target. Perspective: the frustum
   * widens with distance. Orthographic: distance is irrelevant, only zoom is.
   * This is what keeps the pivot marker exactly the same size on screen in
   * both projections, at any depth.
   */
  worldPerPixel(dist = this.camera.position.distanceTo(this.oc.target)) {
    const cam = this.camera;
    const h = isOrthoCam(cam)
      ? (cam.top - cam.bottom) / cam.zoom
      : 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    return h / Math.max(1, this.viewportHeight);
  }

  /** the world height visible at the target plane for a (radius, fov) pair */
  private _heightFor(radius: number, fovDeg: number) { return 2 * radius * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2); }

  currentView(): View {
    const cam = this.camera;
    const off = cam.position.clone().sub(this.oc.target).applyQuaternion(this._upQuat());
    const s = new THREE.Spherical().setFromVector3(off);
    // under ortho, report the perspective fov that would frame the same height
    const fov = isOrthoCam(cam)
      ? THREE.MathUtils.radToDeg(2 * Math.atan(((cam.top - cam.bottom) / cam.zoom) / (2 * Math.max(1e-3, s.radius))))
      : cam.fov;
    return { target: this.oc.target.clone(), radius: s.radius, theta: s.theta, phi: s.phi, fov };
  }

  applyView(v: ViewSpec) {
    const cam = this.camera;
    const s = new THREE.Spherical(v.radius, THREE.MathUtils.clamp(v.phi, this.oc.minPolarAngle, this.oc.maxPolarAngle), v.theta);
    const off = new THREE.Vector3().setFromSpherical(s).applyQuaternion(this._upQuat().clone().invert());
    this.oc.target.copy(v.target);
    cam.position.copy(v.target).add(off);
    if (isOrthoCam(cam)) {
      const want = this._heightFor(s.radius, v.fov ?? 42);
      cam.zoom = (cam.top - cam.bottom) / Math.max(1e-4, want);
      this._orthoDepth(s.radius);
    } else if (v.fov && Math.abs(cam.fov - v.fov) > 1e-3) {
      cam.fov = v.fov; cam.updateProjectionMatrix();
    }
    cam.lookAt(v.target);
    cam.updateMatrixWorld();
  }

  /**
   * Orthographic depth range. A parallel camera has no natural near plane, and
   * the orbit radius can drop to a few units when you pivot deep inside the
   * block, which would slice the world in half. So the near plane sits a fixed
   * distance BEHIND the eye and the far plane trails the radius. Ortho depth is
   * linear, so a 4000-unit range costs nothing in precision. (Geometry behind
   * the eye is handled by the ghost's near-fade, which drives alpha to zero for
   * anything with negative view depth.)
   */
  private _orthoDepth(radius: number) {
    const near = -this.orthoBack, far = radius + this.orthoBack + 1600;
    if (Math.abs(this.camera.near - near) > 0.5 || Math.abs(this.camera.far - far) > 8) {
      this.camera.near = near; this.camera.far = far;
    }
    this.camera.updateProjectionMatrix();
  }

  /**
   * Swap the projection without changing what is on screen. The visible world
   * height at the target is preserved exactly: going to ortho we convert
   * (radius, fov) into a zoom; coming back we keep a normal `fov` and solve for
   * the radius that frames the same height, so you never get a 3-degree lens.
   */
  useCamera(cam: CubeCamera, fovForPerspective = 42) {
    if (cam === this.camera) return;
    const v = this.currentView();
    const height = this._heightFor(v.radius, v.fov);
    cam.up.set(0, 0, 1);
    this.camera = cam;
    this.oc.object = cam;
    const radius = isOrthoCam(cam) ? v.radius : height / (2 * Math.tan(THREE.MathUtils.degToRad(fovForPerspective) / 2));
    const fov = isOrthoCam(cam) ? v.fov : fovForPerspective;
    if (isOrthoCam(cam)) cam.zoom = (cam.top - cam.bottom) / Math.max(1e-4, height);
    this.applyView({ target: v.target, radius, theta: v.theta, phi: v.phi, fov });
    this._stopDamping();
    return this.currentView();
  }

  setHome(v: View) { this._home = { target: v.target.clone(), radius: v.radius, theta: v.theta, phi: v.phi, fov: v.fov }; }

  home(ms = 750) { if (this._home) this.flyTo(this._home, ms); }

  flyTo(v: ViewSpec, ms = 700) {
    this._stopDamping();
    const from = this.currentView();
    // take the short way round the azimuth
    let dTheta = v.theta - from.theta;
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    this._tween = { from, to: { ...v, theta: from.theta + dTheta, fov: v.fov ?? from.fov }, t0: performance.now(), ms };
    this.oc.enabled = false;
  }

  private _stopDamping() {
    // OrbitControls' pending-delta state is private and untyped; a fly-to has to
    // zero it or the tween lands and then keeps gliding on the leftover delta.
    const oc = this.oc as unknown as OCInternals;
    if (oc._sphericalDelta) oc._sphericalDelta.set(0, 0, 0);
    if (oc._panOffset) oc._panOffset.set(0, 0, 0);
    if ('_scale' in oc) oc._scale = 1;
  }

  isFlying() { return !!this._tween; }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (dt > 0) this.oc.dampingFactor = Math.min(0.5, Math.max(0.02, 1 - Math.exp(-dt / this.glideTau)));
    if (this._tween) {
      const { from, to, t0, ms } = this._tween;
      const raw = Math.min(1, (performance.now() - t0) / ms);
      const k = easeInOutCubic(raw);
      this.applyView({
        target: from.target.clone().lerp(to.target, k),
        radius: from.radius + (to.radius - from.radius) * k,
        theta: from.theta + (to.theta - from.theta) * k,
        phi: from.phi + (to.phi - from.phi) * k,
        fov: from.fov + (to.fov - from.fov) * k
      });
      if (raw >= 1) { this._tween = null; this.oc.enabled = true; this._stopDamping(); }
    } else {
      this.oc.update();
    }
    const d = this.camera.position.distanceTo(this.oc.target);
    if (this.isOrtho()) this._orthoDepth(d);

    // pivot marker ---------------------------------------------------------
    // Scale from world-units-per-pixel so the mark is `pivotPx` pixels no
    // matter the depth or the projection; billboard it to the camera; ease the
    // alpha with separate rise / fall time constants so it appears and leaves
    // rather than pops.
    const m = this.pivotMarker;
    m.position.copy(this.oc.target);
    m.scale.setScalar(this.worldPerPixel(d) * this.pivotPx);
    m.quaternion.copy(this.camera.quaternion);
    const want = this._tween ? 0 : this._pivotTarget;          // never during a fly-to
    const tau = want > this._pivotA ? 0.085 : 0.155;   // quick to appear, unhurried to leave
    this._pivotA += (want - this._pivotA) * (1 - Math.exp(-(dt || 0.016) / tau));
    if (this._pivotA < 0.002) this._pivotA = 0;
    const a = this._pivotA;
    this._matRing.opacity = a * 0.62;
    this._matTick.opacity = a * 0.40;
    this._matDot.opacity = a * 0.78;
    m.visible = a > 0.004;
  }

  /**
   * SURVEY: the pivot marker is CHROME, not data — it means "where you are",
   * which is exactly what the shell's one accent hue means, and exactly what a
   * pivot is. Added to the ported class so the engine can hand it a token
   * instead of the prototype's hard-coded amber.
   */
  setPivotColor(c: THREE.ColorRepresentation) {
    this._matRing.color.set(c); this._matTick.color.set(c); this._matDot.color.set(c);
  }

  dispose() { this.oc.dispose(); }
}
