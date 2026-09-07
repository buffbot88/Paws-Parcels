#!/usr/bin/env node
/**
 * Generate the five remaining Clover Village set-piece props — the pieces the
 * reference overview shows but the pack has no art for:
 *
 *   1. cafe-table.png   — small round café table with two stools (outdoor seating)
 *   2. garden-bed.png   — raised wooden garden bed with vegetable rows
 *   3. clothesline.png  — two-post clothesline with hanging laundry
 *   4. entrance-arch.png — grand wooden gate arch: stone pillar bases, lanterns,
 *                          white banner with a green clover emblem (south exit)
 *   5. lily-pads.png    — cluster of water lily pads with a bloom
 *
 * Painted procedurally in the pack's pastel language (warm woods, sage greens,
 * muted accents) as transparent cutouts, matching the other CloverValley props:
 * soft edges, flat fills with subtle shading, thin darker outlines so they read
 * at 40-120px rendered. Deterministic (fixed seeds) — regenerating yields
 * identical bytes.
 *
 * Run: node scripts/generate-clover-valley-props.mjs
 * Writes: reference/assets/new/CloverValley/Props/*.png
 * Then: npm run assets:inventory to refresh the inventory bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "./lib/png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "reference/assets/new/CloverValley/Props");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance-based coverage: 1 inside, soft 0.5-1px falloff at the edge. */
function ellipseCoverage(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  return clamp01(1.5 - d);
}

function roundRectCoverage(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - r;
  const hh = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hw;
  const qy = Math.abs(y - cy) - hh;
  const dx = Math.max(qx, 0);
  const dy = Math.max(qy, 0);
  const d = Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(qx, qy), 0) - r;
  return clamp01(0.5 - d);
}

/** Composite an RGBA color with coverage over the destination buffer. */
function paint(px, w, x, y, r, g, b, a) {
  if (x < 0 || x >= w || y < 0 || y >= (px.length / 4 / w) | 0) return;
  const i = (y * w + x) * 4;
  const da = px[i + 3] / 255;
  const sa = a;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

function fillEllipse(px, w, h, cx, cy, rx, ry, [r, g, b], alpha = 1) {
  const x0 = Math.floor(cx - rx) - 1;
  const x1 = Math.ceil(cx + rx) + 1;
  const y0 = Math.floor(cy - ry) - 1;
  const y1 = Math.ceil(cy + ry) + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cov = ellipseCoverage(x + 0.5, y + 0.5, cx, cy, rx, ry);
      if (cov > 0) paint(px, w, x, y, r, g, b, alpha * cov);
    }
  }
}

function fillRoundRect(px, w, h, x0, y0, x1, y1, radius, [r, g, b], alpha = 1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cov = roundRectCoverage(x + 0.5, y + 0.5, x0, y0, x1, y1, radius);
      if (cov > 0) paint(px, w, x, y, r, g, b, alpha * cov);
    }
  }
}

function fillPoly(px, w, h, points, [r, g, b], alpha = 1) {
  const y0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1p, y1p] = points[i];
      const [x2p, y2p] = points[(i + 1) % points.length];
      if ((y1p <= y && y2p > y) || (y2p <= y && y1p > y)) {
        const t = (y - y1p) / (y2p - y1p);
        xs.push(x1p + t * (x2p - x1p));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i]);
      const xb = Math.floor(xs[i + 1]);
      for (let x = xa; x <= xb; x++) paint(px, w, x, y, r, g, b, alpha);
    }
  }
}

/** 1px darker outline around an ellipse (keeps the cutout readable). */
function outlineEllipse(px, w, h, cx, cy, rx, ry, [r, g, b], alpha = 0.5) {
  const x0 = Math.floor(cx - rx) - 1;
  const x1 = Math.ceil(cx + rx) + 1;
  const y0 = Math.floor(cy - ry) - 1;
  const y1 = Math.ceil(cy + ry) + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cov = ellipseCoverage(x + 0.5, y + 0.5, cx, cy, rx, ry);
      const inside = ellipseCoverage(x + 0.5, y + 0.5, cx, cy, rx - 1, ry - 1);
      const ring = cov - inside;
      if (ring > 0) paint(px, w, x, y, r, g, b, alpha * clamp01(ring * 2));
    }
  }
}

function newCanvas(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}

