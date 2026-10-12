// Reads LEGO parts straight out of a BrickLink Studio install: the LDraw part
// library for geometry, LDConfig for colours, and Studio's part table for
// names and BrickLink numbers. Nothing is copied; set STUDIO_DIR to point at
// another install.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

export const STUDIO = process.env.STUDIO_DIR ?? "C:/Program Files/Studio 2.0";
const LIB = join(STUDIO, "ldraw");

// Search order follows LDraw's: official parts and primitives, then Studio's
// unofficial set, then its LEGO folder.
const ROOTS = ["parts", "p", "UnOfficial/parts", "UnOfficial/p", "LEGO"].map((dir) => join(LIB, dir));

const files = new Map();

// Studio's own name -> path indexes, one per level of detail: 0 resolves
// primitives to the coarse p/8 set, 1 to the normal set, 2 to the fine p/48.
const DETAIL = { low: 0, normal: 1, high: 2 };
let detail = 1;
const indexes = new Map();
export function setDetail(level) {
  detail = DETAIL[level] ?? 1;
  files.clear();
}
function indexed(name) {
  if (!indexes.has(detail)) {
    const map = new Map();
    const path = join(LIB, `cachedLibraryPath_${detail}.txt`);
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const [file, relative] = line.replace(/^﻿/, "").split("\t");
        if (file && relative) map.set(file.toLowerCase(), relative);
      }
    }
    indexes.set(detail, map);
  }
  const relative = indexes.get(detail).get(name);
  return relative ? join(LIB, relative) : null;
}

function locate(name) {
  const clean = name.trim().replace(/\\/g, "/").toLowerCase();
  const hit = indexed(clean);
  if (hit && existsSync(hit)) return hit;
  for (const root of ROOTS) {
    const path = join(root, clean);
    if (existsSync(path)) return path;
  }
  return null;
}

// One parsed file: its lines, with numbers already split out.
function load(name) {
  const key = name.trim().replace(/\\/g, "/").toLowerCase();
  if (files.has(key)) return files.get(key);
  const path = key.endsWith(".ldr") || key.includes(":") ? key : locate(key);
  if (!path || !existsSync(path)) {
    files.set(key, null);
    return null;
  }
  const lines = [];
  let ccw = true;
  let certified = false;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const type = parts[0];
    if (type === "0") {
      const meta = parts.slice(1).join(" ").toUpperCase();
      if (meta.startsWith("BFC")) {
        if (meta.includes("CERTIFY") && !meta.includes("NOCERTIFY")) certified = true;
        if (meta.includes("CW") && !meta.includes("CCW")) ccw = false;
        if (meta.includes("CCW")) ccw = true;
        lines.push({ type: 0, invertNext: meta.includes("INVERTNEXT"), ccw: meta.includes("CW") ? meta.includes("CCW") : null });
      }
      continue;
    }
    if (type === "1") {
      const n = parts.slice(1, 14).map(Number);
      lines.push({ type: 1, color: n[0], m: n.slice(1, 13), file: parts.slice(14).join(" ") });
    } else if (type === "2" || type === "3" || type === "4" || type === "5") {
      const n = parts.slice(1).map(Number);
      lines.push({ type: Number(type), color: n[0], v: n.slice(1) });
    }
  }
  const parsed = { path, lines, certified };
  files.set(key, parsed);
  return parsed;
}

// Register a model given as text: an .ldr, or an .mpd whose "0 FILE" sections
// are submodels (Studio exports both). Returns the name of its main model.
export function loadText(name, text) {
  const sections = [];
  let current = { name: name.toLowerCase(), lines: [] };
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === "0" && parts[1] === "FILE") {
      if (current.lines.length || sections.length) sections.push(current);
      current = { name: parts.slice(2).join(" ").toLowerCase(), lines: [] };
      continue;
    }
    if (parts[0] === "1") {
      const n = parts.slice(1, 14).map(Number);
      current.lines.push({ type: 1, color: n[0], m: n.slice(1, 13), file: parts.slice(14).join(" ") });
    }
  }
  sections.push(current);
  for (const section of sections) files.set(section.name, { path: `inline:${section.name}`, lines: section.lines, certified: true }); // only part references, so it passes BFC through
  return sections[0].name;
}

// 3x4 affine matrices: [x y z a b c d e f g h i] is translation then rows.
const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const apply = (M, [x, y, z]) => [
  M[0] + M[3] * x + M[4] * y + M[5] * z,
  M[1] + M[6] * x + M[7] * y + M[8] * z,
  M[2] + M[9] * x + M[10] * y + M[11] * z,
];
const compose = (A, B) => {
  const r = (i, j) => A[3 + i * 3] * B[3 + j] + A[4 + i * 3] * B[6 + j] + A[5 + i * 3] * B[9 + j];
  const t = apply(A, [B[0], B[1], B[2]]);
  return [...t, r(0, 0), r(0, 1), r(0, 2), r(1, 0), r(1, 1), r(1, 2), r(2, 0), r(2, 1), r(2, 2)];
};
const det = (M) =>
  M[3] * (M[7] * M[11] - M[8] * M[10]) - M[4] * (M[6] * M[11] - M[8] * M[9]) + M[5] * (M[6] * M[10] - M[7] * M[9]);

