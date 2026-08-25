/**
 * ONE POINTER REGISTRY, SHARED BY EVERY CANVAS VIEW.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The founder, on an iPad: "make sure this is functional also on iPad. right
 * now I can't zoom" — and, in the same breath, "the cube is super easy to
 * control on iPad for example."
 *
 * Both halves of that are one fact. The cube is the ONLY view in this app that
 * did not hand-roll its pointer handling: it hands the canvas to three.js
 * OrbitControls, which keeps a REGISTRY OF LIVE POINTER IDS and has a declared
 * touch mapping (CubeControls.ts: `oc.touches = { ONE: ROTATE, TWO: DOLLY_PAN }`).
 * Every other view stored exactly one drag object —
 *
 *     drag = { x: e.clientX, d0: this.d0, d1: this.d1 }
 *
 * — and overwrote it on every pointerdown. So a second finger was never a
 * SECOND POINTER; it was the first finger teleporting. Measured before this
 * file existed: a two-finger spread on #zoomCanvas left the span at 5026 years
 * exactly (no zoom at all) and slid the window 1369 years sideways. The zoom
 * was on `wheel` alone, and an iPad has no wheel.
 *
 * NOTE WHAT IS *NOT* THE PROBLEM: `touch-action: none` (app.css) is on the cube's
 * canvas too — OrbitControls sets it a second time, inline — and the cube pinches
 * beautifully. `touch-action: none` is not what suppresses pinch; it is what
 * DELIVERS raw multi-touch to the app instead of letting the browser eat it.
 * Removing it would break the cube, not fix the rest.
 *
 * ── SO THIS IS ORBITCONTROLS' BOOKKEEPING, LIFTED ───────────────────────────
 * Deliberately the same idiom, so the app has ONE gesture vocabulary rather
 * than a 3D one and a 2D one — which matters far more on touch than on desktop,
 * because there is no cursor and no tooltip to explain a difference.
 *
 *   1. A Map of live pointerId -> position. A second finger is a second entry.
 *   2. setPointerCapture on the FIRST pointer down, released when the LAST one
 *      lifts (OrbitControls.js onPointerDown/onPointerUp). Capture on the first
 *      only: capture is per-pointerId, so capturing every finger separately
 *      would be harmless but pointless, and releasing correctly gets fiddly.
 *   3. pointermove/up/cancel live on the ownerDocument while any pointer is
 *      down, not on the element — a finger that slides off the canvas mid-pinch
 *      still tracks, and a lift outside the canvas still ends the gesture.
 *   4. When two fingers drop back to one, the survivor RE-SEEDS the gesture
 *      (OrbitControls calls _onTouchStart with the surviving pointer). Here that
 *      is `onRebase`, so the view can re-latch its pan origin and the remaining
 *      finger keeps panning without a jump.
 *
 * ── WHAT THE VIEW STILL OWNS ────────────────────────────────────────────────
 * This tracker does not replace a view's own pointerdown/move/up. It rides
 * ALONGSIDE them and answers three questions they have to ask:
 *
 *      P.multi        two or more fingers are down: do not pan, do not select
 *      P.tapBlocked   this gesture has been a pinch: do not select on lift
 *      P.touch        the live gesture came from a finger, not a mouse
 *
 * bind() must be called BEFORE the view registers its own listeners, so that by
 * the time the view's pointerdown runs, `multi` is already true for the second
 * finger. Listener order on one element is registration order.
 */

/** Two fingers, as the only three numbers a pinch needs. Client coordinates. */
export interface Pinch2 {
  /** midpoint of the two contacts — the point a pinch zooms ABOUT */
  cx: number;
  cy: number;
  /** their separation in CSS px; the pinch's scale is a ratio of these */
  d: number;
}

export interface PinchOpts {
  /** The pinch has engaged (past the dead zone). `g` is the re-latched origin. */
  onStart?(g: Pinch2): void;
  /**
   * A pinch frame. `now` and `prev` are consecutive samples, so the view's
   * factor is a plain ratio — `prev.d / now.d` shrinks the span as the fingers
   * spread, which is the same sign the wheel's `pow(base, deltaY)` produces.
   */
  onPinch?(now: Pinch2, prev: Pinch2): void;
  /** The second finger left. Fires once per pinch. */
  onEnd?(): void;
  /**
   * Two fingers became one. The view should re-latch its drag origin on this
   * position, or the survivor will pan from wherever the gesture started and
   * jump. Mirrors OrbitControls' re-seed on `case 1:` of onPointerUp.
   */
  onRebase?(p: { clientX: number; clientY: number; pointerId: number }): void;
}

