import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import * as G from "../../kit/lathe.mjs";
import { kitScript } from "../../scripts/inline-kit.mjs";
import { prismGen, clipPoly, discPoly, coilZ } from "./geometry.mjs";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 680;
const HEIGHT = 420;

const {
  RADIUS, ZAX, SHEAR, PFLOOR, KEY_FLOOR, KEY_HALF, KEY_TOP,
  CHAMBER, PIN, SPRING, DRIVER, CEILING, PINS, RIGHT, WRONG,
  SHOULDER, TIP, SHELL_X, SHELL_Y, SHELL_Z, PIN_LENGTHS, CUT_FLAT,
} = M;

const OUT = 122; // how far the key pulls out of the keyway
const BLADE_T = 11.5; // half thickness
const BOW = { from: SHOULDER + 4, w: 104, z0: 84, z1: 184, t: 14 };

// ---------------------------------------------------------------- the bench
const PLATE = { x: -40, y: -126, w: 372, d: 170, r: 10 };
const PLATE_H = 14;
const FOOT_H = 6;
const CRADLE = { x: -20, y: -112, w: 330, d: 144, r: 7 };
const CRADLE_Z = [26, 44];
const PEDESTALS = [
  { x: 8, y: -100, w: 58, d: 120, r: 4 },
  { x: 198, y: -100, w: 58, d: 120, r: 4 },
];
const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    ...k.boxCorners({ x: SHELL_X[0], y: SHELL_Y[0] - 20, w: SHELL_X[1] - SHELL_X[0], d: SHELL_Y[1] - SHELL_Y[0] + 20, r: 0 }, SHELL_Z[0], SHELL_Z[1]),
    [BOW.from + BOW.w + OUT, BOW.t, BOW.z1],
    [BOW.from + BOW.w + OUT, -BOW.t, BOW.z0],
    [SHOULDER, 0, ZAX],
  ],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 52, elevation: 32 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// Frames: PLUGF sweeps a (y, z) cross-section along x; KEYF sweeps an (x, z)
// cross-section along y, which is how the key's cut profile is one solid.
const PLUGF = G.frameOf([0, 0, ZAX], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const KEYF = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);

// --------------------------------------------------------- the lock's solids
// The cylinder is cut lengthwise along the pin line, and at every pin a slot
// is milled back past the chamber's axis, so each stack stands in a real
// recess with two side walls and a back wall behind it.
const SLOT = CHAMBER;
const SLOT_STOP = Math.PI - Math.asin(SLOT / RADIUS); // where the slot wall meets the bore

// Left half of the bore, from the plug's lowest point round toward its crown.
const boreArc = (upTo = Math.PI, steps = 54) =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const angle = -Math.PI / 2 - (index / steps) * upTo;
    return [RADIUS * Math.cos(angle), RADIUS * Math.sin(angle)];
  });

const shellPoly = (slot) => [
  [SHELL_Y[0], SHELL_Z[0] - ZAX],
  [0, SHELL_Z[0] - ZAX],
  [0, -RADIUS],
  ...boreArc(slot ? SLOT_STOP : Math.PI),
  [slot ? -SLOT : 0, SHELL_Z[1] - ZAX],
  [SHELL_Y[0], SHELL_Z[1] - ZAX],
];

const plugPoly = (slot) => [
  ...boreArc(slot ? SLOT_STOP : Math.PI),
  [slot ? -SLOT : 0, KEY_TOP - ZAX],
  [-KEY_HALF, KEY_TOP - ZAX],
  [-KEY_HALF, KEY_FLOOR - ZAX],
  [0, KEY_FLOOR - ZAX],
];

// Alternating plain and slotted lengths along the cylinder.
const RUNS = (() => {
  const marks = [SHELL_X[0]];
  for (const cx of [...PINS].sort((a, b) => a - b)) marks.push(cx - SLOT, cx + SLOT);
  marks.push(SHELL_X[1]);
  return marks.slice(0, -1).map((from, index) => ({ from, to: marks[index + 1], slot: index % 2 === 1 }));
})();

