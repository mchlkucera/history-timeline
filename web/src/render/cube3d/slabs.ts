/**
 * slabs.ts — turn flat lon/lat polygons into *slabs*: real prisms with
 * top cap, bottom cap and vertical side walls. This is what gives the map
 * sheets physical weight instead of being zero-thickness planes.
 *
 * Winding contract (guaranteed by scripts/build-data.mjs):
 *   outer rings are CCW, hole rings are CW.
 * With that, one wall-quad winding rule produces outward normals for both,
 * and holes stay open instead of being filled solid.
 *
 * PORTED from experiments/cube3d/src/geometry/slabs.js. Two changes: TypeScript
 * annotations, and `toBufferGeometry()` imports three itself instead of taking
 * the namespace as an argument — this whole directory only ever loads inside the
 * cube's dynamic chunk, so there is nothing to keep three out of here.
 */
import earcut from 'earcut';
import * as THREE from 'three';

/** outer ring + hole rings, each flat [lon, lat, lon, lat, ...] in degrees */
export interface SlabPoly { o: number[]; h: number[][] }

/** Accumulates many polygons into one interleaved buffer set. */
export class SlabBuilder {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  /** vertices emitted so far — also the next base index */
  v = 0;
  /** triangles emitted so far */
  tris = 0;

  /** @param sx @param sy  degrees -> world units (linear projection) */
  addPolygon(poly: SlabPoly, zBot: number, zTop: number, sx: number, sy: number) {
    const { o, h } = poly;
    // ---- flatten for earcut -------------------------------------------------
    const flat = o.slice();
    const holeIdx: number[] = [];
    for (const hole of h) { holeIdx.push(flat.length / 2); for (let i = 0; i < hole.length; i++) flat.push(hole[i]); }
    const tri = earcut(flat, holeIdx.length ? holeIdx : null, 2);
    if (!tri.length && !flat.length) return;

    const n = flat.length / 2;
    const P = this.pos, N = this.nor, I = this.idx;

    // ---- caps ---------------------------------------------------------------
    const topBase = this.v;
    for (let i = 0; i < n; i++) { P.push(flat[2 * i] * sx, flat[2 * i + 1] * sy, zTop); N.push(0, 0, 1); }
    this.v += n;
    const botBase = this.v;
    for (let i = 0; i < n; i++) { P.push(flat[2 * i] * sx, flat[2 * i + 1] * sy, zBot); N.push(0, 0, -1); }
    this.v += n;

    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t], b = tri[t + 1], c = tri[t + 2];
      // signed area in the projected XY frame decides the winding we emit
      const ax = P[(topBase + a) * 3], ay = P[(topBase + a) * 3 + 1];
      const bx = P[(topBase + b) * 3], by = P[(topBase + b) * 3 + 1];
      const cx = P[(topBase + c) * 3], cy = P[(topBase + c) * 3 + 1];
      const s = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (s > 0) { I.push(topBase + a, topBase + b, topBase + c); I.push(botBase + c, botBase + b, botBase + a); }
      else { I.push(topBase + a, topBase + c, topBase + b); I.push(botBase + b, botBase + c, botBase + a); }
      this.tris += 2;
    }

    // ---- side walls ---------------------------------------------------------
    const wall = (ring: number[]) => {
      const m = ring.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = ring[2 * i] * sx, ay = ring[2 * i + 1] * sy;
        const bx = ring[2 * j] * sx, by = ring[2 * j + 1] * sy;
        const dx = bx - ax, dy = by - ay;
        const L = Math.hypot(dx, dy) || 1;
        const nx = dy / L, ny = -dx / L; // outward for CCW-outer / CW-hole
        const base = this.v;
        P.push(ax, ay, zBot, bx, by, zBot, bx, by, zTop, ax, ay, zTop);
        N.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);
        this.v += 4;
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.tris += 2;
      }
    };
    wall(o);
    for (const hole of h) wall(hole);
  }

  isEmpty() { return this.idx.length === 0; }

  toBufferGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setIndex(new THREE.BufferAttribute(this.v > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Crisp coastline outlines for the top face of a slab — cheap, huge legibility win. */
export class OutlineBuilder {
  pos: number[] = [];
  addPolygon(poly: SlabPoly, z: number, sx: number, sy: number) {
    const rings = [poly.o, ...poly.h];
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = r[2 * i] * sx, ay = r[2 * i + 1] * sy;
        const bx = r[2 * j] * sx, by = r[2 * j + 1] * sy;
        this.pos.push(ax, ay, z, bx, by, z);
      }
    }
  }
  toBufferGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.computeBoundingSphere();
    return g;
  }
}
