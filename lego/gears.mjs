// Technic gear trains: place axles on the LEGO grid, put real gears on them,
// and get the ratio, the output speed and direction, and a figure where the
// parts from Studio's library turn at the speeds the train gives them.
//
//   node gears.mjs examples/reduction.gears [--light] [--tone] [--out file.html]
//
// LEGO gears are module 1: a gear of T teeth has a pitch diameter of T mm, so
// two gears mesh when their axles are (T1 + T2) / 2 mm apart. On LEGO's grids
// that is 8 mm a stud across and 3.2 mm a plate up: 8T + 24T is 2 studs,
// 16T + 24T is 2.5 studs (the half-stud grid), 16T over 16T is 5 plates, and
// 20T + 20T sits on the diagonal 1.5 studs across and 5 plates up (12-16-20 mm).
//
// A .gears file, one statement per line ("#" starts a comment):
//
//   title: Two-stage reduction
//   motor pf-m                 input speed: pf-m, pf-l, pf-xl, or a number of rpm
//   axle A 0 0 [len 4]         axle id, x in studs, z in plates; axles run along y
//   gear A 8 [at 0] [colour]   T teeth on axle A, in stud slot "at" along the axle
//   input A                    the driven axle (default: the first)
//   output C                   the axle to report (default: the last)
//   wheel C 62.4               optional: wheel diameter in mm, for road speed
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { colors, flatten, setDetail } from "./ldraw.mjs";
import { LEGO_CSS, boundsOf, cornersOf, mergePacked, packMesh, paint, paletteFor } from "./render.mjs";
import { HALF_STUD, PLATE, STUD, rulers } from "./units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUD_MM = 8;
const PLATE_MM = 3.2;

// Spur-meshing Technic gears: teeth -> LDraw part and its usual colour.
export const GEARS = {
  8: { part: "10928.dat", color: 72, name: "8 tooth" },
  12: { part: "32270.dat", color: 0, name: "12 tooth double bevel" },
  16: { part: "94925.dat", color: 71, name: "16 tooth" },
  20: { part: "32269.dat", color: 19, name: "20 tooth double bevel" },
  24: { part: "3648b.dat", color: 71, name: "24 tooth" },
  36: { part: "32498.dat", color: 0, name: "36 tooth double bevel" },
  40: { part: "3649.dat", color: 71, name: "40 tooth" },
};
const AXLES = { 2: "32062.dat", 3: "4519.dat", 4: "3705.dat", 5: "32073.dat", 6: "3706.dat", 7: "44294.dat", 8: "3707.dat", 9: "60485.dat", 10: "3737.dat", 12: "3708.dat" };
// No-load speeds at 9 V (Philo's Power Functions measurements).
export const MOTORS = { "pf-m": 405, "pf-l": 390, "pf-xl": 220 };
const TOLERANCE = 0.25; // mm either side of the ideal centre distance

// ------------------------------------------------------------------ parsing
export function parse(text, fallback = "Gear train") {
  const spec = { title: fallback, rpm: MOTORS["pf-m"], motor: "pf-m", axles: [], gears: [], input: null, output: null, wheel: null };
  const axle = (id, line) => {
    const found = spec.axles.find((a) => a.id === id);
    if (!found) throw new Error(`line ${line}: no axle ${id}`);
    return found;
  };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const text = raw.replace(/#.*/, "").trim();
    if (!text) return;
    const titled = /^title:\s*(.+)$/i.exec(text);
    if (titled) return void (spec.title = titled[1].trim());
    const [word, ...rest] = text.split(/\s+/);
    switch (word.toLowerCase()) {
      case "motor": {
        const key = rest[0].toLowerCase();
        spec.rpm = MOTORS[key] ?? Number(rest[0]);
        spec.motor = MOTORS[key] ? key : `${spec.rpm} rpm`;
        if (!Number.isFinite(spec.rpm)) throw new Error(`line ${line}: motor is pf-m, pf-l, pf-xl or a number of rpm`);
        break;
      }
      case "axle": {
        const [id, x, z] = rest;
        const len = rest.indexOf("len") >= 0 ? Number(rest[rest.indexOf("len") + 1]) : null;
        const sx = Math.round(Number(x) * 2) / 2;
        const sz = Math.round(Number(z));
        if (sx !== Number(x) || sz !== Number(z)) console.warn(`line ${line}: axle ${id} moved to ${sx} studs, ${sz} plates to sit on the grid`);
        spec.axles.push({ id, x: sx, z: sz, len, line });
        break;
      }
      case "gear": {
        const [id, teeth, ...more] = rest;
        const at = more.indexOf("at") >= 0 ? Number(more[more.indexOf("at") + 1]) : 0;
        const colourWord = more.filter((w, i) => w !== "at" && more[i - 1] !== "at")[0];
        const t = Number(teeth);
        if (!GEARS[t]) throw new Error(`line ${line}: no ${teeth}-tooth gear; use ${Object.keys(GEARS).join(", ")}`);
        axle(id, line);
        spec.gears.push({ axle: id, teeth: t, at, color: colourWord, line });
        break;
      }
      case "input": spec.input = axle(rest[0], line).id; break;
      case "output": spec.output = axle(rest[0], line).id; break;
      case "wheel": spec.wheel = { axle: axle(rest[0], line).id, mm: Number(rest[1]) }; break;
      default: throw new Error(`line ${line}: unknown "${word}"`);
    }
  });
  if (!spec.axles.length) throw new Error("no axles");
  spec.input ??= spec.axles[0].id;
  spec.output ??= spec.axles[spec.axles.length - 1].id;
  return spec;
}

