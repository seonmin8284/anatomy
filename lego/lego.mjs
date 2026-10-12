// LEGO parts from a BrickLink Studio install, drawn as Anatomy figures.
//
//   node lego.mjs find gear 8            search Studio's part table
//   node lego.mjs part 3001 --color red  one part
//   node lego.mjs sheet 3001 3647 32523  several parts in a row
//   node lego.mjs model my.ldr           a model exported from Studio (.ldr / .mpd / .io)
//   node lego.mjs build tower.bld        place parts in studs and plates (see build())
//
// Flags: --light, --tone (the kit's paper tones instead of LEGO colours),
// --color <code|name>, --out <file.html>, --azimuth <deg>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { colors, find, flatten, loadText, placements, readIo, setDetail } from "./ldraw.mjs";
import { HALF_STUD, PLATE, describe, onGrid, rulers, snap } from "./units.mjs";
import { LEGO_CSS, boundsOf, cornersOf, mergePacked, packMesh, paint, paletteFor } from "./render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};
const positional = argv.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && ["--color", "--out", "--azimuth", "--detail"].includes(argv[index - 1])));
const [command, ...args] = positional;

function colorCode(value) {
  if (value === undefined) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const want = value.toLowerCase().replace(/[-_]/g, " ");
  for (const [code, entry] of colors()) if (entry.name.toLowerCase() === want) return code;
  for (const [code, entry] of colors()) if (entry.name.toLowerCase().includes(want)) return code;
  throw new Error(`no LDraw colour called "${value}"`);
}

function resolvePart(query) {
  const hit = find(query, 1)[0];
  if (!hit) throw new Error(`no part matches "${query}" (try: node lego.mjs find ${query})`);
  return hit;
}

const STUD = 20; // LDraw units per stud; units.mjs has the rest of the system