function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 28))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6.2, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 10, 1.6), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 6), 0, P, 10), { tone: "faint" }));
  const screws = k.corners(PLATE, 13);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.6, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // A ruler strip along the far edge, ticked every 5 mm.
  const strip = { x: PLATE.x + 24, y: PLATE.y + 8, w: PLATE.w - 48, d: 9, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 5, strip.x + strip.w - 5, M.MM, 5, strip.y + 1, 0.8, [2.6, 5], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2.5, strip.y + 4.5, 0.8]), at([strip.x + strip.w - 2.5, strip.y + 4.5, 0.8])], { size: 0.45 }));

  // A blank label plate on the near right of the bench.
  const label = { x: PLATE.x + PLATE.w - 96, y: PLATE.y + PLATE.d - 34, w: 72, d: 22, r: 2 };
  out.push(S(k.slabOf(label, 0, 1, P, 3, 0.4), { tone: "lo" }));
  out.push(
    L([8, 13, 18].map((inset) => k.lineOnTop([label.x + 6, label.y + inset], [label.x + label.w - 6, label.y + inset], 1, P)).join(""), {
      tone: "faint",
      free: true,
    }),
  );
  out.push(D(k.corners(label, 4).map(([x, y]) => at([x, y, 1])), { size: 0.4, tone: "lo" }));
  return out.join("");
}

function stand() {
  const out = [];
  for (const plan of PEDESTALS) {
    out.push(S(k.slabOf(plan, 0, CRADLE_Z[0], P, 4, 0.8), { tone: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 5), CRADLE_Z[0], P, 4), { tone: "faint" }));
  }
  out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CRADLE, 6), CRADLE_Z[0], 0.1, P)}" style="filter:blur(5px)"/>`);
  out.push(S(k.slabOf(CRADLE, CRADLE_Z[0], CRADLE_Z[1] - CRADLE_Z[0], P, 7, 1), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(CRADLE, 5), CRADLE_Z[1], P, 7), { tone: "faint" }));
  const bolts = [
    [CRADLE.x + 12, CRADLE.y + 16],
    [CRADLE.x + 12, CRADLE.y + CRADLE.d - 16],
    [CRADLE.x + CRADLE.w - 12, CRADLE.y + 16],
    [CRADLE.x + CRADLE.w - 12, CRADLE.y + CRADLE.d - 16],
  ];
  out.push(L(bolts.map(([x, y]) => k.ring(x, y, 4, CRADLE_Z[1], P, 16)).join(""), { tone: "lo" }));
  out.push(D(bolts.map(([x, y]) => at([x, y, CRADLE_Z[1]])), { size: 0.6, tone: "mid" }));
  return out.join("");
}

// The cylinder is held from behind, so nothing crosses the milled face.
function bracket() {
  const out = [];
  const plan = { x: SHELL_X[0] - 6, y: SHELL_Y[0] - 20, w: SHELL_X[1] - SHELL_X[0] + 12, d: 20, r: 3 };
  out.push(S(k.slabOf(plan, CRADLE_Z[1], 112, P, 3, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 4), CRADLE_Z[1] + 112, P, 3), { tone: "faint" }));
  const bolts = [34, 134, 234];
  out.push(
    L(bolts.map((x) => k.sideRing([x, plan.y + plan.d, CRADLE_Z[1] + 76], 7, "y", P)).join("") +
      bolts.map((x) => k.sideRing([x, plan.y + plan.d, CRADLE_Z[1] + 76], 3.4, "y", P)).join(""), { tone: "lo" }),
  );
  out.push(D(bolts.map((x) => at([x, plan.y + plan.d, CRADLE_Z[1] + 30])), { size: 0.55, tone: "mid" }));
  return out.join("");
}

// Shell and plug are drawn length by length, back to front, so every slot
// wall falls in its true place in the painter's order.
function cylinder() {
  const out = [];
  RUNS.forEach((run, index) => {
    const last = index === RUNS.length - 1;
    out.push(S(prismGen(PLUGF, shellPoly(run.slot), run.from, run.to, P), { tone: "mid", crease: "faint" }));
    out.push(S(prismGen(PLUGF, plugPoly(run.slot), run.from, last ? SHOULDER : run.to, P), { tone: "hi", crease: "faint" }));
  });
  // A scribe along the far edge of the top face, and the bore's lower seam.
  out.push(L(k.segment([SHELL_X[0], SHELL_Y[0] + 6, CEILING], [SHELL_X[1], SHELL_Y[0] + 6, CEILING], P), { tone: "faint" }));
  out.push(L(k.segment([SHELL_X[0], 0, PFLOOR], [SHELL_X[1], 0, PFLOOR], P), { tone: "lo" }));
  // The plug's shoulder, and a bevel ring on its face.
  out.push(L(G.arcOf(PLUGF, SHELL_X[1] + 7, RADIUS, P, { least: -1 }), { tone: "faint" }));
  out.push(L(G.arcOf(PLUGF, SHOULDER, RADIUS - 5, P, { least: -1 }), { tone: "lo" }));
  return out.join("");
}

