// Draws flattened LDraw geometry in the Anatomy kit's style: the same camera,
// the same four tones by facing, solids painted back to front, and LDraw's own
// hard edges plus its conditional (silhouette) edges as the linework.
//
// `paint` is deliberately self-contained (its camera and light are the kit's,
// copied exactly) so the page can inline it and redraw a part as you turn it.
import { colors } from "./ldraw.mjs";

// LDraw is y-down with z toward the viewer; the kit is z-up. This is a proper
// rotation, so windings and normals survive it.
export const toWorld = ([x, y, z]) => [x, z, -y];

const round = (v) => Math.round(v * 100) / 100;

// Compact world-space data: one flat array per face, edge and conditional edge.
export function packMesh(mesh, lift = [0, 0, 0]) {
  const w = (p) => toWorld(p).map((c, i) => round(c + lift[i]));
  return {
    tris: mesh.tris.map((t) => [t.color, t.solid ? 1 : 0, ...t.points.flatMap(w)]),
    edges: mesh.edges.map(([a, b]) => [...w(a), ...w(b)]),
    cond: mesh.cond.map((pts) => pts.flatMap(w)),
  };
}

export function mergePacked(list) {
  return { tris: list.flatMap((m) => m.tris), edges: list.flatMap((m) => m.edges), cond: list.flatMap((m) => m.cond) };
}

export function boundsOf(data) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of data.tris) {
    for (let i = 2; i < t.length; i++) {
      const axis = (i - 2) % 3;
      lo[axis] = Math.min(lo[axis], t[i]);
      hi[axis] = Math.max(hi[axis], t[i]);
    }
  }
  return { lo, hi };
}

export function cornersOf({ lo, hi }) {
  const out = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push([x, y, z]);
  return out;
}

// Only the colours a model uses, as { code: [hex, alpha] }.
export function paletteFor(data) {
  const all = colors();
  const out = {};
  for (const t of data.tris) {
    const entry = all.get(t[0]) ?? all.get(71);
    if (entry) out[t[0]] = [entry.value, entry.alpha];
  }
  return out;
}

/**
 * data     packMesh() output, in kit world units
 * P        a kit projection { origin, scale, azimuth, elevation }
 * mode     "color" paints LEGO colours shaded by facing; "tone" uses the kit's
 *          paper tones, like every other Anatomy figure
 * palette  paletteFor(data)
 */