// ------------------------------------------------------------------ solving
// Every pair of gears in the same slot on different axles is classified by
// how far apart their axles are against (T1 + T2) / 2 mm.
export function solve(spec) {
  const byId = Object.fromEntries(spec.axles.map((a) => [a.id, a]));
  const pairs = [];
  for (let i = 0; i < spec.gears.length; i++) {
    for (let j = i + 1; j < spec.gears.length; j++) {
      const [a, b] = [spec.gears[i], spec.gears[j]];
      if (a.axle === b.axle || Math.abs(a.at - b.at) >= 1) continue;
      const A = byId[a.axle], B = byId[b.axle];
      const distance = Math.hypot((B.x - A.x) * STUD_MM, (B.z - A.z) * PLATE_MM);
      const ideal = (a.teeth + b.teeth) / 2;
      const reach = (a.teeth + b.teeth + 4) / 2; // tip circles touch
      let kind = "clear";
      if (Math.abs(distance - ideal) <= TOLERANCE) kind = "mesh";
      else if (distance < ideal) kind = "jam";
      else if (distance < reach) kind = "skip";
      if (kind !== "clear") pairs.push({ a, b, distance, ideal, kind });
    }
  }
  // Speeds, as fractions of the input: a mesh turns the other axle the other
  // way, slower by its teeth over ours. Two routes that disagree jam the train.
  const ratio = { [spec.input]: 1 };
  const via = { [spec.input]: null };
  const conflicts = [];
  const meshes = pairs.filter((p) => p.kind === "mesh");
  const queue = [spec.input];
  while (queue.length) {
    const here = queue.shift();
    for (const p of meshes) {
      const [mine, other] = p.a.axle === here ? [p.a, p.b] : p.b.axle === here ? [p.b, p.a] : [null, null];
      if (!mine) continue;
      const speed = -ratio[here] * (mine.teeth / other.teeth);
      if (ratio[other.axle] === undefined) {
        ratio[other.axle] = speed;
        via[other.axle] = p;
        queue.push(other.axle);
      } else if (Math.abs(ratio[other.axle] - speed) > 1e-9 && !conflicts.includes(p)) {
        conflicts.push(p);
      }
    }
  }
  const out = ratio[spec.output];
  const result = {
    pairs,
    ratio,
    via,
    conflicts,
    jammed: conflicts.length > 0 || pairs.some((p) => p.kind === "jam"),
    connected: out !== undefined,
    outRpm: out === undefined ? 0 : spec.rpm * out,
  };
  if (result.connected && spec.wheel) {
    const w = ratio[spec.wheel.axle];
    result.kmh = w === undefined ? null : (Math.abs(spec.rpm * w) * Math.PI * spec.wheel.mm * 60) / 1e6;
  }
  return result;
}

