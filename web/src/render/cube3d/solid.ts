/**
 * solid.ts — build a genuine 3-D volume for one sovereign.
 *
 * PORTED VERBATIM from experiments/cube3d/src/geometry/solid.js; the only
 * changes are TypeScript annotations. It touches no DOM and no three.js, so it
 * is pure numerics that could run in a worker unchanged.
 *
 * Approach: volumetric, not lofted. Each snapshot's territory is rasterised
 * into a 2-D signed distance field; the fields are stacked along the time axis
 * and linearly blended across the gaps; a naive-surface-nets isosurface is
 * extracted from the resulting 3-D scalar field.
 *
 * Why volumetric rather than stitching outline-to-outline:
 *   - topology may change between snapshots (one blob becomes three, an empire
 *     splits, a colony appears on another continent). Vertex-correspondence
 *     lofting has no answer for that; an SDF blend does the right thing for free.
 *   - the result is watertight and manifold by construction, so there are no
 *     self-intersections, no inverted faces, no black triangulation artefacts.
 *   - holes stay holes (the field is positive inside them).
 *
 * Each snapshot gets a flat-sided *slab* of its own (constant field between
 * zBot and zTop) so you can still read the 18 dates as belts in the solid;
 * only the gaps between them taper.
 */

// ---------------------------------------------------------------- 1-D EDT
// Felzenszwalb & Huttenlocher, exact, O(n).
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

const INF = 1e12;

/** squared euclidean distance transform of a binary seed mask (seed === want) */
function edt2(mask: Uint8Array, nx: number, ny: number, want: number, out: Float64Array, scratch: Scratch) {
  const { f, d, v, z } = scratch;
  for (let i = 0, N = nx * ny; i < N; i++) out[i] = mask[i] === want ? 0 : INF;
  // columns
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = out[x + y * nx];
    dt1d(f, ny, d, v, z);
    for (let y = 0; y < ny; y++) out[x + y * nx] = d[y];
  }
  // rows
  for (let y = 0; y < ny; y++) {
    const o = y * nx;
    for (let x = 0; x < nx; x++) f[x] = out[o + x];
    dt1d(f, nx, d, v, z);
    for (let x = 0; x < nx; x++) out[o + x] = d[x];
  }
  return out;
}

/** scanline even-odd rasteriser over every ring of every polygon */
function rasterize(rings: Ring[], nx: number, ny: number, x0: number, y0: number, cell: number, mask: Uint8Array) {
  mask.fill(0);
  const xs = [];
  for (let j = 0; j < ny; j++) {
    const py = y0 + (j + 0.5) * cell;
    xs.length = 0;
    for (const r of rings) {
      const m = r.length;
      for (let i = 0; i < m; i += 2) {
        const k = (i + 2) % m;
        const y1 = r[i + 1], y2 = r[k + 1];
        if ((y1 > py) !== (y2 > py)) xs.push(r[i] + (py - y1) * (r[k] - r[i]) / (y2 - y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * nx;
    for (let s = 0; s + 1 < xs.length; s += 2) {
      let a = Math.ceil((xs[s] - x0) / cell - 0.5);
      let b = Math.floor((xs[s + 1] - x0) / cell - 0.5);
      if (a < 0) a = 0; if (b > nx - 1) b = nx - 1;
      for (let x = a; x <= b; x++) mask[row + x] = 1;
    }
  }
  return mask;
}

// -------------------------------------------------------- naive surface nets
const CUBE_EDGES = new Int32Array(24);
const EDGE_TABLE = new Int32Array(256);
(function init() {
  let k = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) { CUBE_EDGES[k++] = i; CUBE_EDGES[k++] = p; }
    }
  }
  for (let i = 0; i < 256; i++) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << CUBE_EDGES[j])), b = !!(i & (1 << CUBE_EDGES[j + 1]));
      em |= a !== b ? (1 << (j >> 1)) : 0;
    }
    EDGE_TABLE[i] = em;
  }
})();