export function paint(data, P, mode, palette) {
  const R = Math.PI / 180;
  const a = (P.azimuth ?? 45) * R;
  const e = (P.elevation ?? 30) * R;
  const sinA = Math.sin(a), cosA = Math.cos(a), sinE = Math.sin(e), cosE = Math.cos(e);
  const K = P.scale * Math.sqrt(1.6);
  const V = [cosA * cosE, sinA * cosE, sinE];
  const lUp = 1.2, lLen = Math.hypot(sinA, cosA, lUp);
  const Lt = [-sinA / lLen, cosA / lLen, lUp / lLen];
  const BANDS = [0, 0.2, 0.42, 0.62];
  const FACTORS = [0.58, 0.7, 0.82, 0.93, 1.06];
  const sx = (x, y) => P.origin[0] + (x * sinA - y * cosA) * K;
  const sy = (x, y, z) => P.origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * K;
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const bandOf = (s) => { let t = 0; while (t < 4 && s >= BANDS[t]) t++; return t; };
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((c) => Math.round(Math.max(0, Math.min(255, f <= 1 ? c * f : c + (255 - c) * (f - 1)))).toString(16).padStart(2, "0"))
      .join("");
  };
  const items = [];
  const RES = 1.5; // depth-buffer pixels per viewBox unit

  // Painter's order sorts by a face's centre, which goes wrong for a face much
  // bigger than its neighbours (a baseplate's top would paint over the bricks
  // standing on it). Faces wider than a stud are split into stud-sized
  // triangles first, so the order stays local.
  const TILE = 22;
  const faces = [];
  const split = (c, s, a, b, d) => {
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const bd = Math.hypot(b[0] - d[0], b[1] - d[1], b[2] - d[2]);
    const da = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const m = Math.max(ab, bd, da);
    if (m <= TILE) { faces.push([c, s, ...a, ...b, ...d]); return; }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    if (m === ab) { const n = mid(a, b); split(c, s, a, n, d); split(c, s, n, b, d); }
    else if (m === bd) { const n = mid(b, d); split(c, s, a, b, n); split(c, s, a, n, d); }
    else { const n = mid(d, a); split(c, s, a, b, n); split(c, s, n, b, d); }
  };
  for (const t of data.tris) {
    const n3 = (t.length - 2) / 3;
    const p = (i) => [t[2 + i * 3], t[3 + i * 3], t[4 + i * 3]];
    let big = false;
    for (let i = 0; i < n3 && !big; i++) {
      const a = p(i), b = p((i + 1) % n3);
      big = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > TILE;
    }
    if (!big) { faces.push(t); continue; }
    for (let i = 1; i + 1 < n3; i++) split(t[0], t[1], p(0), p(i), p(i + 1));
  }

  for (const t of faces) {
    const n3 = (t.length - 2) / 3;
    const px = [], py = [], pz = [];
    for (let i = 0; i < n3; i++) { px.push(t[2 + i * 3]); py.push(t[3 + i * 3]); pz.push(t[4 + i * 3]); }
    let ux, uy, uz, vx, vy, vz;
    if (n3 === 4) { ux = px[2] - px[0]; uy = py[2] - py[0]; uz = pz[2] - pz[0]; vx = px[3] - px[1]; vy = py[3] - py[1]; vz = pz[3] - pz[1]; }
    else { ux = px[1] - px[0]; uy = py[1] - py[0]; uz = pz[1] - pz[0]; vx = px[2] - px[0]; vy = py[2] - py[0]; vz = pz[2] - pz[0]; }
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let facing = nx * V[0] + ny * V[1] + nz * V[2];
    if (!t[1]) { if (facing < 0) { nx = -nx; ny = -ny; nz = -nz; } }
    else if (facing <= 1e-6) continue;
    const band = bandOf(nx * Lt[0] + ny * Lt[1] + nz * Lt[2]);
    let depth = 0, d = "";
    const scr = [];
    for (let i = 0; i < n3; i++) {
      const z = px[i] * V[0] + py[i] * V[1] + pz[i] * V[2];
      const X = sx(px[i], py[i]), Y = sy(px[i], py[i], pz[i]);
      depth += z;
      scr.push([X * RES, Y * RES, z]);
      d += (i ? "L" : "M") + f1(X) + " " + f1(Y);
    }
    let attrs;
    if (mode === "tone") attrs = band === 4 ? 'class="lg-face" data-top=""' : 'class="lg-face" data-shade="' + band + '"';
    else {
      const entry = palette[t[0]] ?? ["#a0a5a9", 1];
      const fill = shade(entry[0], FACTORS[band]);
      attrs = 'fill="' + fill + '" stroke="' + fill + '"' + (entry[1] < 1 ? ' fill-opacity="' + entry[1].toFixed(2) + '" stroke-opacity="' + entry[1].toFixed(2) + '"' : "");
    }
    items.push({ depth: depth / n3, scr, svg: "<path " + attrs + ' d="' + d + 'Z"/>' });
  }

  // Hidden surfaces and hidden lines. The faces are rasterised into a depth
  // buffer that also records which face won each pixel. A face that wins no
  // pixel is entirely hidden (the Technic frame inside a sculpted model) and is
  // dropped, which painter's order alone could not get right; and each edge
  // keeps only the stretches nothing stands in front of, since a face's
  // centre is nearer than its own far rim.
  const W = Math.ceil((P.width ?? 1000) * RES), H = Math.ceil((P.height ?? 800) * RES);
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  const ids = new Int32Array(W * H).fill(-1);
  let id = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const at = y * W + x;
        if (z > zbuf[at]) { zbuf[at] = z; ids[at] = id; }
      }
    }
  };
  items.forEach((item, index) => {
    id = index;
    const s = item.scr;
    for (let i = 1; i + 1 < s.length; i++) tri(...s[0], ...s[i], ...s[i + 1]);
  });
  const won = new Uint8Array(items.length);
  for (let i = 0; i < ids.length; i++) if (ids[i] >= 0) won[ids[i]] = 1;
  // A face too small to cover a pixel centre is kept if its middle is in front.
  const shown = items.filter((item, index) => {
    item.index = index;
    if (won[index]) return true;
    const cx = Math.floor(item.scr.reduce((a, p) => a + p[0], 0) / item.scr.length);
    const cy = Math.floor(item.scr.reduce((a, p) => a + p[1], 0) / item.scr.length);
    return cx >= 0 && cy >= 0 && cx < W && cy < H && item.depth >= zbuf[cy * W + cx] - 1.2;
  });

  // Order. Rasterise each shown face again: wherever another face won one of
  // its pixels, that face is in front of it and must be painted later. A
  // topological sort honours every such pair; depth only breaks ties and the
  // rare cycle, so painter's order no longer decides who covers whom.
  const slot = new Int32Array(items.length).fill(-1);
  shown.forEach((item, at) => { slot[item.index] = at; });
  const after = shown.map(() => []);
  const needs = new Int32Array(shown.length);
  const seen = new Set();
  let self = -1;
  const cover = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue;
        // Only where the other face is clearly nearer: along a seam where two
        // faces meet, both cover the pixel at the same depth, and counting that
        // would make each "in front" of the other.
        const z = w0 * az + w1 * bz + (1 - w0 - w1) * cz;
        if (zbuf[y * W + x] - z < 0.75) continue;
        const win = ids[y * W + x];
        if (win < 0 || win === items[self].index) continue;
        const front = slot[win];
        if (front < 0) continue;
        const key = self * shown.length + front;
        if (seen.has(key)) continue;
        seen.add(key);
        after[self].push(front);
        needs[front]++;
      }
    }
  };
  shown.forEach((item, at) => {
    self = at;
    const s = item.scr;
    for (let i = 1; i + 1 < s.length; i++) cover(...s[0], ...s[i], ...s[i + 1]);
  });
  // Kahn's algorithm, farthest ready face first; on a cycle take the farthest left.
  const heap = [];
  const push = (i) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (shown[heap[p]].depth <= shown[heap[c]].depth) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < heap.length && shown[heap[l]].depth < shown[heap[m]].depth) m = l;
        if (r < heap.length && shown[heap[r]].depth < shown[heap[m]].depth) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(shown.length);
  const order = [];
  needs.forEach((n, i) => { if (!n) push(i); });
  const rest = shown.map((_, i) => i).sort((a, b) => shown[a].depth - shown[b].depth);
  let cursor = 0;
  while (order.length < shown.length) {
    let i;
    if (heap.length) i = pop();
    else {
      while (done[rest[cursor]]) cursor++;
      i = rest[cursor];
    }
    if (done[i]) continue;
    done[i] = 1;
    order.push(shown[i]);
    for (const j of after[i]) if (--needs[j] === 0 && !done[j]) push(j);
  }
  shown.length = 0;
  shown.push(...order);

  // Hard edges always; a conditional edge only where its two control points
  // fall on the same side of it on screen, which is exactly the silhouette.
  let lines = "";
  const EPS = 1.2; // world units an edge may sit behind the face it lies on
  const edge = (x0, y0, z0, x1, y1, z1) => {
    const ax = sx(x0, y0), ay = sy(x0, y0, z0), bx = sx(x1, y1), by = sy(x1, y1, z1);
    const da = x0 * V[0] + y0 * V[1] + z0 * V[2], db = x1 * V[0] + y1 * V[1] + z1 * V[2];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * RES));
    let from = -1;
    const emit = (i0, i1) => {
      const u0 = i0 / steps, u1 = i1 / steps;
      lines += "M" + f1(ax + (bx - ax) * u0) + " " + f1(ay + (by - ay) * u0) + "L" + f1(ax + (bx - ax) * u1) + " " + f1(ay + (by - ay) * u1);
    };
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const px = Math.floor((ax + (bx - ax) * u) * RES), py = Math.floor((ay + (by - ay) * u) * RES);
      const depth = da + (db - da) * u;
      const front = px >= 0 && py >= 0 && px < W && py < H ? zbuf[py * W + px] : -Infinity;
      const seen = depth >= front - EPS;
      if (seen && from < 0) from = i;
      if (!seen && from >= 0) { if (i - 1 > from) emit(from, i - 1); from = -1; }
    }
    if (from >= 0 && steps > from) emit(from, steps);
  };
  for (const s of data.edges) edge(s[0], s[1], s[2], s[3], s[4], s[5]);
  for (const c of data.cond) {
    const X = (i) => sx(c[i * 3], c[i * 3 + 1]);
    const Y = (i) => sy(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
    const side = (i) => (X(1) - X(0)) * (Y(i) - Y(0)) - (Y(1) - Y(0)) * (X(i) - X(0));
    if (side(2) * side(3) > 0) edge(c[0], c[1], c[2], c[3], c[4], c[5]);
  }

  return shown.map((item) => item.svg).join("") + (lines ? '<path class="iso-line lg-edge" d="' + lines + '"/>' : "");
}

// Faces stroke in their own colour so neighbouring triangles show no seams.
export const LEGO_CSS = `
.lg path[fill]{stroke-width:.6;stroke-linejoin:round}
.lg .lg-face{stroke-width:.6;stroke-linejoin:round}
${[0, 1, 2, 3].map((s) => `.lg .lg-face[data-shade="${s}"]{fill:var(--anatomy-shade-${s});stroke:var(--anatomy-shade-${s})}`).join("\n")}
.lg .lg-face[data-top]{fill:var(--anatomy-top);stroke:var(--anatomy-top)}
.lg .lg-edge{stroke:var(--anatomy-hi);stroke-width:.7;stroke-linecap:round}
.lg[data-mode="color"] .lg-edge{stroke:rgba(20,20,20,.72)}
.iso[data-theme="dark"] .lg[data-mode="color"] .lg-edge,.lg[data-mode="color"][data-dark] .lg-edge{stroke:rgba(10,10,10,.85)}
`;
