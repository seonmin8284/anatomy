// LEGO's two measuring systems, in LDraw units (1 LDU = 0.4 mm).
//
//   across:  a stud pitch is 8 mm = 20 LDU, and the finest real offset is half
//            a stud (jumper plates, offset brackets) = 4 mm = 10 LDU
//   up:      a plate is 3.2 mm = 8 LDU = 0.4 stud, the smallest step in height;
//            a brick is three plates, 9.6 mm = 24 LDU = 1.2 studs
//
// Everything that places, checks or measures a part goes through here.

export const LDU_MM = 0.4;
export const STUD = 20;
export const HALF_STUD = STUD / 2; // the horizontal grid
export const PLATE = 8; // the vertical grid
export const BRICK = PLATE * 3;
export const STUD_KNOB = 4; // a stud's own height on top of a part

export const mm = (ldu) => ldu * LDU_MM;
const near = (value, step) => Math.round(value / step) * step;

// Snap a placement given in studs (x, y) and plates (z). Returns the snapped
// values and how far each was moved, so a caller can say what it corrected.
export function snap({ x, y, z }) {
  const sx = near(x, 0.5);
  const sy = near(y, 0.5);
  const sz = Math.round(z);
  return { x: sx, y: sy, z: sz, moved: [x - sx, y - sy, z - sz].some((d) => Math.abs(d) > 1e-9) };
}

// Is an offset in LDU on the grid? Horizontal to a half stud, vertical to a plate.
export const onGrid = (dx, dz, dy) =>
  Math.abs(dx - near(dx, HALF_STUD)) < 0.05 && Math.abs(dz - near(dz, HALF_STUD)) < 0.05 && Math.abs(dy - near(dy, PLATE)) < 0.05;

const trim = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(1));

// A size in both systems, from kit-world bounds (x, y across; z up).
export function describe({ lo, hi }) {
  const w = (hi[0] - lo[0]) / STUD;
  const d = (hi[1] - lo[1]) / STUD;
  let h = hi[2] - lo[2];
  // A top that stops a stud's height above a plate line carries studs.
  const studded = Math.abs((h % PLATE) - STUD_KNOB) < 0.6;
  if (studded) h -= STUD_KNOB;
  const plates = h / PLATE;
  const bricks = plates / 3;
  const across = `${trim(w)} × ${trim(d)} studs`;
  const up = Number.isInteger(Math.round(plates * 1000) / 1000) && Math.abs(plates - Math.round(plates)) < 0.05
    ? `${trim(plates)} plate${Math.round(plates) === 1 ? "" : "s"}${Math.abs(bricks - Math.round(bricks)) < 0.02 && bricks >= 1 ? ` (${trim(bricks)} brick${Math.round(bricks) === 1 ? "" : "s"})` : ""}`
    : `${trim(plates)} plates`;
  const size = `${trim(mm(hi[0] - lo[0]))} × ${trim(mm(hi[1] - lo[1]))} × ${trim(mm(h))} mm`;
  return `${across} · ${up}${studded ? " + stud" : ""} · ${size}`;
}

// Rulers in the kit's style: a stud strip along each floor edge, ticked every
// half stud with a longer tick each stud, and a post ticked every plate with a
// long tick each brick. K is the kit (in Node the module, in the page its
// globals), so the same drawing follows the camera as the figure turns.
export function rulers(K, P, { lo, hi }) {
  const out = [];
  const x0 = Math.floor(lo[0] / HALF_STUD) * HALF_STUD;
  const x1 = Math.ceil(hi[0] / HALF_STUD) * HALF_STUD;
  const y0 = Math.floor(lo[1] / HALF_STUD) * HALF_STUD;
  const y1 = Math.ceil(hi[1] / HALF_STUD) * HALF_STUD;
  const z0 = lo[2];
  const top = z0 + Math.max(PLATE, Math.ceil((hi[2] - z0) / PLATE) * PLATE);
  const GAP = 14;
  const W = 10;
  const T = 0.8;
  // Keep every ruler on the far sides, whichever way the camera has turned.
  const a = ((P.azimuth ?? 45) * Math.PI) / 180;
  const farX = Math.cos(a) >= 0 ? x0 - GAP - W : x1 + GAP;
  const farY = Math.sin(a) >= 0 ? y0 - GAP - W : y1 + GAP;
  const nearY = (y) => (Math.sin(a) >= 0 ? y + W : y);
  const nearX = (x) => (Math.cos(a) >= 0 ? x + W : x);
  const inward = (from, sign, length) => from - sign * length;
  const minor = [];
  const major = [];

  // Along x, on the far side of the footprint.
  const sx = { x: x0, y: farY, w: x1 - x0, d: W, r: 1 };
  const ex = nearY(sx.y);
  const dx = ex === sx.y ? -1 : 1;
  out.push(K.solidSvg(K.slabOf(sx, z0, T, P, 2), { tone: "lo", crease: "none" }));
  for (let x = x0, i = 0; x <= x1 + 1e-6; x += HALF_STUD, i++) {
    const long = i % 2 === 0;
    (long ? major : minor).push(K.segment([x, ex, z0 + T], [x, inward(ex, dx, long ? W : W / 2), z0 + T], P));
  }
  // Along y, on the left of the footprint.
  const sy = { x: farX, y: y0, w: W, d: y1 - y0, r: 1 };
  const ey = nearX(sy.x);
  const dy = ey === sy.x ? -1 : 1;
  out.push(K.solidSvg(K.slabOf(sy, z0, T, P, 2), { tone: "lo", crease: "none" }));
  for (let y = y0, i = 0; y <= y1 + 1e-6; y += HALF_STUD, i++) {
    const long = i % 2 === 0;
    (long ? major : minor).push(K.segment([ey, y, z0 + T], [inward(ey, dy, long ? W : W / 2), y, z0 + T], P));
  }
  // A post in the corner, ticked in plates up its near face.
  const post = { x: farX, y: farY, w: W, d: W, r: 0.6 };
  out.push(K.solidSvg(K.slabOf(post, z0, top - z0, P, 2, 0.4), { tone: "lo" }));
  // Ticks go on the post's face that looks the same way the y strip's edge does.
  const face = nearY(post.y);
  const start = Math.cos(a) >= 0 ? post.x : post.x + W;
  const run = Math.cos(a) >= 0 ? 1 : -1;
  for (let z = z0, i = 0; z <= top + 1e-6; z += PLATE, i++) {
    const long = i % 3 === 0;
    (long ? major : minor).push(K.segment([start, face, z], [start + run * (long ? W : W / 2), face, z], P));
  }
  out.push(K.lineSvg(minor.join(""), { tone: "lo", free: "end" }));
  out.push(K.lineSvg(major.join(""), { tone: "hi" }));
  return out.join("");
}