// The shear line is where the plug's surface meets the shell's bore, so it
// runs along the milled face, dips back into every slot on the wall you can
// see, and crosses each slot's back wall a little lower.
function shearLine() {
  const topAt = (y) => ZAX + Math.sqrt(Math.max(0, RADIUS * RADIUS - y * y));
  const wall = (x) =>
    k.pathOf(Array.from({ length: 13 }, (_, index) => {
      const y = (-SLOT * index) / 12;
      return at([x, y, topAt(y)]);
    }));
  const parts = RUNS.map((run) =>
    run.slot
      ? wall(run.from) + k.segment([run.from, -SLOT, topAt(SLOT)], [run.to, -SLOT, topAt(SLOT)], P)
      : k.segment([run.from, 0, SHEAR], [run.to, 0, SHEAR], P),
  );
  return `<path class="iso-line" data-tone="lit" d="${parts.join("")}" style="stroke-width:1.3"/>`;
}

// Key pins are turned with a 90 degree point so they ride up the key's cuts;
// drivers are flat with a lead chamfer at each end.
const upright = (cx, z0) => G.frameAlong([cx, 0, z0], [0, 0, 1]);

function keyPins() {
  return PINS.map((cx, index) => {
    const length = PIN_LENGTHS[index];
    const F = upright(cx, SHEAR - length); // built with its top on the shear line
    const body = G.solidOf([[0, 0], [PIN, PIN], [length - 1.2, PIN], [length, PIN - 1.2]], F, P);
    const seam = L(G.arcOf(F, PIN + 4, PIN, P, { least: 0, trim: -1.8 }), { tone: "faint" });
    return `<g data-keypin="${index}">${S(body, { tone: "hi", crease: "lo", inner: seam })}</g>`;
  }).join("");
}

function driverPins() {
  return PINS.map((cx, index) => {
    const F = upright(cx, SHEAR);
    const body = G.solidOf([[0, PIN - 1.4], [1.4, PIN], [DRIVER - 1.4, PIN], [DRIVER, PIN - 1.4]], F, P);
    const seam = L([6, DRIVER - 6].map((s) => G.arcOf(F, s, PIN, P, { least: 0, trim: -1.8 })).join(""), { tone: "faint" });
    return `<g data-driver="${index}">${S(body, { tone: "mid", crease: "lo", inner: seam })}</g>`;
  }).join("");
}

// Real compression springs have closed, ground ends; they also give the helix
// something to finish on at both ends.
function springs() {
  return PINS.map((cx, index) => {
    const coil = coilZ(cx, 0, SPRING, SHEAR + DRIVER, CEILING, 5.5, P);
    return `<g data-spring="${index}">`
      + `<path class="iso-line" data-tone="lo" d="${k.ring(cx, 0, SPRING, CEILING, P, 28)}"/>`
      + `<path class="iso-line" data-tone="lo" d="${coil.back}"/>`
      + `<path class="iso-line" data-tone="mid" d="${coil.front}"/>`
      + `<path class="iso-line" data-tone="lo" d="${k.ring(cx, 0, SPRING, SHEAR + DRIVER, P, 28)}"/>`
      + `</g>`;
  }).join("");
}

// ------------------------------------------------------------------- the key
function bladePoly(bitting) {
  const top = [];
  for (let x = SHOULDER; x >= TIP; x -= 0.5) top.push([x, M.bladeTop(x, bitting)]);
  // Drop points that sit on the line between their neighbours.
  const lean = [top[0]];
  for (let index = 1; index < top.length - 1; index++) {
    const [ax, az] = lean[lean.length - 1];
    const [bx, bz] = top[index];
    const [cx, cz] = top[index + 1];
    const straight = Math.abs((bz - az) * (cx - bx) - (cz - bz) * (bx - ax)) < 1e-6;
    if (!straight) lean.push([bx, bz]);
  }
  lean.push(top[top.length - 1]);
  return [[TIP, KEY_FLOOR], [SHOULDER, KEY_FLOOR], ...lean];
}