/**
 * @param data Float32Array field, index = x + nx*(y + ny*z); negative == inside
 * @returns {positions:Float32Array (grid space), indices:Uint32Array}
 */
export function surfaceNets(data: Float32Array, nx: number, ny: number, nz: number) {
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const nCells = cx * cy * cz;
  const vid = new Int32Array(nCells).fill(-1);
  const cmask = new Uint8Array(nCells);
  const positions: number[] = [];
  const g = new Float64Array(8);
  const sx = 1, sy = nx, sz = nx * ny;

  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        const base = x + y * sy + z * sz;
        let mask = 0;
        g[0] = data[base];                        if (g[0] < 0) mask |= 1;
        g[1] = data[base + sx];                   if (g[1] < 0) mask |= 2;
        g[2] = data[base + sy];                   if (g[2] < 0) mask |= 4;
        g[3] = data[base + sx + sy];              if (g[3] < 0) mask |= 8;
        g[4] = data[base + sz];                   if (g[4] < 0) mask |= 16;
        g[5] = data[base + sx + sz];              if (g[5] < 0) mask |= 32;
        g[6] = data[base + sy + sz];              if (g[6] < 0) mask |= 64;
        g[7] = data[base + sx + sy + sz];         if (g[7] < 0) mask |= 128;
        const ci = x + y * cx + z * cx * cy;
        cmask[ci] = mask;
        if (mask === 0 || mask === 255) continue;

        const em = EDGE_TABLE[mask];
        let vx = 0, vy = 0, vz = 0, cnt = 0;
        for (let i = 0; i < 12; i++) {
          if (!(em & (1 << i))) continue;
          const e0 = CUBE_EDGES[i << 1], e1 = CUBE_EDGES[(i << 1) + 1];
          const a = g[e0], b = g[e1];
          const dv = a - b;
          if (Math.abs(dv) < 1e-9) continue;
          const t = a / dv;
          // corner bit j of e0/e1 gives the coordinate along axis j
          const a0 = e0 & 1, b0 = e1 & 1;
          vx += a0 !== b0 ? (a0 ? 1 - t : t) : a0;
          const a1 = (e0 >> 1) & 1, b1 = (e1 >> 1) & 1;
          vy += a1 !== b1 ? (a1 ? 1 - t : t) : a1;
          const a2 = (e0 >> 2) & 1, b2 = (e1 >> 2) & 1;
          vz += a2 !== b2 ? (a2 ? 1 - t : t) : a2;
          cnt++;
        }
        if (!cnt) continue;
        vid[ci] = positions.length / 3;
        positions.push(x + vx / cnt, y + vy / cnt, z + vz / cnt);
      }
    }
  }

  // quads: one per grid edge that changes sign, spanning the 4 cells around it
  const indices: number[] = [];
  const du = [1, cx, cx * cy]; // cell strides per axis
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        const ci = x + y * cx + z * cx * cy;
        const mask = cmask[ci];
        if (mask === 0 || mask === 255) continue;
        const c0 = mask & 1;
        for (let j = 0; j < 3; j++) {
          const other = mask & (1 << (1 << j));
          if (!c0 === !other) continue;            // no sign change along this edge
          const iu = (j + 1) % 3, iv = (j + 2) % 3;
          const p = [x, y, z];
          if (p[iu] === 0 || p[iv] === 0) continue; // need the neighbours
          const a = vid[ci], b = vid[ci - du[iu]], c = vid[ci - du[iu] - du[iv]], d = vid[ci - du[iv]];
          if (a < 0 || b < 0 || c < 0 || d < 0) continue;
          if (c0) indices.push(a, b, c, a, c, d);
          else indices.push(a, d, c, a, c, b);
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Laplacian relaxation over the quad connectivity, in grid space. */
function relax(pos: Float32Array, idx: Uint32Array, iters: number, lambda: number) {
  if (iters <= 0) return;
  const n = pos.length / 3;
  const acc = new Float32Array(pos.length);
  const cnt = new Uint16Array(n);
  for (let it = 0; it < iters; it++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + (e + 1) % 3];
        acc[a * 3] += pos[b * 3]; acc[a * 3 + 1] += pos[b * 3 + 1]; acc[a * 3 + 2] += pos[b * 3 + 2];
        acc[b * 3] += pos[a * 3]; acc[b * 3 + 1] += pos[a * 3 + 1]; acc[b * 3 + 2] += pos[a * 3 + 2];
        cnt[a]++; cnt[b]++;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = cnt[i]; if (!c) continue;
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        pos[j] += lambda * (acc[j] / c - pos[j]);
      }
    }
  }
}