// Ratio as "a:b" in small whole numbers where it is one.
function ratioText(r) {
  const x = Math.abs(1 / r);
  for (let den = 1; den <= 50; den++) {
    const num = x * den;
    if (Math.abs(num - Math.round(num)) < 1e-6) {
      const g = gcd(Math.round(num), den);
      return `${Math.round(num) / g}:${den / g}`;
    }
  }
  return `${x.toFixed(3)}:1`;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function report(spec, result) {
  const lines = [];
  for (const p of result.pairs) {
    const what = { mesh: "meshes", jam: "too close, teeth collide", skip: "too far, teeth will skip" }[p.kind];
    lines.push(`${p.a.axle} ${p.a.teeth}T -> ${p.b.axle} ${p.b.teeth}T: ${p.distance.toFixed(2)} mm apart, needs ${p.ideal.toFixed(1)} mm: ${what}`);
  }
  for (const p of result.conflicts) lines.push(`loop through ${p.a.axle} and ${p.b.axle} asks two speeds of one axle: jammed`);
  if (!result.connected && !result.jammed) lines.push(`output ${spec.output} is not driven from ${spec.input}`);
  else if (!result.jammed) {
    const r = result.ratio[spec.output];
    const way = r > 0 ? "same direction" : "opposite direction";
    lines.push(`${spec.input} -> ${spec.output}: ${ratioText(r)} (${Math.abs(1 / r) >= 1 ? "reduction" : "step-up"}), ${way}`);
    lines.push(`${spec.rpm} rpm in -> ${Math.abs(result.outRpm).toFixed(1)} rpm out, torque x${Math.abs(1 / r).toFixed(2)} (no friction)`);
    if (result.kmh != null) lines.push(`${spec.wheel.mm} mm wheel on ${spec.wheel.axle}: ${result.kmh.toFixed(2)} km/h`);
  }
  return lines;
}

// ------------------------------------------------------------------ geometry
// Kit world: x across in LDU, y along the axles, z up. A part placed with its
// centre at (x, y, z) in kit units sits at LDraw (x, -z, y).
const rotY = [0, 0, 1, 0, 1, 0, -1, 0, 0]; // turns an LDraw axle (along x) to run along LDraw z
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function partAt(file, color, [x, y, z], R = ID) {
  return packMesh(flatten(file, color, [x, -z, y, ...R]));
}

// The angle of a tooth's centre line, so meshing gears can be phased. Tooth
// tops are flat, so the farthest vertex is a corner; instead every vertex near
// the tip circle votes, with its angle folded by the tooth count, and the
// circular mean of the votes is the centre of a tooth.
export function tipPhase(packed, cx, cz, teeth) {
  let rMax = 0;
  for (const t of packed.tris) for (let i = 2; i < t.length; i += 3) rMax = Math.max(rMax, Math.hypot(t[i] - cx, t[i + 2] - cz));
  let sx = 0, sy = 0;
  for (const t of packed.tris) {
    for (let i = 2; i < t.length; i += 3) {
      if (Math.hypot(t[i] - cx, t[i + 2] - cz) < rMax - 0.6) continue;
      const folded = Math.atan2(t[i + 2] - cz, t[i] - cx) * teeth;
      sx += Math.cos(folded);
      sy += Math.sin(folded);
    }
  }
  return Math.atan2(sy, sx) / teeth;
}

// How far a mesh is from perfect, in teeth: 0 when a tooth of one gear sits
// centred in a gap of the other, 0.5 when tooth meets tooth.
export function meshError(thetaA, tipA, teethA, thetaB, tipB, teethB, towards) {
  const a = ((thetaA + tipA - towards) * teethA) / (2 * Math.PI);
  const b = ((thetaB + tipB - towards - Math.PI) * teethB) / (2 * Math.PI);
  const f = (((a + b) % 1) + 1) % 1;
  return Math.abs(f - 0.5);
}

export function assemble(spec, result) {
  const palette = colors();
  const colorOf = (word, fallback) => {
    if (!word) return fallback;
    if (/^\d+$/.test(word)) return Number(word);
    const want = word.toLowerCase().replace(/[-_]/g, " ");
    for (const [code, e] of palette) if (e.name.toLowerCase() === want) return code;
    for (const [code, e] of palette) if (e.name.toLowerCase().includes(want)) return code;
    return fallback;
  };
  const centreY = (slot) => (slot + 0.5) * STUD;
  const parts = [];
  const phases = {};
  for (const a of spec.axles) {
    const slots = spec.gears.filter((g) => g.axle === a.id).map((g) => g.at);
    const len = a.len ?? Math.max(2, ...slots.map((s) => s + 2));
    const file = AXLES[len] ?? AXLES[Math.min(...Object.keys(AXLES).map(Number).filter((l) => l >= len))] ?? AXLES[12];
    const centre = [a.x * STUD, (len * STUD) / 2 - STUD / 2, a.z * PLATE];
    parts.push({ axle: a.id, centre, packed: partAt(file, 0, centre, rotY) });
  }
  for (const g of spec.gears) {
    const a = spec.axles.find((x) => x.id === g.axle);
    const info = GEARS[g.teeth];
    const centre = [a.x * STUD, centreY(g.at), a.z * PLATE];
    const packed = partAt(info.part, colorOf(g.color, info.color), centre);
    g.tip = tipPhase(packed, centre[0], centre[2], g.teeth);
    parts.push({ axle: g.axle, centre, packed, gear: g });
  }
  // Phase each axle so that, at every mesh, a tooth of the driver points at
  // the other centre exactly when the driven gear offers a gap.
  phases[spec.input] = 0;
  const order = Object.keys(result.ratio).filter((id) => id !== spec.input);
  const pending = [...order];
  for (let guard = 0; pending.length && guard < 100; guard++) {
    const id = pending.shift();
    const p = result.via[id];
    const [driver, driven] = p.a.axle === id ? [p.b, p.a] : [p.a, p.b];
    if (phases[driver.axle] === undefined) { pending.push(id); continue; }
    const A = spec.axles.find((x) => x.id === driver.axle), B = spec.axles.find((x) => x.id === driven.axle);
    const towards = Math.atan2((B.z - A.z) * PLATE, (B.x - A.x) * STUD);
    // Driver rotated by its phase has a tip at towards when phiA = towards - tipA.
    const k = driver.teeth / driven.teeth;
    const thetaA = towards - driver.tip;
    const thetaB = towards + Math.PI + Math.PI / driven.teeth - driven.tip;
    // Driven angle follows theta_B(t) = -k * theta_A(t) + c.
    phases[id] = { c: thetaB + k * thetaA, k, from: driver.axle, base: thetaA };
  }
  return { parts, phases };
}

// ------------------------------------------------------------------ page
function kitInline() {
  return readFileSync(join(HERE, "..", "kit", "iso-kit.mjs"), "utf8").replace(/^export /gm, "");
}

// Turn packed geometry about an axle parallel to y through (cx, cz).
export function turn(packed, cx, cz, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const spin = (list, start) => list.map((row) => {
    const out = row.slice();
    for (let i = start; i + 2 < out.length; i += 3) {
      const x = out[i] - cx, z = out[i + 2] - cz;
      out[i] = cx + x * c - z * s;
      out[i + 2] = cz + x * s + z * c;
    }
    return out;
  });
  return { tris: spin(packed.tris, 2), edges: spin(packed.edges, 0), cond: spin(packed.cond, 0) };
}

function writePage(spec, result, lines, { theme, mode, out }) {
  const { parts, phases } = assemble(spec, result);
  // Each axle's angle is scale * t + offset, t being the input's angle. A
  // driven axle follows theta = -k * theta_driver + c (from assemble), so its
  // law follows from its driver's; resolve them outward from the input.
  const law = { [spec.input]: { scale: 1, offset: 0 } };
  const ids = Object.keys(result.ratio);
  for (let guard = 0; guard < 100 && Object.keys(law).length < ids.length; guard++) {
    for (const id of ids) {
      const p = phases[id];
      if (law[id] || !p || !law[p.from]) continue;
      law[id] = { scale: -p.k * law[p.from].scale, offset: p.c - p.k * law[p.from].offset };
    }
  }

  // Look mostly down the axles, so the gears show their faces and their mesh.
  const WIDTH = 640, HEIGHT = 400, azimuth = 70, elevation = 24;
  const still = mergePacked(parts.map((p) => p.packed));
  const b = boundsOf(still);
  const room = { lo: [b.lo[0] - 26, b.lo[1] - 26, b.lo[2]], hi: [b.hi[0] + 26, b.hi[1] + 26, b.hi[2]] };
  const P = { ...k.fitProjection(cornersOf(room), WIDTH, HEIGHT, { pad: 34, azimuth, elevation }), width: WIDTH, height: HEIGHT };
  const palette = paletteFor(still);
  const pose = (t) =>
    mergePacked(parts.map((p) => {
      const l = law[p.axle];
      return l ? turn(p.packed, p.centre[0], p.centre[2], l.scale * t + l.offset) : p.packed;
    }));
  const r = result.ratio[spec.output];
  const readout = result.jammed
    ? "jammed"
    : !result.connected
      ? "output not driven"
      : `${spec.rpm} rpm in · ${Math.abs(result.outRpm).toFixed(1)} rpm out · ${ratioText(r)}${result.kmh != null ? ` · ${result.kmh.toFixed(1)} km/h` : ""}`;
  // Shown slowed down so the input makes a fifth of a turn a second.
  const slow = spec.rpm / 60 / 0.2;

  const svg = k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label: `${spec.title}: a Technic gear train drawn from the LDraw parts in BrickLink Studio. ${lines.join(". ")}.`,
    body: [`<g data-rulers>${rulers(k, P, b)}</g>`, `<g class="lg" data-mode="${mode}">${paint(pose(0), P, mode, palette)}</g>`],
  });
  const live = `
const PARTS = ${JSON.stringify(parts.map((p) => ({ axle: p.axle, cx: p.centre[0], cz: p.centre[2], packed: p.packed })))};
const LAW = ${JSON.stringify(law)};
const PALETTE = ${JSON.stringify(palette)};
const MODE = ${JSON.stringify(mode)};
const P = ${JSON.stringify(P)};
const BOUNDS = ${JSON.stringify(b)};
const JAMMED = ${JSON.stringify(result.jammed)};
const HALF_STUD = ${HALF_STUD}, PLATE = ${PLATE};
const paint = ${paint.toString()};
const rulers = ${rulers.toString()};
const turn = ${turn.toString()};
const mergePacked = ${mergePacked.toString()};
const KIT = { solidSvg, slabOf, segment, lineSvg };
const stage = document.querySelector(".iso-stage");
const group = stage.querySelector(".lg");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const RATE = 2 * Math.PI * 0.2; // input radians per second as shown
let t = 0, last = 0, frame = 0, visible = false, paused = still.matches || JAMMED, spun = 0;
function draw() {
  const pose = mergePacked(PARTS.map((p) => { const l = LAW[p.axle]; return l ? turn(p.packed, p.cx, p.cz, l.scale * t + l.offset) : p.packed; }));
  group.innerHTML = paint(pose, P, MODE, PALETTE);
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
  last = now;
  if (!paused) { t += dt * RATE; draw(); }
  frame = visible && !paused ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !paused) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
const toggle = () => { if (JAMMED) return; paused = !paused; run(); };
stage.addEventListener("click", toggle);
stage.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(); }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); t += (event.key === "ArrowRight" ? 1 : -1) * Math.PI / 12; draw(); }
});
`;
  const body = k.plateHtml({
    fig: "Fig 1",
    title: spec.title,
    hint: result.jammed ? "Jammed: it cannot turn" : "Click to stop or start · arrows step",
    readout,
    keys: [
      ...lines.map((line, i) => ({ mark: /meshes/.test(line) ? "lit" : /collide|skip|jammed|not driven/.test(line) ? "dim" : "raised", label: line })),
      { mark: "edge", label: `Shown at 1/${Math.round(slow)} speed. Rulers: half studs across (4 mm), plates up (3.2 mm)` },
    ],
    caption: `${spec.title}. LEGO gears are module 1, so two mesh when their axles are (T1 + T2) / 2 mm apart: on the grid, 8 mm a stud across and 3.2 mm a plate up. Input: ${spec.motor}${MOTORS[spec.motor] ? ` (${spec.rpm} rpm, no load, 9 V)` : ""}. Speeds and torque are ideal, before friction and load.`,
    body: `<div class="iso-stage" tabindex="0" role="img" aria-label="${spec.title}" style="cursor:pointer">${svg}</div>`,
  });
  const page = k.pageHtml({ title: spec.title, theme, body: `<style>${LEGO_CSS}</style>${body}`, script: kitInline() + live, width: 680 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page);
  return { faces: still.tris.length, kb: page.length / 1024 };
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out");
  if (!file) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 28).join("\n"));
    process.exit(0);
  }
  const theme = argv.includes("--light") ? "light" : "dark";
  const mode = argv.includes("--tone") ? "tone" : "color";
  const name = basename(file).replace(/\.[^.]+$/, "");
  const spec = parse(readFileSync(file, "utf8"), name);
  const result = solve(spec);
  const lines = report(spec, result);
  for (const line of lines) console.log(line);
  setDetail("low");
  const at = argv.indexOf("--out");
  const out = at >= 0 ? argv[at + 1] : join(HERE, "out", `${name}${theme === "light" ? "-light" : ""}.html`);
  const { faces, kb } = writePage(spec, result, lines, { theme, mode, out });
  console.log(`wrote ${out}  (${faces} faces, ${kb.toFixed(0)} KB)`);
  if (result.jammed) process.exitCode = 2;
}