function key(bitting, name) {
  const out = [];
  out.push(S(prismGen(KEYF, bladePoly(bitting), -BLADE_T, BLADE_T, P), { tone: "hi", crease: "lo" }));
  // Warding grooves run most of the blade and ramp out before the tip bevel.
  for (const y of [BLADE_T, -BLADE_T]) {
    for (const z of [KEY_FLOOR + 26, KEY_FLOOR + 46]) {
      out.push(k.fadeLineSvg([at([TIP + 8, y, z]), at([SHOULDER, y, z])], { fade: [18, 0], tone: "faint" }));
    }
  }
  // Shoulder, then the bow.
  out.push(S(k.slabOf({ x: SHOULDER - 2, y: -BOW.t, w: 6, d: BOW.t * 2, r: 1 }, KEY_FLOOR - 2, 30, P, 2), { tone: "hi", crease: "lo" }));
  const bowPlan = k.roundedPlan({ x: BOW.from, y: BOW.z0, w: BOW.w, d: BOW.z1 - BOW.z0, r: 34 }, 10);
  out.push(S(prismGen(KEYF, bowPlan, -BOW.t, BOW.t, P), { tone: "hi", crease: "lo" }));
  const hole = [BOW.from + BOW.w - 42, (BOW.z0 + BOW.z1) / 2];
  for (const y of [BOW.t, -BOW.t]) {
    out.push(L(k.sideRing([hole[0], y, hole[1]], 23, "y", P), { tone: "lo" }));
  }
  out.push(L(k.sideRing([hole[0], BOW.t, hole[1]], 18, "y", P), { tone: "faint" }));
  return `<g data-key="${name}">${out.join("")}</g>`;
}

// ------------------------------------------------------------------ assembly
// The key sits in the keyway with its near half proud of the milled face, and
// nothing of the lock is ever in front of it, so it needs no splitting.
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A sectioned pin-tumbler lock cylinder bolted to a bench plate. The brass shell is milled away at the pin line, so five key pins stand in the plug's chambers and five driver pins and springs stand in the shell's chambers above them. A key slides along the keyway underneath; each of its five cuts lifts the pin above it. When every stack splits exactly on the shear line between plug and shell, nothing crosses the line and the plug is free to turn.",
  body: [
    bench(),
    stand(),
    bracket(),
    cylinder(),
    shearLine(),
    keyPins(),
    driverPins(),
    springs(),
    `<g data-stage="right"><g data-slide="right">${key(RIGHT, "right")}</g></g>`,
    `<g data-stage="wrong" style="display:none"><g data-slide="wrong">${key(WRONG, "wrong")}</g></g>`,
  ],
});