/** central-difference gradient of the field, trilinearly sampled (grid space) */
function gradientNormals(pos: Float32Array, data: Float32Array, nx: number, ny: number, nz: number) {
  const out = new Float32Array(pos.length);
  const sx = 1, sy = nx, sz = nx * ny;
  const at = (x: number, y: number, z: number) => data[
    Math.min(nx - 1, Math.max(0, x)) * sx +
    Math.min(ny - 1, Math.max(0, y)) * sy +
    Math.min(nz - 1, Math.max(0, z)) * sz];
  const sample = (fx: number, fy: number, fz: number) => {
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (w > 0) v += w * at(x + dx, y + dy, z + dz);
    }
    return v;
  };
  const H = 0.85;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = sample(x + H, y, z) - sample(x - H, y, z);
    out[i + 1] = sample(x, y + H, z) - sample(x, y - H, z);
    out[i + 2] = sample(x, y, z + H) - sample(x, y, z - H);
    const L = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (L > 1e-9) { out[i] /= L; out[i + 1] /= L; out[i + 2] /= L; }
    else { out[i] = 0; out[i + 1] = 0; out[i + 2] = 1; }
  }
  return out;
}

// ------------------------------------------------------------- volume build
/** one flat ring, [lon, lat, lon, lat, ...] in degrees */
export type Ring = number[];
/** one polygon of one snapshot, as buildSovereignVolumes wants it */
export interface PolyRef { rings: Ring[]; bb: number[] }
interface Scratch { f: Float64Array; d: Float64Array; v: Int32Array; z: Float64Array }
interface Item { i: number; p: PolyRef }
interface Cluster { g: Item[]; span: number; w: number; h: number; cell: number }

interface BaseOpts {
  /** slab centre z per snapshot index (world units) */
  zc: number[];
  /** slab half-thickness (world units) */
  half: number;
  /** target cells on the long axis */
  res?: number;
  /** sub-layers generated per inter-snapshot gap */
  sub?: number;
  /** |sdf| clamp, in degrees */
  band?: number;
  /** Laplacian relaxation passes over the isosurface */
  smooth?: number;
  cell?: number;
  lonToX: (lon: number) => number;
  latToY: (lat: number) => number;
}
/** per snapshot index: the flat rings present, or null */
export interface VolumeOpts extends BaseOpts { presence: (Ring[] | null)[] }
/** per snapshot index: the polygons present, or null */
export interface VolumesOpts extends BaseOpts { presence: (PolyRef[] | null)[] }

export interface VolumeStats {
  nx: number; ny: number; nz: number; cell: number; voxels: number;
  vertices: number; triangles: number; meshMs: number;
  snapshots: [number, number]; filledCells: number;
}
export interface VolumeResult {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array; stats: VolumeStats;
}
export interface MergedStats {
  clusters: number; clustersSkipped: number; cell: number;
  nx: number; ny: number; nz: number; voxels: number;
  vertices: number; triangles: number; meshMs: number; snapshots: [number, number];
}
export interface MergedVolume {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array; stats: MergedStats;
}

