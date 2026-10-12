// Shared geometry helpers for the pin-tumbler figure.
// prismGen is a prism along any axis with a possibly concave cross-section:
// the kit's `extrude` logic transposed off the z axis, so the key's cut
// profile and the shell's bore both come out as one solid each.
import * as k from "../../kit/iso-kit.mjs";
import * as G from "../../kit/lathe.mjs";

const signedArea = (points) =>
  points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    return sum + (x * ny - nx * y);
  }, 0) / 2;

export const ccw = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);
const facingOut = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);

const runsOf = (flags, want) => {
  const count = flags.length;
  const runs = [];
  let start = -1;
  for (let index = 0; index < count * 2; index++) {
    const at = index % count;
    if (flags[at] === want) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0 && index - start <= count) {
      const run = [];
      for (let step = start; step <= index; step++) run.push(step % count);
      runs.push(run);
    }
    start = -1;
    if (index >= count) break;
  }
  return runs;
};

// F is a frame { o, a, u, v }; polygon is [[u, v], ...] in that frame's plane,
// swept from s0 to s1 along F.a.
export function prismGen(F, polygon, s0, s1, P) {
  const V = G.viewOf(P);
  const L = G.lightOf(P);
  const ring = ccw(polygon);
  const n = ring.length;
  const at = (s, [a, b]) => [
    F.o[0] + F.a[0] * s + F.u[0] * a + F.v[0] * b,
    F.o[1] + F.a[1] * s + F.u[1] * a + F.v[1] * b,
    F.o[2] + F.a[2] * s + F.u[2] * a + F.v[2] * b,
  ];
  const lowPts = ring.map((point) => k.iso(at(s0, point), P));
  const highPts = ring.map((point) => k.iso(at(s1, point), P));
  const nearIsHigh = G.dot3(F.a, V) > 0;
  const near = nearIsHigh ? highPts : lowPts;
  const far = nearIsHigh ? lowPts : highPts;

  const normals = ring.map(([ax, ay], index) => {
    const [bx, by] = ring[(index + 1) % n];
    return G.unit3(G.add3(G.mul3(F.u, by - ay), G.mul3(F.v, -(bx - ax))));
  });
  const facing = normals.map((normal) => G.dot3(normal, V) > 1e-6);

  const buckets = [[], [], [], [], []];
  const fills = [];
  for (let index = 0; index < n; index++) {
    if (!facing[index]) continue;
    const next = (index + 1) % n;
    const quad = facingOut([lowPts[index], lowPts[next], highPts[next], highPts[index]]);
    const d = k.pathOf(quad, true);
    buckets[G.bandOf(G.dot3(normals[index], L))].push(d);
    fills.push(d);
  }
  const capNormal = nearIsHigh ? F.a : G.mul3(F.a, -1);
  const capD = k.pathOf(facingOut(near), true);
  buckets[G.bandOf(G.dot3(capNormal, L))].push(capD);
  fills.push(capD);

  const outline = [];
  const crease = [];
  for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((index) => near[index])));
  for (const run of runsOf(facing, true)) {
    crease.push(k.pathOf(run.map((index) => near[index])));
    outline.push(k.pathOf(run.map((index) => far[index])));
  }
  for (let index = 0; index < n; index++) {
    if (facing[(index + n - 1) % n] !== facing[index]) outline.push(k.pathOf([near[index], far[index]]));
  }
  // A sharp corner on a face you can see reads as an edge.
  for (let index = 0; index < n; index++) {
    const prev = (index + n - 1) % n;
    const a = [ring[index][0] - ring[prev][0], ring[index][1] - ring[prev][1]];
    const b = [ring[(index + 1) % n][0] - ring[index][0], ring[(index + 1) % n][1] - ring[index][1]];
    const turn = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
    if (turn < Math.cos(0.4) && facing[index] && facing[prev]) crease.push(k.pathOf([near[index], far[index]]));
  }

  return {
    fill: fills.join(""),
    outline: outline.filter(Boolean).join(""),
    crease: crease.filter(Boolean).join(""),
    top: buckets[4].join(""),
    shades: buckets.slice(0, 4).map((list) => list.join("")),
  };
}

// Sutherland–Hodgman against a half-plane { p : dot(n, p) <= c }.
export function clipPoly(points, normal, c) {
  const out = [];
  const inside = ([x, y]) => normal[0] * x + normal[1] * y <= c + 1e-9;
  const cross = (a, b) => {
    const da = normal[0] * a[0] + normal[1] * a[1] - c;
    const db = normal[0] * b[0] + normal[1] * b[1] - c;
    const t = da / (da - db);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const inA = inside(a);
    const inB = inside(b);
    if (inA) out.push(a);
    if (inA !== inB) out.push(cross(a, b));
  }
  return out;
}

export const discPoly = (r, steps = 96, from = -Math.PI / 2) =>
  Array.from({ length: steps }, (_, index) => {
    const angle = from + (index / steps) * Math.PI * 2;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });

// A vertical coil: the kit's `coil` only runs along x or y.
export function coilZ(cx, cy, r, z0, z1, turns, P, perTurn = 14) {
  const count = Math.max(2, Math.round(turns * perTurn));
  const back = [];
  const front = [];
  let run = [];
  let near = null;
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    const angle = share * turns * Math.PI * 2;
    const point = [cx + r * Math.cos(angle), cy + r * Math.sin(angle), z0 + (z1 - z0) * share];
    const facing = k.depthOf([Math.cos(angle), Math.sin(angle), 0], P) > 0;
    const flat = k.iso(point, P);
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(k.pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(k.pathOf(run));
  return { back: back.join(""), front: front.join("") };
}