/**
 * THE DEAD ZONE, and why a pinch does not start on contact.
 *
 * Two fingers land a frame or two apart and the separation between them is
 * noisy for the first few samples, so engaging on the second pointerdown makes
 * every two-finger touch — including a two-finger tap, and the first instant of
 * a two-finger drag — nudge the zoom. 6px of separation change is below the
 * threshold at which a spread reads as intentional and far above contact noise.
 * The origin is RE-LATCHED at the moment of engagement, so the 6px is spent,
 * not applied: there is no jump when the pinch takes hold.
 */
const ENGAGE_PX = 6;

/** What bind() hands back: the three questions a view's own handlers must ask. */
export interface PointerSet {
  /** how many pointers are down on this element right now */
  readonly n: number;
  /** two or more: the view must not pan and must not select */
  readonly multi: boolean;
  /** a pinch happened in this gesture; suppress the select on lift */
  readonly tapBlocked: boolean;
  /** the live (or most recent) gesture is a finger or pen, not a mouse */
  readonly touch: boolean;
  /** drop everything — for a view being torn down or hidden */
  reset(): void;
}

/**
 * Track pointers on `el` and drive a two-finger pinch from them.
 * Returns the live state the view's own handlers consult.
 */
export function bindPinch(el: HTMLElement, opts: PinchOpts): PointerSet {
  const pts = new Map<number, { x: number; y: number }>();
  const doc = el.ownerDocument;
  let engaged = false;          // past ENGAGE_PX: onPinch is firing
  let tapBlocked = false;       // a pinch happened; no select until all fingers lift
  let touch = false;            // pointerType of the gesture
  let d0 = 0;                   // separation at the moment two fingers were down
  let prev: Pinch2 | null = null;
  let captured = -1;            // the pointerId we hold capture on, or -1

  const two = (): Pinch2 | null => {
    if (pts.size < 2) return null;
    const it = pts.values();
    const a = it.next().value!, b = it.next().value!;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(dx, dy) };
  };

  const stopTracking = () => {
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    doc.removeEventListener('pointercancel', onUp, true);
  };

  const endPinch = () => {
    if (engaged) { engaged = false; prev = null; opts.onEnd?.(); }
  };

  /**
   * THE PINCH IS RE-LATCHED WHENEVER THE CONTACT SET CHANGES, and that is not
   * pedantry — a third finger is an ordinary iPad accident (a resting thumb, a
   * system gesture starting) and it used to poison the next frame. With three
   * down, onMove has no defined pair to measure, so it returns without updating
   * `prev`; when the set drops back to two, the very next onPinch would then be
   * handed a `prev` from BEFORE the interruption and apply the whole intervening
   * movement in one frame — a visible jump, and on the timeline a multi-rung one.
   * Re-latching on every change means a pinch always measures against the frame
   * it is actually continuing from.
   */
  const relatch = () => {
    if (pts.size === 2) { const g = two()!; d0 = g.d; prev = g; }
    else { prev = null; engaged = false; }
  };

  function onDown(e: PointerEvent) {
    if (pts.size === 0) {
      // A NEW GESTURE. Everything a previous one latched is stale here — this is
      // the only place tapBlocked is cleared, because clearing it on the last
      // pointerup would clear it BEFORE the view's own pointerup handler ran and
      // the lift that ended a pinch would select whatever was under it.
      tapBlocked = false;
      try { el.setPointerCapture(e.pointerId); captured = e.pointerId; } catch { captured = -1; }
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
    }
    touch = e.pointerType !== 'mouse';
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size > 1) tapBlocked = true;     // more than one contact: never a tap
    if (pts.size > 2) endPinch();            // no defined pair any more
    relatch();
  }

  function onMove(e: PointerEvent) {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size !== 2) return;
    const g = two()!;
    if (!engaged) {
      if (Math.abs(g.d - d0) < ENGAGE_PX) { prev = g; return; }
      engaged = true; prev = g;              // spend the dead zone, do not apply it
      opts.onStart?.(g);
      return;
    }
    if (prev) opts.onPinch?.(g, prev);
    prev = g;
  }

  function onUp(e: PointerEvent) {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size === 0) {
      endPinch();
      if (captured >= 0) { try { el.releasePointerCapture(captured); } catch { /* already gone */ } captured = -1; }
      stopTracking();
      return;
    }
    if (pts.size === 1) {
      // two became one: end the pinch and hand the survivor back to the view, so
      // the remaining finger keeps panning from where it IS rather than from
      // where the gesture began.
      endPinch();
      relatch();
      const it = pts.entries().next().value;
      if (it) opts.onRebase?.({ clientX: it[1].x, clientY: it[1].y, pointerId: it[0] });
      return;
    }
    relatch();                               // three became two, or more: re-measure
  }

  el.addEventListener('pointerdown', onDown);

  return {
    get n() { return pts.size; },
    get multi() { return pts.size > 1; },
    get tapBlocked() { return tapBlocked; },
    get touch() { return touch; },
    reset() {
      endPinch(); pts.clear(); tapBlocked = false;
      if (captured >= 0) { try { el.releasePointerCapture(captured); } catch { /* already gone */ } captured = -1; }
      stopTracking();
    },
  };
}