export function buildSovereignVolume(o: VolumeOpts): VolumeResult | null {
  const { presence, zc, half, lonToX, latToY } = o;
  const res = o.res ?? 150, sub = o.sub ?? 4, band = o.band ?? 6;

  let first = -1, last = -1;
  for (let i = 0; i < presence.length; i++) if (presence[i]) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;

  // ---- grid extents -------------------------------------------------------
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = first; i <= last; i++) {
    if (!presence[i]) continue;
    for (const r of presence[i]!) for (let k = 0; k < r.length; k += 2) {
      if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k];
      if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1];
    }
  }
  let cell = o.cell ?? Math.max(x1 - x0, y1 - y0) / res;
  if (!isFinite(cell) || cell <= 0) return null;
  cell = Math.max(cell, 0.06);
  const PAD = 4;
  x0 -= PAD * cell; y0 -= PAD * cell; x1 += PAD * cell; y1 += PAD * cell;
  let nx = Math.ceil((x1 - x0) / cell) + 1;
  let ny = Math.ceil((y1 - y0) / cell) + 1;

  // ---- z layer plan -------------------------------------------------------
  const zOfLayer: number[] = [];
  const srcLayer: number[] = [];              // snapshot index whose field this layer uses, or -1 == empty
  const mixLayer: (number[] | null)[] = []; // [iA, iB, t] for blended layers
  const EPS = Math.min(half * 0.55, 1.2);
  zOfLayer.push(zc[first] - half - EPS); srcLayer.push(-1); mixLayer.push(null);
  for (let i = first; i <= last; i++) {
    zOfLayer.push(zc[i] - half); srcLayer.push(i); mixLayer.push(null);
    zOfLayer.push(zc[i] + half); srcLayer.push(i); mixLayer.push(null);
    if (i < last) {
      const za = zc[i] + half, zb = zc[i + 1] - half;
      for (let s = 1; s < sub; s++) {
        const t = s / sub;
        zOfLayer.push(za + (zb - za) * t); srcLayer.push(-2); mixLayer.push([i, i + 1, t]);
      }
    }
  }
  zOfLayer.push(zc[last] + half + EPS); srcLayer.push(-1); mixLayer.push(null);
  const nz = zOfLayer.length;

  // ---- budget guard -------------------------------------------------------
  const BUDGET = 7e6;
  while (nx * ny * nz > BUDGET && cell < 30) {
    cell *= 1.35;
    nx = Math.ceil((x1 - x0) / cell) + 1;
    ny = Math.ceil((y1 - y0) / cell) + 1;
  }

  // Features smaller than the sampling grid cannot be represented; keeping them
  // turns a one-cell island into a full-height needle spike. Drop them.
  const minDiag = 2.2 * cell;
  const keep = (rings: Ring[]): Ring[] | null => {
    const out = rings.filter(r => {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < a) a = r[i]; if (r[i] > b) b = r[i];
        if (r[i + 1] < c) c = r[i + 1]; if (r[i + 1] > d) d = r[i + 1];
      }
      return Math.hypot(b - a, d - c) >= minDiag;
    });
    return out.length ? out : null;
  };
  const kept = presence.map(r => (r ? keep(r) : null));

  // ---- per-snapshot 2-D signed fields ------------------------------------
  const N = nx * ny;
  const scratch: Scratch = {
    f: new Float64Array(Math.max(nx, ny)), d: new Float64Array(Math.max(nx, ny)),
    v: new Int32Array(Math.max(nx, ny)), z: new Float64Array(Math.max(nx, ny) + 1)
  };
  const mask = new Uint8Array(N);
  const dOut = new Float64Array(N), dIn = new Float64Array(N);
  const fields = new Map<number, Float32Array>();
  let filledCells = 0;
  for (let i = first; i <= last; i++) {
    if (!kept[i]) continue;
    rasterize(kept[i]!, nx, ny, x0, y0, cell, mask);
    let any = 0; for (let k = 0; k < N; k++) any += mask[k];
    filledCells += any;
    const sdf = new Float32Array(N);
    if (any === 0) { sdf.fill(band); fields.set(i, sdf); continue; }
    if (any === N) { sdf.fill(-band); fields.set(i, sdf); continue; }
    edt2(mask, nx, ny, 1, dOut, scratch);
    edt2(mask, nx, ny, 0, dIn, scratch);
    for (let k = 0; k < N; k++) {
      const s = (Math.sqrt(dOut[k]) - Math.sqrt(dIn[k])) * cell;
      sdf[k] = s > band ? band : s < -band ? -band : s;
    }
    fields.set(i, sdf);
  }
  const EMPTY = new Float32Array(N).fill(band);

  // ---- stack --------------------------------------------------------------
  const data = new Float32Array(nx * ny * nz);
  for (let l = 0; l < nz; l++) {
    const off = l * N;
    const src = srcLayer[l];
    if (src === -1) { data.set(EMPTY, off); continue; }
    if (src >= 0) { data.set(fields.get(src) ?? EMPTY, off); continue; }
    const [ia, ib, t] = mixLayer[l]!;
    const A = fields.get(ia) ?? EMPTY, B = fields.get(ib) ?? EMPTY;
    for (let k = 0; k < N; k++) data[off + k] = A[k] + (B[k] - A[k]) * t;
  }

  // ---- isosurface ---------------------------------------------------------
  const t0 = performance.now();
  const { positions, indices } = surfaceNets(data, nx, ny, nz);
  // Naive surface nets puts one vertex per cell; on a near-vertical wall those
  // vertices zig-zag by a fraction of a cell and face-averaged normals turn the
  // zig-zag into visible vertical fluting. Two Laplacian passes plus normals
  // taken from the field gradient (which is smooth by construction) fix it.
  relax(positions, indices, o.smooth ?? 2, 0.55);
  const normals = gradientNormals(positions, data, nx, ny, nz);
  const meshMs = performance.now() - t0;

  // ---- grid space -> world -----------------------------------------------
  const out = new Float32Array(positions.length);
  const nOut = new Float32Array(normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    const lon = x0 + (positions[i] + 0.5) * cell;
    const lat = y0 + (positions[i + 1] + 0.5) * cell;
    const fz = positions[i + 2];
    const l = Math.min(nz - 2, Math.max(0, Math.floor(fz)));
    const tz = fz - l;
    const dz = zOfLayer[l + 1] - zOfLayer[l];
    out[i] = lonToX(lon);
    out[i + 1] = latToY(lat);
    out[i + 2] = zOfLayer[l] + dz * tz;
    // grid-space gradient -> world-space normal (z layers are not evenly spaced)
    const gx = normals[i] / cell, gy = normals[i + 1] / cell, gz = normals[i + 2] / Math.max(1e-4, dz);
    const L = Math.hypot(gx, gy, gz) || 1;
    nOut[i] = gx / L; nOut[i + 1] = gy / L; nOut[i + 2] = gz / L;
  }

  return {
    positions: out,
    normals: nOut,
    indices,
    stats: {
      nx, ny, nz, cell: +cell.toFixed(3),
      voxels: nx * ny * nz,
      vertices: out.length / 3,
      triangles: indices.length / 3,
      meshMs: +meshMs.toFixed(1),
      snapshots: [first, last] as [number, number],
      filledCells
    }
  };
}