/* ------------------------------------------------------------------ */
/* Palette (the pack's pastel family)                                  */
/* ------------------------------------------------------------------ */
const wood = [198, 150, 108]; // warm cream-wood (bench family)
const woodDark = [164, 120, 84];
const woodLine = [128, 92, 62];
const stone = [178, 184, 192]; // soft gray (plaza family)
const stoneDark = [148, 156, 164];
const soil = [112, 84, 60];
const soilDark = [88, 64, 46];
const leaf = [120, 170, 96];
const leafDark = [92, 142, 78];
const cream = [240, 234, 218];
const white = [244, 242, 234];
const pink = [236, 178, 192];
const blue = [166, 196, 226];
const yellow = [238, 208, 136];
const clover = [108, 162, 88];
const lantern = [248, 214, 118];
const lanternDark = [196, 158, 84];

/* ------------------------------------------------------------------ */
/* 1. Café table + stools                                              */
/* ------------------------------------------------------------------ */
function paintCafeTable() {
  const w = 224;
  const h = 176;
  const { px } = newCanvas(w, h);
  const cx = 112;
  // Shadowed underside between top and stools.
  fillEllipse(px, w, h, cx, 118, 62, 22, [90, 66, 44], 0.5);
  // Stool seats (flanking the table).
  for (const sx of [46, 178]) {
    fillEllipse(px, w, h, sx, 108, 24, 14, woodLine, 1);
    fillEllipse(px, w, h, sx, 106, 24, 14, wood, 1);
    fillRoundRect(px, w, h, sx - 5, 118, sx + 5, 158, 3, woodDark, 1);
  }
  // Central post.
  fillRoundRect(px, w, h, cx - 9, 106, cx + 9, 164, 4, woodDark, 1);
  fillRoundRect(px, w, h, cx - 5, 106, cx + 5, 164, 3, wood, 1);
  // Tabletop — rim then lighter top.
  fillEllipse(px, w, h, cx, 78, 66, 40, woodLine, 1);
  fillEllipse(px, w, h, cx, 76, 66, 40, wood, 1);
  fillEllipse(px, w, h, cx, 72, 50, 30, [216, 172, 128], 0.9);
  outlineEllipse(px, w, h, cx, 76, 66, 40, [104, 74, 50], 0.6);
  // Wood-grain flecks on the top.
  for (const [gx, gy] of [
    [84, 62], [108, 52], [136, 60], [120, 84], [92, 84], [146, 78],
  ]) {
    fillEllipse(px, w, h, gx, gy, 6, 2.5, woodDark, 0.25);
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* 2. Raised garden bed                                                */
/* ------------------------------------------------------------------ */
function paintGardenBed() {
  const w = 320;
  const h = 192;
  const { px } = newCanvas(w, h);
  // Soil bed (visible top surface).
  fillEllipse(px, w, h, 160, 66, 132, 52, soilDark, 1);
  fillEllipse(px, w, h, 160, 62, 132, 52, soil, 1);
  // Vegetable rows — three bands of sprouts.
  const rows = [
    [64, 108, 128, 192, 256],
    [88, 152, 216],
    [48, 112, 176, 240, 288],
  ];
  rows.forEach((xs, ri) => {
    const ry = 30 + ri * 16;
    for (const rx of xs) {
      // Sprout tuft.
      fillEllipse(px, w, h, rx - 6, ry, 9, 7, leafDark, 0.9);
      fillEllipse(px, w, h, rx + 6, ry, 9, 7, leafDark, 0.9);
      fillEllipse(px, w, h, rx, ry - 3, 8, 8, leaf, 1);
      // Occasional bloom accent.
      const bloom = [pink, yellow, cream][(rx / 16) % 3 | 0];
      if (ri % 2 === 0) fillEllipse(px, w, h, rx, ry - 8, 4, 4, bloom, 0.95);
    }
  });
  // Wooden front frame with plank lines.
  fillRoundRect(px, w, h, 22, 84, 298, 176, 12, woodLine, 1);
  fillRoundRect(px, w, h, 22, 82, 298, 176, 12, wood, 1);
  for (const py of [112, 136, 158]) {
    fillRoundRect(px, w, h, 30, py, 290, py + 3, 1.5, woodDark, 0.55);
  }
  for (let px2 = 86; px2 < 290; px2 += 52) {
    fillRoundRect(px, w, h, px2, 92, px2 + 3, 168, 1.5, woodDark, 0.45);
  }
  // Corner post caps.
  for (const [px2, py] of [[30, 84], [290, 84]]) {
    fillRoundRect(px, w, h, px2 - 4, py - 10, px2 + 7, py + 12, 4, woodDark, 1);
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* 3. Clothesline                                                      */
/* ------------------------------------------------------------------ */
function paintClothesline() {
  const w = 288;
  const h = 224;
  const { px } = newCanvas(w, h);
  // Posts.
  for (const px2 of [34, 254]) {
    fillRoundRect(px, w, h, px2 - 5, 40, px2 + 5, 208, 5, woodLine, 1);
    fillRoundRect(px, w, h, px2 - 3, 40, px2 + 3, 208, 4, wood, 1);
    fillEllipse(px, w, h, px2, 40, 7, 5, woodDark, 1); // post cap
  }
  // Sagging line.
  for (let x = 34; x <= 254; x++) {
    const t = (x - 34) / 220;
    const y = 52 + Math.sin(t * Math.PI) * 26;
    paint(px, w, x, Math.round(y), 96, 72, 52, 1);
    paint(px, w, x, Math.round(y) + 1, 128, 96, 66, 0.9);
  }
  // Hanging laundry (shirt, dress, towel) with clothespins.
  const items = [
    { x: 92, y: 68, kind: "shirt" },
    { x: 144, y: 76, kind: "dress" },
    { x: 200, y: 70, kind: "towel" },
  ];
  for (const it of items) {
    if (it.kind === "shirt") {
      fillRoundRect(px, w, h, it.x - 22, it.y, it.x + 22, it.y + 52, 8, white, 1);
      fillRoundRect(px, w, h, it.x - 34, it.y + 6, it.x - 22, it.y + 22, 6, white, 1);
      fillRoundRect(px, w, h, it.x + 22, it.y + 6, it.x + 34, it.y + 22, 6, white, 1);
      fillRoundRect(px, w, h, it.x - 22, it.y + 40, it.x + 22, it.y + 46, 8, [216, 212, 202], 1);
    } else if (it.kind === "dress") {
      fillPoly(px, w, h, [
        [it.x - 18, it.y], [it.x + 18, it.y],
        [it.x + 12, it.y + 46], [it.x + 26, it.y + 58],
        [it.x - 26, it.y + 58], [it.x - 12, it.y + 46],
      ], pink, 1);
      fillRoundRect(px, w, h, it.x - 12, it.y + 54, it.x + 12, it.y + 60, 4, [206, 150, 164], 1);
    } else {
      fillRoundRect(px, w, h, it.x - 20, it.y, it.x + 20, it.y + 56, 8, blue, 1);
      fillRoundRect(px, w, h, it.x - 14, it.y + 10, it.x + 14, it.y + 16, 3, [140, 168, 200], 0.8);
    }
    // Clothespins.
    for (const cp of [it.x - 8, it.x + 8]) {
      fillRoundRect(px, w, h, cp - 2, it.y - 4, cp + 2, it.y + 2, 1, woodLine, 1);
    }
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* 4. Grand entrance arch (south exit gate)                            */
/* ------------------------------------------------------------------ */
function paintEntranceArch() {
  const w = 384;
  const h = 448;
  const { px } = newCanvas(w, h);
  // Stone pillar bases.
  for (const bx of [58, 262]) {
    fillRoundRect(px, w, h, bx - 4, 356, bx + 48, 432, 6, stoneDark, 1);
    fillRoundRect(px, w, h, bx, 352, bx + 44, 432, 6, stone, 1);
    // Stone banding.
    for (const by of [372, 396, 420]) {
      fillRoundRect(px, w, h, bx, by, bx + 44, by + 4, 2, stoneDark, 0.5);
    }
  }
  // Wooden uprights rising from the bases.
  for (const bx of [58, 262]) {
    fillRoundRect(px, w, h, bx - 2, 96, bx + 46, 360, 6, woodLine, 1);
    fillRoundRect(px, w, h, bx + 2, 96, bx + 42, 360, 6, wood, 1);
    for (let by = 140; by < 356; by += 44) {
      fillRoundRect(px, w, h, bx + 2, by, bx + 42, by + 3, 1.5, woodDark, 0.5);
    }
  }
  // Crossbeam with slight overhang.
  fillRoundRect(px, w, h, 38, 66, 346, 116, 10, woodLine, 1);
  fillRoundRect(px, w, h, 38, 62, 346, 116, 10, wood, 1);
  for (const [gx, gy] of [
    [80, 84], [130, 76], [180, 92], [240, 78], [300, 88], [340, 80],
  ]) {
    fillEllipse(px, w, h, gx, gy, 8, 3, woodDark, 0.25);
  }
  // Banner hanging from the beam: white field with green clover.
  fillPoly(px, w, h, [
    [150, 114], [234, 114], [240, 246], [226, 252], [192, 240], [158, 252], [144, 246],
  ], white, 1);
  // Clover emblem (four leaves + stem).
  const ccx = 192;
  const ccy = 168;
  const lr = 17;
  for (const [ox, oy] of [[-lr, -lr], [lr, -lr], [-lr, lr], [lr, lr]]) {
    fillEllipse(px, w, h, ccx + ox, ccy + oy, lr, lr, clover, 1);
  }
  fillEllipse(px, w, h, ccx, ccy, 10, 10, [140, 190, 116], 1);
  fillRoundRect(px, w, h, ccx - 3, ccy + 12, ccx + 3, ccy + 40, 2, clover, 1);
  // Lanterns hanging from the beam corners.
  for (const lx of [58, 326]) {
    fillRoundRect(px, w, h, lx - 2, 116, lx + 2, 136, 1, woodLine, 1);
    fillEllipse(px, w, h, lx, 142, 12, 10, lantern, 1);
    fillEllipse(px, w, h, lx, 142, 8, 7, [255, 240, 190], 0.9);
    fillRoundRect(px, w, h, lx - 4, 134, lx + 4, 138, 2, lanternDark, 1);
    fillRoundRect(px, w, h, lx - 4, 148, lx + 4, 152, 2, lanternDark, 1);
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* 5. Lily pads                                                        */
/* ------------------------------------------------------------------ */
function paintLilyPads() {
  const w = 192;
  const h = 96;
  const { px } = newCanvas(w, h);
  const pads = [
    { cx: 56, cy: 48, rx: 40, ry: 24, bloom: true },
    { cx: 132, cy: 40, rx: 30, ry: 18, bloom: false },
    { cx: 164, cy: 74, rx: 24, ry: 15, bloom: false },
  ];
  for (const pad of pads) {
    fillEllipse(px, w, h, pad.cx, pad.cy, pad.rx, pad.ry, [86, 132, 88], 1);
    fillEllipse(px, w, h, pad.cx, pad.cy - 2, pad.rx, pad.ry, [110, 168, 108], 1);
    // Lighter center + vein lines.
    fillEllipse(px, w, h, pad.cx, pad.cy - 2, pad.rx * 0.55, pad.ry * 0.5, [150, 200, 138], 0.9);
    for (const [vx, vy] of [[-0.6, -0.3], [0.6, -0.3], [0, -0.7]]) {
      fillEllipse(px, w, h, pad.cx + pad.rx * vx, pad.cy - 2 + pad.ry * vy, 2.5, 8, [96, 148, 96], 0.6);
    }
    // Notch — dark wedge so the pad reads as a lily pad, not a plain ellipse.
    fillPoly(px, w, h, [
      [pad.cx - pad.rx * 0.5, pad.cy],
      [pad.cx, pad.cy - pad.ry * 0.9],
      [pad.cx - pad.rx * 0.2, pad.cy - pad.ry * 0.1],
      [pad.cx - pad.rx * 0.55, pad.cy - pad.ry * 0.35],
    ], [70, 108, 76], 0.85);
    if (pad.bloom) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        fillEllipse(px, w, h, pad.cx + Math.cos(a) * 7, pad.cy - 4 + Math.sin(a) * 7, 4.5, 4.5, pink, 1);
      }
      fillEllipse(px, w, h, pad.cx, pad.cy - 4, 5, 5, yellow, 1);
    }
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */
const props = {
  "cafe-table.png": paintCafeTable(),
  "garden-bed.png": paintGardenBed(),
  "clothesline.png": paintClothesline(),
  "entrance-arch.png": paintEntranceArch(),
  "lily-pads.png": paintLilyPads(),
};

mkdirSync(outDir, { recursive: true });
for (const [name, { w, h, px }] of Object.entries(props)) {
  writeFileSync(resolve(outDir, name), encodePNG(w, h, px));
  console.log(`Wrote ${resolve(outDir, name)} (${w}x${h})`);
}