const live = `
const P = ${JSON.stringify(P)};
const MODEL = ${JSON.stringify({
  PINS, RIGHT, WRONG, PIN_LENGTHS, SHEAR, KEY_FLOOR, DRIVER, CEILING, SPRING,
  TIP, SHOULDER, CUT_FLAT, KEY_TOP, ROOT0: M.ROOT0, STEP: M.STEP, MM: M.MM, OUT, DEPTHS: M.DEPTHS,
})};
const coilZ = ${coilZ.toString().replace(/\bk\./g, "")};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const keyPins = MODEL.PINS.map((_, i) => svg.querySelector('[data-keypin="' + i + '"]'));
const drivers = MODEL.PINS.map((_, i) => svg.querySelector('[data-driver="' + i + '"]'));
const springs = MODEL.PINS.map((_, i) => svg.querySelector('[data-spring="' + i + '"]'));
const slides = { right: [...svg.querySelectorAll('[data-slide="right"]')], wrong: [...svg.querySelectorAll('[data-slide="wrong"]')] };
const stages = { right: [...svg.querySelectorAll('[data-stage="right"]')], wrong: [...svg.querySelectorAll('[data-stage="wrong"]')] };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rootOf = (n) => MODEL.KEY_FLOOR + MODEL.ROOT0 - MODEL.STEP * n;
function bladeTop(x, bitting) {
  if (x < MODEL.TIP || x > MODEL.SHOULDER) return null;
  let top = MODEL.KEY_FLOOR + MODEL.ROOT0;
  bitting.forEach((n, i) => {
    top = Math.min(top, rootOf(n) + Math.max(0, Math.abs(x - MODEL.PINS[i]) - MODEL.CUT_FLAT));
  });
  return Math.min(top, rootOf(MODEL.DEPTHS - 1) - 8 + (x - MODEL.TIP) * 2.2);
}
const floorsUnder = (offset, bitting) => MODEL.PINS.map((x) => {
  const top = bladeTop(x - offset, bitting);
  return top === null ? MODEL.KEY_FLOOR : top;
});

let which = "right";
let offset = MODEL.OUT, target = MODEL.OUT;
let splits = MODEL.PINS.map((_, i) => MODEL.KEY_FLOOR + MODEL.PIN_LENGTHS[i]);
let rates = MODEL.PINS.map(() => 0);
let frame = 0, last = 0, clock = 0, touring = true, visible = false, idle = 0;

function draw() {
  for (const name of ["right", "wrong"]) {
    const on = name === which;
    stages[name].forEach((node) => { node.style.display = on ? "" : "none"; });
    if (on) slides[name].forEach((node) => node.setAttribute("transform", translateAlong(P, [offset, 0, 0])));
  }
  splits.forEach((split, i) => {
    const lift = split - MODEL.SHEAR;
    keyPins[i].setAttribute("transform", translateAlong(P, [0, 0, lift]));
    drivers[i].setAttribute("transform", translateAlong(P, [0, 0, lift]));
    const coil = coilZ(MODEL.PINS[i], 0, MODEL.SPRING, split + MODEL.DRIVER, MODEL.CEILING, 5.5, P);
    const paths = springs[i].children;
    paths[1].setAttribute("d", coil.back);
    paths[2].setAttribute("d", coil.front);
    paths[3].setAttribute("d", ring(MODEL.PINS[i], 0, MODEL.SPRING, split + MODEL.DRIVER, P, 28));
  });
  const gaps = splits.map((split) => split - MODEL.SHEAR);
  const held = gaps
    .map((gap, i) => ({ i, gap }))
    .filter((stack) => Math.abs(stack.gap) >= 0.6)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const worst = held[0];
  const text = held.length === 0
    ? "all five on the shear line \\u00b7 plug free"
    : (5 - held.length) + " of 5 on the line \\u00b7 pin " + (worst.i + 1) + " " + (worst.gap > 0 ? "high" : "low")
      + " by " + (Math.abs(worst.gap) / MODEL.MM).toFixed(2) + " mm";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(Math.round(MODEL.OUT - offset)));
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) {
    clock += dt;
    const phase = clock % 9;
    target = phase < 1.4 ? MODEL.OUT : phase < 4.2 ? 0 : phase < 6.4 ? 0 : MODEL.OUT;
  }
  offset = calm ? target : offset + (target - offset) * (1 - Math.exp(-dt / 0.34));
  if (Math.abs(target - offset) < 0.05) offset = target;
  const floors = floorsUnder(offset, which === "right" ? MODEL.RIGHT : MODEL.WRONG);
  let settled = true;
  floors.forEach((floor, i) => {
    const want = floor + MODEL.PIN_LENGTHS[i];
    const stiff = 520, drag = calm ? 2 * Math.sqrt(520) : 30;
    for (let step = 0; step < 4; step++) {
      rates[i] += ((want - splits[i]) * stiff - rates[i] * drag) * dt / 4;
      splits[i] += rates[i] * dt / 4;
    }
    if (Math.abs(want - splits[i]) < 0.004 && Math.abs(rates[i]) < 0.004) { splits[i] = want; rates[i] = 0; }
    else settled = false;
  });
  draw();
  const done = !touring && offset === target && settled;
  frame = visible && !done ? requestAnimationFrame(tick) : 0;
}

const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, 0, MODEL.OUT);
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 4200);
  run();
};
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "140px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientX - box.left) / box.width - 0.26) / 0.50, 0, 1);
  steer(MODEL.OUT * (1 - share));
});
stage.addEventListener("pointerleave", () => steer(target));
stage.addEventListener("keydown", (event) => {
  if (event.key === "w" || event.key === "W") {
    which = which === "right" ? "wrong" : "right";
    event.preventDefault();
    steer(target);
    return;
  }
  let to = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = target + 14;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = target - 14;
  if (event.key === "Home") to = MODEL.OUT;
  if (event.key === "End") to = 0;
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Pin tumbler lock",
  hint: "Hover to push the key in · W for the wrong key",
  readout: "0 of 5 on the shear line",
  keys: [
    { mark: "lit", label: "The shear line: the plane the plug turns on" },
    { mark: "raised", label: "Key pins, one per cut; drivers and springs above" },
    { mark: "dim", label: "Brass shell, milled away at the pin line" },
  ],
  caption:
    "A Schlage C cylinder, sectioned. Pins sit 0.156 in apart; each cut is one of ten depths 0.015 in apart, and the key pin under it is exactly as long as the cut is shallow. Push the key home and every stack splits on the shear line at once, so nothing bridges plug and shell. Press W for a key whose third cut is three steps too deep and fifth three too shallow: two stacks hold the line and the plug stays put.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Pin tumbler lock: arrow keys slide the key, W swaps in the wrong key" aria-valuemin="0" aria-valuemax="${OUT}" aria-valuenow="0">${svg}</div>`,
});

const file = theme === "light" ? "pin-tumbler-lock-light.html" : "pin-tumbler-lock.html";
writeFileSync(join(HERE, file), k.pageHtml({ title: "Pin tumbler lock", theme, body, script: kitScript() + live, width: 700 }));
console.log("wrote", file);
