#!/usr/bin/env node
/**
 * Clover Village Ground topology analyzer.
 *
 * All 26 land pieces are 256x256 with transparency (alpha channel). The alpha
 * silhouette directly reveals each piece's role: where the grass is solid
 * (alpha>0) vs transparent defines the terrain boundary geometry.
 *
 * Classifies:
 *   - land_1: base-texture (fully opaque, repeat)
 *   - land_2: patch (isolated island of grass on transparency)
 *   - land_3-10: edge kit (4 cardinal orientations x 2 variants)
 *   - land_11-22: organic corner/compound pieces
 *   - land_23-26: hard 90-degree corners
 *
 * Emits design/assets/ground-topology-roles.json and a visual preview at
 * deploy/asset-catalog/terrain/index.html.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const LAND_DIR = join(root, "reference", "assets", "maps", "CloverVillage", "Map", "PNG", "land");
const BASE_URL = "https://pawsandparcels.agpstudios.org/reference/assets/maps/CloverVillage/Map/PNG/land";

function decodePng(buf) {
  let off = 8, width, height, colorType, bitDepth;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if ((colorType !== 2 && colorType !== 6) || bitDepth !== 8) throw new Error(`unsupported colorType=${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: throw new Error("bad filter " + filter);
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * img.channels + (img.channels === 4 ? 3 : 0)];
const ALPHA_SOLID = 40;

// Coverage of a band: fraction of solid (opaque) pixels
function bandCoverage(img, side, band = 16) {
  const { width, height } = img;
  let solid = 0, total = 0;
  for (let i = 0; i < band; i++) {
    if (side === "n") for (let x = 0; x < width; x++) { total++; if (alphaAt(img, x, i) >= ALPHA_SOLID) solid++; }
    if (side === "s") for (let x = 0; x < width; x++) { total++; if (alphaAt(img, x, height - 1 - i) >= ALPHA_SOLID) solid++; }
    if (side === "w") for (let y = 0; y < height; y++) { total++; if (alphaAt(img, i, y) >= ALPHA_SOLID) solid++; }
    if (side === "e") for (let y = 0; y < height; y++) { total++; if (alphaAt(img, width - 1 - i, y) >= ALPHA_SOLID) solid++; }
  }
  return total ? solid / total : 0;
}

function overallCoverage(img) {
  const { width, height } = img;
  let solid = 0, total = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total++; if (alphaAt(img, x, y) >= ALPHA_SOLID) solid++; }
  return total ? solid / total : 0;
}

// 4 quadrants (TL/TR/BL/BR) coverage — for corner classification
function quadrantCoverage(img) {
  const { width, height } = img;
  const q = { tl: 0, tr: 0, bl: 0, br: 0 };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alphaAt(img, x, y) < ALPHA_SOLID) continue;
    if (x < width / 2 && y < height / 2) q.tl++;
    else if (x >= width / 2 && y < height / 2) q.tr++;
    else if (x < width / 2 && y >= height / 2) q.bl++;
    else q.br++;
  }
  const total = q.tl + q.tr + q.bl + q.br || 1;
  for (const k of Object.keys(q)) q[k] = q[k] / total;
  return q;
}

function ascii(img, scale = 48) {
  const { width, height } = img;
  const sx = Math.max(1, Math.round(width / scale));
  const sy = Math.max(1, Math.round(height / scale));
  let out = "";
  for (let y = 0; y < height; y += sy) {
    for (let x = 0; x < width; x += sx) out += alphaAt(img, x, y) >= ALPHA_SOLID ? "#" : ".";
    out += "\n";
  }
  return out;
}

const ROLE_LABEL = {
  "base-texture": "Base texture",
  patch: "Patch",
  "edge-n": "Edge N", "edge-e": "Edge E", "edge-s": "Edge S", "edge-w": "Edge W",
  "outer-corner-ne": "Outer NE", "outer-corner-se": "Outer SE", "outer-corner-sw": "Outer SW", "outer-corner-nw": "Outer NW",
  "inner-corner-ne": "Inner NE", "inner-corner-se": "Inner SE", "inner-corner-sw": "Inner SW", "inner-corner-nw": "Inner NW",
  "hard-corner-ne": "Hard NE", "hard-corner-se": "Hard SE", "hard-corner-sw": "Hard SW", "hard-corner-nw": "Hard NW",
  "compound": "Compound L",
  "transition": "Transition",
};

async function main() {
  const tiles = [];
  for (let i = 1; i <= 26; i++) {
    const file = `land_${i}.png`;
    const img = decodePng(await readFile(join(LAND_DIR, file)));
    tiles.push({ file, img });
  }

  // Per-tile metrics
  for (const t of tiles) {
    t.coverage = overallCoverage(t.img);
    t.bands = {};
    for (const s of ["n", "e", "s", "w"]) t.bands[s] = bandCoverage(t.img, s);
    t.quads = quadrantCoverage(t.img);
    t.bits = ["n", "e", "s", "w"].map((s) => (t.bands[s] >= 0.5 ? 1 : 0)).join("");
  }

  // land_1 base texture: fully opaque
  const base = tiles.find((t) => t.file === "land_1.png");
  const isBase = base.coverage > 0.99;

  // land_2 patch: island, all 4 sides open (low band coverage)
  const patch = tiles.find((t) => t.file === "land_2.png");

  const idx = (f) => parseInt(f.match(/\d+/)[0], 10);
  const inRange = (f, lo, hi) => idx(f) >= lo && idx(f) <= hi;

  // Edges: land_3-10 — exactly 1 high band, 3 low bands (with organic contours)
  const edgeTiles = tiles.filter((t) => inRange(t.file, 3, 10));
  const edgeRoles = {};
  for (const t of edgeTiles) {
    const solid = ["n", "e", "s", "w"].filter((s) => t.bands[s] >= 0.5);
    let role = null;
    if (solid.length === 1) role = `edge-${solid[0]}`;
    else if (solid.length === 2 && t.bands.n >= 0.5 && t.bands.s >= 0.5) role = "compound-horizontal";
    else if (solid.length === 2 && t.bands.w >= 0.5 && t.bands.e >= 0.5) role = "compound-vertical";
    else role = `edge-${solid.join("") || "?"}`;
    edgeRoles[t.file] = role;
  }

  // Corners land_11-26: quadrant analysis
  const cornerTiles = tiles.filter((t) => inRange(t.file, 11, 26));
  const cornerRoles = {};
  for (const t of cornerTiles) {
    const { tl, tr, bl, br } = t.quads;
    const solidQuads = (tl >= 0.5 ? "tl" : "") + (tr >= 0.5 ? "tr" : "") + (bl >= 0.5 ? "bl" : "") + (br >= 0.5 ? "br" : "");
    const solidSides = ["n", "e", "s", "w"].filter((s) => t.bands[s] >= 0.5).sort().join("");
    let role;
    if (solidSides.length >= 2 && (solidSides === "ns" || solidSides === "ew")) {
      role = "compound";
    } else {
      switch (solidQuads) {
        case "tl": role = "outer-corner-nw"; break;
        case "tr": role = "outer-corner-ne"; break;
        case "bl": role = "outer-corner-sw"; break;
        case "br": role = "outer-corner-se"; break;
        case "tltr": role = "edge-n"; break;
        case "blbr": role = "edge-s"; break;
        case "tlbl": role = "edge-w"; break;
        case "trbr": role = "edge-e"; break;
        case "tltrbl": role = "inner-corner-se"; break;
        case "tltrbr": role = "inner-corner-sw"; break;
        case "tlblbr": role = "inner-corner-ne"; break;
        case "trblbr": role = "inner-corner-nw"; break;
        case "tltrblbr": role = "base-texture"; break;
        default: role = "compound";
      }
    }
    cornerRoles[t.file] = role;
  }

  // Compose classification
  const roles = {};
  roles["land_1.png"] = isBase ? "base-texture" : "??";
  roles["land_2.png"] = "patch";
  for (const t of edgeTiles) roles[t.file] = edgeRoles[t.file];
  for (const t of cornerTiles) roles[t.file] = cornerRoles[t.file];

  console.log("Per-tile alpha analysis (coverage, band solidity, quadrants):");
  for (const t of tiles) {
    console.log(`  ${t.file}  cov=${t.coverage.toFixed(2)}  n=${t.bands.n.toFixed(2)} e=${t.bands.e.toFixed(2)} s=${t.bands.s.toFixed(2)} w=${t.bands.w.toFixed(2)}  bits=${t.bits}  quads=${Object.values(t.quads).map((q) => q.toFixed(2)).join("/")}  -> ${roles[t.file]}`);
  }

  const result = {
    pack: "CloverVillage",
    category: "ground",
    method: "alpha-silhouette analysis (256x256, alpha>=40 solid, 16px bands, quadrant coverage)",
    familyPlan: {
      clover_grass_base: { count: 1, files: ["land_1.png"], role: "base-texture" },
      clover_grass_patch: { count: 1, files: ["land_2.png"], role: "patch" },
      clover_grass_edge: { count: 8, files: ["land_3.png", "land_4.png", "land_5.png", "land_6.png", "land_7.png", "land_8.png", "land_9.png", "land_10.png"], role: "edge" },
      clover_grass_corner: { count: 16, files: tiles.filter((t) => t.file >= "land_11.png").map((t) => t.file), role: "corner/transition" },
    },
    roles,
    edgeKit: edgeRoles,
    cornerKit: cornerRoles,
  };
  const outDir = join(root, "design", "assets");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "ground-topology-roles.json"), JSON.stringify(result, null, 2), "utf8");
  console.log("Wrote design/assets/ground-topology-roles.json");

  // Preview page: gallery with role labels + ASCII rows for the corners
  const gallery = tiles.map((t) => {
    const role = roles[t.file];
    const known = t.file === "land_1.png" || t.file === "land_2.png" ? " known" : "";
    return `<div class="tile-card${known}" data-role="${role}">
      <img src="${BASE_URL}/${t.file}" alt="${t.file}">
      <div class="tname">${t.file}</div>
      <div class="trole">${ROLE_LABEL[role] ?? role}</div>
      <div class="tbands">n ${t.bands.n.toFixed(2)} · e ${t.bands.e.toFixed(2)} · s ${t.bands.s.toFixed(2)} · w ${t.bands.w.toFixed(2)}</div>
    </div>`;
  }).join("\n");

  const asciiRows = cornerTiles.map((t) => `<div class="ascii-block"><div class="tname">${t.file} — ${ROLE_LABEL[cornerRoles[t.file]] ?? cornerRoles[t.file]}</div><pre>${ascii(t.img)}</pre></div>`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clover Village Terrain — Topology Preview</title>
<style>
  body { font-family: system-ui; max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 1.75rem; }
  .banner { padding: 0.8rem 1rem; border-radius: 8px; font-weight: 600; margin-bottom: 1rem; background: #fff3e0; border: 1px solid #ffcc80; color: #e65100; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
  .tile-card { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 0.5rem; text-align: center; }
  .tile-card.known { border-color: #456b4e; box-shadow: 0 0 0 2px #c8e6c9; }
  .tile-card img { max-width: 100%; background: repeating-conic-gradient(#e8ede6 0% 25%, #fff 0% 50%) 50%/16px 16px; border-radius: 4px; }
  .tname { font-weight: 600; font-size: 0.8rem; margin-top: 0.3rem; }
  .trole { font-size: 0.75rem; color: #416f99; }
  .tbands { font-size: 0.65rem; color: #68766b; font-family: ui-monospace, monospace; }
  .ascii-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
  .ascii-block { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 0.5rem; }
  .ascii-block pre { font-size: 0.55rem; line-height: 1.1; margin: 0.4rem 0 0; color: #2e5037; }
  .note { font-size: 0.85rem; color: #68766b; }
</style>
</head>
<body>
<h1>Clover Village Terrain — Topology Preview</h1>
<div class="banner">Alpha-silhouette analysis. Green border = locked (land_1 base, land_2 patch). Edge/corner compass roles are auto-derived from the alpha silhouette — confirm visually before finalizing canonical names.</div>
<h2>All 26 pieces</h2>
<div class="gallery">${gallery}</div>
<h2>Corner/transition pieces (land_11-26) — alpha silhouette</h2>
<p class="note"># = grass (opaque), . = transparent.</p>
<div class="ascii-grid">${asciiRows}</div>
</body>
</html>
`;
  const previewDir = join(root, "deploy", "asset-catalog", "terrain");
  await mkdir(previewDir, { recursive: true });
  await writeFile(join(previewDir, "index.html"), html, "utf8");
  console.log("Wrote deploy/asset-catalog/terrain/index.html");
}

main().catch((e) => { console.error(e); process.exit(1); });