/**
 * HOW FAR A FINGER MAY SLIDE AND STILL BE A TAP.
 *
 * Every view used 3px, which is a MOUSE number: a mouse that has moved three
 * pixels has been moved on purpose. A finger has not. A capacitive contact is a
 * ~9mm ellipse whose reported centroid rolls 3–6px while the finger presses and
 * releases, so at 3px almost every tap on an iPad came back `moved === true`,
 * the `if (wasDrag) return;` at the top of each pointerup fired, and NOTHING ON
 * THIS APP WAS SELECTABLE BY TOUCH — a bug that was hiding underneath the
 * missing zoom.
 *
 * 10px because that is a touch slop with precedent on both sides: Chrome's
 * gesture detector uses 8dp and UIKit's scroll recognisers about 10pt, and 10
 * CSS px is still well under the ~2mm at which a reader would say they had
 * dragged rather than tapped. The mouse keeps its 3.
 */
export const TAP_SLOP = 10;
export const MOUSE_SLOP = 3;
/**
 * How much every hit box grows for a TAP. The marks on these canvases are drawn
 * for a cursor — an event dot is a few pixels tall and a hairline spread is
 * thinner still — and a fingertip cannot be aimed at that. 6px each way turns a
 * 4px dot into a 16px target, which is as far as this can go before adjacent
 * rows start stealing each other's taps (the rung's row pitch is ~14px at the
 * reference step). It is NOT the 44px iOS floor and cannot be: 44px of pad on a
 * dense plot would make the topmost mark win every tap in its neighbourhood.
 * Chrome, where 44px does apply, is sized in CSS instead.
 */
export const TAP_PAD = 6;
/** The slop for whatever pointer this actually is. */
export const slopFor = (e: { pointerType?: string }) => (e.pointerType === 'mouse' ? MOUSE_SLOP : TAP_SLOP);

/**
 * SAFARI'S PROPRIETARY GESTURE EVENTS, refused once for the whole app.
 *
 * WebKit fires non-standard `gesturestart` / `gesturechange` / `gestureend` for
 * a two-finger pinch IN ADDITION to pointer events, and they are what drives
 * Safari's own whole-page magnification. Left alone, a pinch meant to zoom the
 * timeline also scales the document underneath it — and this shell is
 * `height: 100dvh; overflow: hidden`, so a magnified page is one you cannot pan
 * back out of. `touch-action` does not cover these; only preventDefault does.
 *
 * Scoped to `.tl-app` rather than the bare document so the refusal is the app's
 * and not the browser's — but the app IS the whole viewport here, so this does
 * cost iPad readers Safari's pinch-to-magnify over the chrome. Accepted: every
 * view now has a real zoom of its own, and iOS still offers text size through
 * the AA menu and Zoom through Accessibility.
 */
let gestureGuardArmed = false;
export function armSafariGestureGuard() {
  if (gestureGuardArmed || typeof document === 'undefined') return;
  gestureGuardArmed = true;
  const stop = (e: Event) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && !t.closest('.tl-app')) return;
    e.preventDefault();
  };
  for (const n of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(n, stop, { passive: false });
  }
}

/**
 * The same refusal on one element, for the canvases themselves. Belt and
 * braces: the document listener above already covers them, but a canvas is
 * where a pinch actually lands and an element listener runs first, so a future
 * `stopPropagation` anywhere in between cannot quietly re-enable page zoom.
 */
export function refuseSafariGestures(el: HTMLElement) {
  const stop = (e: Event) => e.preventDefault();
  for (const n of ['gesturestart', 'gesturechange', 'gestureend']) {
    el.addEventListener(n, stop, { passive: false });
  }
}

/** True where the primary input has no hover and no fine cursor — a finger. */
export const coarsePointer = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