// Flatten a part or model into world-space triangles and edges. Colour 16
// inherits from the parent and 24 means "the parent's edge colour". Winding is
// tracked through BFC so every triangle's normal points out of the part.
export function flatten(name, color = 16, matrix = IDENTITY) {
  const out = { tris: [], edges: [], cond: [], missing: new Set() };
  walk(name, color, matrix, false, out, true);
  return out;
}

function walk(name, color, M, invert, out, certified) {
  const file = load(name);
  if (!file) {
    out.missing.add(name);
    return;
  }
  const solid = certified && file.certified;
  let ccw = true;
  let invertNext = false;
  for (const line of file.lines) {
    if (line.type === 0) {
      if (line.invertNext) invertNext = true;
      if (line.ccw !== null && line.ccw !== undefined) ccw = line.ccw;
      continue;
    }
    const own = line.color === 16 ? color : line.color === 24 ? 24 : line.color;
    if (line.type === 1) {
      const child = compose(M, line.m);
      const flip = invert !== (det(line.m) < 0) !== invertNext;
      walk(line.file, own, child, flip, out, solid);
      invertNext = false;
      continue;
    }
    const v = line.v;
    const points = [];
    for (let i = 0; i + 2 < v.length; i += 3) points.push(apply(M, [v[i], v[i + 1], v[i + 2]]));
    if (line.type === 2) out.edges.push(points);
    else if (line.type === 5) out.cond.push(points);
    else {
      // Polygons are wound CCW when seen from outside; correct for the file's
      // own winding and for any mirror on the way down.
      const reverse = !ccw !== invert;
      const poly = reverse ? [...points].reverse() : points;
      out.tris.push({ points: poly, color: own, solid });
    }
  }
}

// A Studio .io file is a zip holding the model as model.ldr (an MPD when it has
// submodels). Read that entry with the central directory and inflate it.
export function readIo(path) {
  const zip = readFileSync(path);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${path} is not a zip`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    entries.push({ name: zip.toString("utf8", at + 46, at + 46 + nameLength), flags, method, size, local });
    at += 46 + nameLength + extra + comment;
  }
  const entry = entries.find((e) => e.name.toLowerCase() === "model.ldr") ?? entries.find((e) => /\.(ldr|mpd)$/i.test(e.name));
  if (!entry) throw new Error(`${path} has no model.ldr inside`);
  if (entry.flags & 1) throw new Error(`${path} is encrypted; export it from Studio with File > Export As > LDraw instead`);
  const start = entry.local + 30 + zip.readUInt16LE(entry.local + 26) + zip.readUInt16LE(entry.local + 28);
  const body = zip.subarray(start, start + entry.size);
  const text = (entry.method === 8 ? inflateRawSync(body) : body).toString("utf8");
  return text.replace(/^﻿/, "");
}

// Every part a model places, with its world matrix, walking into submodels.
export function placements(name, M = IDENTITY, out = []) {
  const file = load(name);
  if (!file) return out;
  for (const line of file.lines) {
    if (line.type !== 1) continue;
    const child = compose(M, line.m);
    const sub = files.get(line.file.trim().replace(/\\/g, "/").toLowerCase());
    if (sub && sub.path.startsWith("inline:")) placements(line.file, child, out);
    else out.push({ file: line.file, color: line.color, m: child });
  }
  return out;
}

// ------------------------------------------------------------------ colours
let palette = null;
export function colors() {
  if (palette) return palette;
  palette = new Map();
  const text = readFileSync(join(LIB, "LDConfig.ldr"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6})(.*)$/);
    if (!m) continue;
    const alpha = /ALPHA\s+(\d+)/.exec(m[5]);
    palette.set(Number(m[2]), { name: m[1].replace(/_/g, " "), value: m[3], edge: m[4], alpha: alpha ? Number(alpha[1]) / 255 : 1 });
  }
  return palette;
}

// ------------------------------------------------------------------ catalog
let table = null;
export function catalog() {
  if (table) return table;
  const text = readFileSync(join(STUDIO, "data", "StudioPartDefinition2.txt"), "utf8").split(/\r?\n/);
  const head = text[0].split("\t");
  const at = (label) => head.indexOf(label);
  const cols = { studio: at("Studio ItemNo"), bl: at("BL ItemNo"), ldraw: at("LDraw ItemNo"), ldd: at("LDD ItemNo"), name: at("Description") };
  table = [];
  const seen = new Set();
  for (const row of text.slice(1)) {
    const c = row.split("\t");
    const ldraw = c[cols.ldraw];
    if (!ldraw || seen.has(ldraw)) continue;
    seen.add(ldraw);
    table.push({ studio: c[cols.studio], bl: c[cols.bl], ldraw, ldd: c[cols.ldd], name: c[cols.name] });
  }
  return table;
}

// Find parts by BrickLink, LDraw or LDD number, or by words in the name.
export function find(query, limit = 20) {
  const q = String(query).trim().toLowerCase();
  const rows = catalog();
  // An exact number wins, LDraw and BrickLink numbers before LDD and Studio ids.
  const rank = (r) => [r.ldraw.replace(/\.dat$/i, ""), r.bl, r.ldd, r.studio].findIndex((id) => id && id.toLowerCase() === q);
  const exact = rows.map((r) => [rank(r), r]).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  if (exact.length) return exact.slice(0, limit);
  // By words in the name, the plainest (shortest) names first.
  const words = q.split(/\s+/);
  return rows
    .filter((r) => words.every((w) => r.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit);
}