function writePage({ name, title, data, caption, readout, theme, mode, azimuth, out, keys = [] }) {
  const WIDTH = 640;
  // Past this many faces the page draws once and does not carry the mesh to turn it.
  const turnable = data.tris.length <= 20000;
  const HEIGHT = 400;
  const b = boundsOf(data);
  const elevation = 30;
  const room = { lo: [b.lo[0] - 26, b.lo[1] - 26, b.lo[2]], hi: [b.hi[0] + 26, b.hi[1] + 26, b.hi[2]] };
  const P = { ...k.fitProjection(cornersOf(room), WIDTH, HEIGHT, { pad: 34, azimuth, elevation }), width: WIDTH, height: HEIGHT };
  const size = describe(b);
  readout = readout ?? size;
  const centre = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
  const palette = paletteFor(data);
  const plan = { x: b.lo[0] - STUD, y: b.lo[1] - STUD, w: b.hi[0] - b.lo[0] + STUD * 2, d: b.hi[1] - b.lo[1] + STUD * 2, r: 6 };
  const halo = `<path class="iso-halo" d="${k.haloOf(plan, b.lo[2], 0.1, P)}"/>`;

  const svg = k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label: `${title}, drawn from the LDraw library in BrickLink Studio. Drag or use the arrow keys to turn it.`,
    body: [`<g data-halo>${halo}</g>`, `<g data-rulers>${rulers(k, P, b)}</g>`, `<g class="lg" data-mode="${mode}">${paint(data, P, mode, palette)}</g>`],
  });

  const live = `
const DATA = ${JSON.stringify(data)};
const PALETTE = ${JSON.stringify(palette)};
const MODE = ${JSON.stringify(mode)};
const BASE = ${JSON.stringify(P)};
const CENTRE = ${JSON.stringify(centre)};
const PLAN = ${JSON.stringify(plan)};
const FLOOR = ${b.lo[2]};
const paint = ${paint.toString()};
const HALF_STUD = ${HALF_STUD}, PLATE = ${PLATE};
const rulers = ${rulers.toString()};
const BOUNDS = ${JSON.stringify(b)};
const KIT = { solidSvg, slabOf, segment, lineSvg };
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const group = svg.querySelector(".lg");
const halo = svg.querySelector("[data-halo]");
const marks = svg.querySelector("[data-rulers]");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const home = BASE.azimuth;
let azimuth = home, target = home, frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idle = 0, drag = null;

// Keep the part's centre where it was when the camera swings round it.
function projection(az) {
  const P = { ...BASE, azimuth: az };
  const a = iso(CENTRE, BASE), b = iso(CENTRE, P);
  return { ...P, origin: [BASE.origin[0] + a[0] - b[0], BASE.origin[1] + a[1] - b[1]] };
}
function draw() {
  const P = projection(azimuth);
  group.innerHTML = paint(DATA, P, MODE, PALETTE);
  halo.innerHTML = '<path class="iso-halo" d="' + haloOf(PLAN, FLOOR, 0.1, P) + '"/>';
  marks.innerHTML = rulers(KIT, P, BOUNDS);
  const shown = ((Math.round(azimuth) % 360) + 360) % 360;
  const text = ${JSON.stringify(readout)} + " \\u00b7 turned " + shown + "\\u00b0";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(shown));
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) { clock += dt; target = home + Math.sin(clock * 0.35) * 32; }
  const before = azimuth;
  azimuth = still.matches ? target : azimuth + (target - azimuth) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(target - azimuth) < 0.05) azimuth = target;
  if (Math.abs(before - azimuth) > 0.04 || touring) draw();
  const done = !touring && azimuth === target;
  frame = visible && !done ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const hold = () => { touring = false; clearTimeout(idle); idle = setTimeout(() => { touring = !still.matches; clock = Math.asin(Math.max(-1, Math.min(1, (azimuth - home) / 32))) / 0.35; run(); }, 4000); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointerenter", () => { hold(); });
stage.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, from: target }; try { stage.setPointerCapture(event.pointerId); } catch {} hold(); });
stage.addEventListener("pointermove", (event) => { if (!drag) return; target = drag.from + (event.clientX - drag.x) * 0.5; hold(); run(); });
const release = () => { drag = null; };
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
stage.addEventListener("keydown", (event) => {
  const step = { ArrowLeft: -15, ArrowRight: 15 }[event.key];
  if (event.key === "Home") target = home;
  else if (step) target += step;
  else return;
  event.preventDefault();
  hold();
  run();
});
draw();
`;

  const body = k.plateHtml({
    fig: "Fig 1",
    title,
    hint: turnable ? "Drag to turn" : "Too many faces to turn live",
    readout,
    keys: [
      { mark: "raised", label: mode === "tone" ? "Paper tones by facing, as every Anatomy figure" : "LEGO colour, shaded by facing" },
      { mark: "edge", label: "Rulers: a tick every half stud (4 mm), long each stud (8 mm); up the post, every plate (3.2 mm), long each brick (9.6 mm)" },
      ...keys,
    ],
    caption,
    body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="${title}: arrow keys turn it" aria-valuemin="0" aria-valuemax="359" aria-valuenow="${azimuth}" style="cursor:grab;touch-action:none">${svg}</div>`,
  });
  const page = k.pageHtml({ title, theme, body: `<style>${LEGO_CSS}</style>${body}`, script: turnable ? kitInline() + live : "", width: 680 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page);
  const faces = data.tris.length;
  console.log(`wrote ${out}  (${faces} faces, ${(page.length / 1024).toFixed(0)} KB)`);
}

function kitInline() {
  return readFileSync(join(HERE, "..", "kit", "iso-kit.mjs"), "utf8").replace(/^export /gm, "");
}

function partLabel(hit) {
  const ids = [hit.bl && `BrickLink ${hit.bl}`, `LDraw ${hit.ldraw}`, hit.ldd && `LDD ${hit.ldd}`].filter(Boolean);
  return ids.join(" · ");
}

const theme = flag("light") ? "light" : "dark";
const mode = flag("tone") ? "tone" : "color";
const azimuth = Number(option("azimuth", 38));

if (command === "find") {
  const rows = find(args.join(" "), 30);
  for (const r of rows) console.log(`${(r.bl || "-").padEnd(10)} ${r.ldraw.padEnd(16)} ${r.name}`);
  if (!rows.length) console.log("nothing found");
} else if (command === "part") {
  const hit = resolvePart(args.join(" "));
  const color = colorCode(option("color")) ?? 71;
  const mesh = flatten(hit.ldraw, color);
  if (mesh.missing.size) console.warn("missing sub-files:", [...mesh.missing].join(", "));
  const data = packMesh(mesh);
  const colorName = colors().get(color)?.name ?? `colour ${color}`;
  writePage({
    name: hit.ldraw,
    title: hit.name,
    data,
    caption: `${hit.name} in ${colorName}. ${partLabel(hit)}. Geometry is the LDraw part as shipped with BrickLink Studio, resolved through every sub-part and primitive; edges are LDraw's own lines, with its conditional lines drawn only where they fall on the silhouette.`,
    theme,
    mode,
    azimuth,
    out: option("out", join(HERE, "out", `${hit.ldraw.replace(/\.dat$/i, "")}${theme === "light" ? "-light" : ""}.html`)),
  });
} else if (command === "sheet") {
  const color = colorCode(option("color"));
  const palette = [4, 1, 14, 2, 71, 15, 0, 25];
  let x = 0;
  const parts = [];
  const names = [];
  args.forEach((query, index) => {
    const hit = resolvePart(query);
    const mesh = flatten(hit.ldraw, color ?? palette[index % palette.length]);
    const packed = packMesh(mesh);
    const b = boundsOf(packed);
    // Each part stands on the floor, centred in y, after the one before it.
    const shifted = packMesh(mesh, [x - b.lo[0], -(b.lo[1] + b.hi[1]) / 2, -b.lo[2]]);
    parts.push(shifted);
    names.push(`${hit.name} (${hit.bl || hit.ldraw})`);
    x += b.hi[0] - b.lo[0] + STUD * 1.5;
  });
  const data = mergePacked(parts);
  writePage({
    name: "sheet",
    title: `${args.length} parts`,
    data,
    caption: `${names.join(", ")}. All drawn from the LDraw library shipped with BrickLink Studio, at one scale: a stud is 20 LDraw units, a brick 24 high.`,
    theme,
    mode,
    azimuth,
    out: option("out", join(HERE, "out", `sheet${theme === "light" ? "-light" : ""}.html`)),
  });
} else if (command === "model") {
  const file = args[0];
  const io = /\.io$/i.test(file);
  // Models default to Studio's coarse primitives: a set has thousands of studs.
  setDetail(option("detail", "low"));
  const text = io ? readIo(file) : readFileSync(file, "utf8");
  const name = loadText(basename(file), text);
  const mesh = flatten(name, 16);
  if (mesh.missing.size) console.warn("missing sub-files:", [...mesh.missing].slice(0, 20).join(", "));
  const data = packMesh(mesh);
  const title = basename(file).replace(/\.(ldr|mpd|io)$/i, "");
  // Check upright parts against the grid, relative to the first upright one.
  // A part's up axis is its matrix's second column; parts turned on their side
  // (SNOT) or set at an angle follow other grids, so they are only counted.
  const placed = placements(name);
  const upOf = (m) => [m[4], m[7], m[10]];
  const upright = placed.filter((p) => Math.abs(Math.abs(upOf(p.m)[1]) - 1) < 1e-3);
  const sideways = placed.filter((p) => Math.abs(upOf(p.m)[1]) < 1e-3 && upOf(p.m).every((c) => Math.abs(c) < 1e-3 || Math.abs(Math.abs(c) - 1) < 1e-3)).length;
  const angled = placed.length - upright.length - sideways;
  const [ox, oy, oz] = upright[0]?.m ?? [0, 0, 0];
  const off = upright.filter((p) => !onGrid(p.m[0] - ox, p.m[2] - oz, p.m[1] - oy));
  const extra = [sideways && `${sideways} on their side`, angled && `${angled} at an angle`].filter(Boolean).join(", ");
  const grid = `${upright.length - off.length} of ${upright.length} upright parts on the half-stud and plate grid${extra ? ` (${extra}, not checked)` : ""}`;
  console.log(grid);
  for (const p of off.slice(0, 10)) console.log(`  off grid: ${p.file} at ${[p.m[0] - ox, p.m[1] - oy, p.m[2] - oz].map((v) => v.toFixed(1)).join(", ")} LDU`);
  writePage({
    name: title,
    title,
    data,
    keys: [{ mark: off.length ? "dim" : "lit", label: grid }],
    caption: `${title}, ${io ? "opened straight from its Studio .io file (a zip with the model inside as LDraw)" : "an LDraw model"}, drawn from the parts library in BrickLink Studio.`,
    theme,
    mode,
    azimuth,
    out: option("out", join(HERE, "out", `${title}${theme === "light" ? "-light" : ""}.html`)),
  });
} else if (command === "build") {
  const file = args[0];
  const { title, ldr, notes, size } = build(readFileSync(file, "utf8"), basename(file).replace(/\.[^.]+$/, ""));
  for (const note of notes) console.warn(note);
  setDetail(option("detail", "normal"));
  const name = loadText(`${title}.ldr`, ldr);
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", `${title}.ldr`), ldr);
  const data = packMesh(flatten(name, 16));
  writePage({
    name: title,
    title,
    data,
    keys: [{ mark: notes.length ? "dim" : "lit", label: notes.length ? `${notes.length} placement${notes.length === 1 ? "" : "s"} corrected or flagged` : "Every part on the grid: half studs across, plates up" }],
    caption: `${title}: ${size} parts placed in studs across and plates up, each snapped to the LEGO grid, half a stud (4 mm) across and one plate (3.2 mm) up. Also written as LDraw to out/${title}.ldr, which Studio can open.`,
    theme,
    mode,
    azimuth,
    out: option("out", join(HERE, "out", `${title}${theme === "light" ? "-light" : ""}.html`)),
  });
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 10).join("\n"));
}