// ---------------------------------------------------------------- clustering
/**
 * A scattered empire (Britain, Spain, Portugal) has territory on four
 * continents. Fitting one grid to its global bounding box makes the cells ~2
 * degrees wide, at which point the home island is five voxels across and the
 * whole thing dissolves into unrecognisable blobs.
 *
 * So: partition the sovereign's polygons into spatial clusters (union-find over
 * bounding boxes grown by the SDF band, across all snapshots at once, so a
 * territory that grows still stays one cluster), pick ONE cell size for the
 * sovereign from its largest cluster, and mesh each cluster on its own local
 * grid at that resolution. Compact empires produce exactly one cluster and this
 * costs nothing; global empires get every limb meshed at usable detail.
 */
export function buildSovereignVolumes(o: VolumesOpts): MergedVolume | null {
  const { presence } = o;             // per snapshot: array of {rings:[...], bb} or null
  const band = o.band ?? 6, res = o.res ?? 150;

  const items: Item[] = [];
  presence.forEach((polys, i) => { if (polys) for (const p of polys) items.push({ i, p }); });
  if (!items.length) return null;

  // union-find on bounding boxes expanded by the blend band
  const parent = items.map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const M = band;
  for (let a = 0; a < items.length; a++) {
    const A = items[a].p.bb;
    for (let b = a + 1; b < items.length; b++) {
      const B = items[b].p.bb;
      if (A[0] - M > B[2] + M || B[0] - M > A[2] + M || A[1] - M > B[3] + M || B[1] - M > A[3] + M) continue;
      const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb;
    }
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(it); });

  // Each cluster gets its own cell size, so a small limb is meshed as finely as
  // a big one instead of inheriting the empire's global scale. A floor keeps a
  // tiny island from demanding a needlessly enormous grid.
  let maxSpan = 0;
  const clusters: Cluster[] = [];
  for (const g of groups.values()) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { p } of g) { const b = p.bb; if (b[0] < x0) x0 = b[0]; if (b[2] > x1) x1 = b[2]; if (b[1] < y0) y0 = b[1]; if (b[3] > y1) y1 = b[3]; }
    const span = Math.max(x1 - x0, y1 - y0);
    if (span > maxSpan) maxSpan = span;
    clusters.push({ g, span, w: x1 - x0 + 2 * band, h: y1 - y0 + 2 * band, cell: 0 });
  }
  const floor = Math.max(0.07, maxSpan / (res * 12));
  for (const k of clusters) k.cell = Math.max(floor, k.span / res);

  // global voxel budget across every cluster
  const nzGuess = countLayers(presence, o.sub ?? 4);
  const voxels = (m: number) => clusters.reduce((s, k) => s + Math.ceil(k.w / (k.cell * m)) * Math.ceil(k.h / (k.cell * m)) * nzGuess, 0);
  let mult = 1, guard = 0;
  while (voxels(mult) > 9e6 && guard++ < 40) mult *= 1.2;
  for (const k of clusters) k.cell *= mult;

  clusters.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const parts: VolumeResult[] = [];
  let tris = 0, verts = 0, meshMs = 0, built = 0, skipped = 0, cell = 0;
  for (const k of clusters) {
    if (k.span < k.cell * 2.2) { skipped++; continue; }   // below the sampling resolution
    const sub: (Ring[] | null)[] = presence.map(() => null);
    for (const { i, p } of k.g) (sub[i] ??= []).push(...p.rings);
    const v = buildSovereignVolume({ ...o, presence: sub, cell: k.cell });
    if (!v || !v.indices.length) { skipped++; continue; }
    parts.push(v); built++; cell = cell ? Math.min(cell, v.stats.cell) : v.stats.cell;
    tris += v.stats.triangles; verts += v.stats.vertices; meshMs += v.stats.meshMs;
  }
  if (!parts.length) return null;

  // merge into one buffer set
  const nV = parts.reduce((s, p) => s + p.positions.length, 0);
  const nI = parts.reduce((s, p) => s + p.indices.length, 0);
  const positions = new Float32Array(nV), normals = new Float32Array(nV), indices = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo); normals.set(p.normals, vo);
    const base = vo / 3;
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + base;
    vo += p.positions.length; io += p.indices.length;
  }
  const s0 = parts[0].stats;
  return {
    positions, normals, indices,
    stats: {
      clusters: built, clustersSkipped: skipped, cell: +cell.toFixed(3),
      nx: s0.nx, ny: s0.ny, nz: s0.nz,
      voxels: parts.reduce((s, p) => s + p.stats.voxels, 0),
      vertices: verts, triangles: tris, meshMs: +meshMs.toFixed(1),
      snapshots: s0.snapshots
    }
  };
}

function countLayers(presence: unknown[], sub: number): number {
  let first = -1, last = -1;
  presence.forEach((p, i) => { if (p) { if (first < 0) first = i; last = i; } });
  if (first < 0) return 2;
  return 2 + (last - first + 1) * 2 + (last - first) * (sub - 1);
}