// A build file places parts on LEGO's two grids, one per line:
//
//   <part> <colour> <x> <y> <z> [r90|r180|r270]
//
// x and y are studs to the part's footprint corner, snapped to half a stud;
// z is plates from the floor to the part's underside, snapped to whole plates;
// r turns it about the vertical. "#" starts a comment, "title: ..." names it.
function build(text, fallback) {
  const ROT = {
    r0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    r90: [0, 0, 1, 0, 1, 0, -1, 0, 0],
    r180: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    r270: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  };
  let title = fallback;
  const notes = [];
  const lines = [`0 ${fallback}`, "0 Author: anatomy-lab build"];
  const boxes = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const named = /^title:\s*(.+)$/i.exec(line);
    if (named) {
      title = named[1].trim();
      return;
    }
    const [part, colour, ...rest] = line.split(/\s+/).filter((w) => w.toLowerCase() !== "at");
    const turn = rest.find((w) => /^r(0|90|180|270)$/i.test(w))?.toLowerCase() ?? "r0";
    const [x, y, z] = rest.filter((w) => !/^r\d+$/i.test(w)).map(Number);
    if ([x, y, z].some((v) => !Number.isFinite(v))) throw new Error(`line ${index + 1}: need <part> <colour> <x> <y> <z>`);
    const at = snap({ x, y, z });
    if (at.moved) notes.push(`line ${index + 1}: ${part} moved from (${x}, ${y}, ${z}) to (${at.x}, ${at.y}, ${at.z}) to sit on the grid`);
    const hit = resolvePart(part);
    const color = colorCode(colour);
    const R = ROT[turn];
    const b = boundsOf(packMesh(flatten(hit.ldraw, color, [0, 0, 0, ...R])));
    // Footprint corner to (x, y) studs, underside to z plates. Kit x is LDraw
    // x, kit y is LDraw z, kit z is minus LDraw y.
    const tx = at.x * STUD - b.lo[0];
    const tz = at.y * STUD - b.lo[1];
    const ty = b.lo[2] - at.z * PLATE;
    lines.push(`1 ${color} ${tx} ${ty} ${tz} ${R.join(" ")} ${hit.ldraw}`);
    // The body in grid cells; studs on top do not fill the cell above.
    const tall = Math.max(1, Math.floor((b.hi[2] - b.lo[2] + 0.5) / PLATE));
    boxes.push({
      name: `${hit.ldraw} (line ${index + 1})`,
      x: [at.x, at.x + (b.hi[0] - b.lo[0]) / STUD],
      y: [at.y, at.y + (b.hi[1] - b.lo[1]) / STUD],
      z: [at.z, at.z + tall],
    });
  });
  const overlap = (a, b) => a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (overlap(a.x, b.x) && overlap(a.y, b.y) && overlap(a.z, b.z)) notes.push(`${a.name} and ${b.name} occupy the same space`);
    }
  }
  return { title, ldr: lines.join("\n") + "\n", notes, size: boxes.length };
}
