#!/usr/bin/env node
/**
 * Render the game's placeholder tileset to PNGs the local VL model can
 * review. Node has no canvas, so this mirrors the drawing in
 * src/game/TileTextures.ts — same shapes and seeded RNG at the same 2x detail
 * — but reads ALL colors/counts from the shared src/game/tilePalette.ts, so
 * the review image always matches the game and the VL auto-tuner
 * (scripts/auto-tune-tiles.mjs) can adjust the shipped look.
 *
 * Exports renderTileset(palette, outDir) for the tuner; the CLI renders the
 * default palette.
 *
 *   ⚠ Keep the shape-placement logic in sync with src/game/TileTextures.ts.
 *
 * Output: <outDir>/tiles-review.png (4x2 grid: G P F W / ~ T B X, upscaled 2x)
 * and <outDir>/tiles/<code>.png (single tiles, upscaled 4x).
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { DEFAULT_TILE_PALETTE } from "../src/game/tilePalette.ts";

const TILE_SIZE = 48; // game tile (src/game/GameConfig.ts)
const DETAIL = 2; // TileTextures renders at 2x, then downsamples
const SIZE = TILE_SIZE * DETAIL; // 96
const SCALE = 2; // grid upscale for humans

// --- seeded RNG (must match TileTextures.ts) --------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (rng, min, max) => min + rng() * (max - min);

// --- minimal RGBA rasterizer ------------------------------------------------
class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h * 4);
  }
  blend(x, y, [r, g, b, a]) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const sa = a / 255;
    this.buf[i] = Math.round(r * sa + this.buf[i] * (1 - sa));
    this.buf[i + 1] = Math.round(g * sa + this.buf[i + 1] * (1 - sa));
    this.buf[i + 2] = Math.round(b * sa + this.buf[i + 2] * (1 - sa));
    this.buf[i + 3] = Math.max(this.buf[i + 3], a);
  }
  fillRect(x, y, w, h, c) {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.h, Math.ceil(y + h)); yy++)
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.w, Math.ceil(x + w)); xx++)
        this.blend(xx, yy, c);
  }
  fillCircle(cx, cy, r, c) {
    const r2 = r * r;
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++)
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2) this.blend(xx, yy, c);
      }
  }
  fillEllipse(cx, cy, rx, ry, rot, c) {
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++)
      for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        const xr = dx * cos - dy * sin;
        const yr = dx * sin + dy * cos;
        if ((xr / rx) ** 2 + (yr / ry) ** 2 <= 1) this.blend(xx, yy, c);
      }
  }
  ring(cx, cy, r, lw, c) {
    const rOut = r + lw / 2;
    const rIn = r - lw / 2;
    for (let yy = Math.floor(cy - rOut); yy <= Math.ceil(cy + rOut); yy++)
      for (let xx = Math.floor(cx - rOut); xx <= Math.ceil(cx + rOut); xx++) {
        const d = Math.hypot(xx - cx, yy - cy);
        if (d >= rIn && d <= rOut) this.blend(xx, yy, c);
      }
  }
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];
const alpha = (c, a) => [c[0], c[1], c[2], Math.round(a * 255)];

// --- per-tile drawing (mirror of src/game/TileTextures.ts, palette-driven) --
function drawGrass(r, rng, p) {
  for (let i = 0; i < (p.darkCount ?? 64); i++) r.fillCircle(rng() * SIZE, rng() * SIZE, range(rng, 1.5, 3.5), hex(p.dark));
  for (let i = 0; i < (p.lightCount ?? 8); i++) r.fillRect(rng() * SIZE, rng() * SIZE, 2, range(rng, 5, 9), hex(p.light));
  const petal = hex("#f7f2c8");
  const core = hex("#f2d13d");
  for (let i = 0; i < 3; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    r.fillCircle(x, y, 2.6, petal);
    r.fillCircle(x, y, 1.2, core);
  }
}

function drawPath(r, rng, p) {
  for (let i = 0; i < (p.darkCount ?? 8); i++)
    r.fillEllipse(rng() * SIZE, rng() * SIZE, range(rng, 4, 9), range(rng, 3, 5.5), rng() * Math.PI, hex(p.dark));
  for (let i = 0; i < (p.lightCount ?? 8); i++)
    r.fillEllipse(rng() * SIZE, rng() * SIZE, range(rng, 4, 9), range(rng, 3, 5.5), rng() * Math.PI, hex(p.light));
  const dirt = hex(p.darkAlt ?? "#b88a52");
  for (let i = 0; i < 44; i++) r.fillRect(rng() * SIZE, rng() * SIZE, 2, 2, dirt);
}

function drawFloor(r, rng, p) {
  const plank = SIZE / 6;
  for (let row = 0; row < 6; row++) {
    const y = row * plank;
    r.fillRect(0, y + 2, SIZE, plank - 4, hex(row % 2 === 0 ? p.light : (p.lightAlt ?? p.light)));
    const joint = (row % 2 === 0 ? 22 : 40) + rng() * 8;
    const jc = hex(p.dark);
    r.fillRect(joint, y + 2, 3, plank - 4, jc);
    r.fillRect(joint + plank * 2.4 + rng() * 6, y + 2, 3, plank - 4, jc);
  }
  const nail = hex(p.darkAlt ?? "#946e42");
  for (let i = 0; i < 6; i++) r.fillCircle(rng() * SIZE, rng() * SIZE, 1.6, nail);
}

function drawWall(r, rng, p) {
  r.fillRect(0, 0, SIZE, SIZE, hex("#6f5f50"));
  const brickH = SIZE / 4;
  const brickW = SIZE / 3;
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 4; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      r.fillRect(x + 2, y + 2, brickW - 6, brickH - 4, hex(rng() < 0.5 ? p.dark : (p.darkAlt ?? p.dark)));
      r.fillRect(x + 2, y + 2, brickW - 6, 3, hex(p.light));
    }
  }
}

function drawWater(r, rng, p) {
  const wave = hex(p.dark);
  for (let i = 0; i < (p.darkCount ?? 8); i++) {
    const y = range(rng, 6, SIZE - 6);
    const phase = rng() * 20;
    const wc = alpha(wave, range(rng, 0.35, 0.65));
    const lw = range(rng, 1.5, 3);
    for (let x = 0; x <= SIZE; x += 2)
      r.fillCircle(x, y + Math.sin((x + phase) / 9) * 2.2, lw / 2, wc);
  }
  const ripple = alpha(hex(p.light), 0.85);
  for (let i = 0; i < (p.lightCount ?? 3); i++) r.ring(rng() * SIZE, rng() * SIZE, range(rng, 4, 8), 2, ripple);
}

function drawFoliage(r, rng, p, radius) {
  const count = p.darkCount ?? 14;
  for (let i = 0; i < count; i++)
    r.fillCircle(rng() * SIZE, rng() * SIZE, range(rng, radius * 0.4, radius), rng() < 0.5 ? hex(p.dark) : hex(p.light));
}

function drawFlower(r, rng, p) {
  const petal = hex(p.light);
  const core = hex(p.lightAlt ?? "#f2d13d");
  for (let i = 0; i < (p.lightCount ?? 7); i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const n = 5 + Math.floor(rng() * 3);
    for (let petalI = 0; petalI < n; petalI++) {
      const a = (petalI / n) * Math.PI * 2;
      r.fillCircle(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 3.2, petal);
    }
    r.fillCircle(x, y, 2.8, core);
  }
}

// Tile order + edge colors must match src/game/Tiles.ts (index = position).
const TILE_DEFS = [
  { code: "G", base: "#8fc98a", edge: "#77b573", draw: drawGrass },
  { code: "P", base: "#d9b07c", edge: "#c29660", draw: drawPath },
  { code: "F", base: "#d8b28a", edge: "#c19a6e", draw: drawFloor },
  { code: "W", base: "#8d7a68", edge: "#6f5f50", draw: drawWall },
  { code: "~", base: "#6fb7d9", edge: "#4f97c4", draw: drawWater },
  { code: "T", base: "#4c8f4f", edge: "#356f3a", draw: (r, rng, p) => drawFoliage(r, rng, p, 11) },
  { code: "B", base: "#5aa85e", edge: "#3d8a42", draw: (r, rng, p) => drawFoliage(r, rng, p, 9) },
  { code: "X", base: "#e28bc4", edge: "#c96aab", draw: drawFlower },
].map((t, i) => ({ ...t, index: i }));

const COLS = 4;
const ROWS = Math.ceil(TILE_DEFS.length / COLS);

function averageCenterColor(buf, w, h, margin) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = margin; y < h - margin; y++)
    for (let x = margin; x < w - margin; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] < 200) continue;
      r += buf[i];
      g += buf[i + 1];
      b += buf[i + 2];
      n++;
    }
  return n ? `#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}` : "?";
}

function renderTile(tileDef, palette) {
  const tileR = new Raster(SIZE, SIZE);
  tileR.fillRect(0, 0, SIZE, SIZE, hex(tileDef.base));
  const p = palette[tileDef.code];
  if (p) tileDef.draw(tileR, mulberry32((tileDef.index + 1) * 7919), p);
  tileR.fillRect(0, 0, SIZE, TILE_SIZE / 2, hex(tileDef.edge));
  tileR.fillRect(0, SIZE - TILE_SIZE / 2, SIZE, TILE_SIZE / 2, hex(tileDef.edge));
  return tileR;
}

function upsample(src, scale) {
  const out = new Raster(src.w * scale, src.h * scale);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      out.fillRect(x * scale, y * scale, scale, scale, [
        src.buf[i],
        src.buf[i + 1],
        src.buf[i + 2],
        src.buf[i + 3],
      ]);
    }
  return out;
}

// --- minimal PNG encoder ----------------------------------------------------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Render the tileset with a given palette into outDir. Returns per-tile
 * ground-truth center averages (for comparing against the VL's hue claims).
 */
export function renderTileset(palette, outDirUrl) {
  const dir = new URL(outDirUrl, import.meta.url);
  mkdirSync(new URL("./tiles/", dir), { recursive: true });

  const grid = new Raster(COLS * SIZE, ROWS * SIZE);
  const averages = {};
  for (const tileDef of TILE_DEFS) {
    const tileR = renderTile(tileDef, palette);
    const fx = (tileDef.index % COLS) * SIZE;
    const fy = Math.floor(tileDef.index / COLS) * SIZE;
    grid.buf.set(tileR.buf, (fy * grid.w + fx) * 4);
    averages[tileDef.code] = averageCenterColor(tileR.buf, SIZE, SIZE, TILE_SIZE / 2);
  }

  const gridBig = upsample(grid, SCALE);
  writeFileSync(new URL("./tiles-review.png", dir), encodePng(gridBig.w, gridBig.h, gridBig.buf));
  for (const tileDef of TILE_DEFS) {
    const single = new Raster(SIZE, SIZE);
    const sx = (tileDef.index % COLS) * SIZE;
    const sy = Math.floor(tileDef.index / COLS) * SIZE;
    for (let y = 0; y < SIZE; y++)
      single.buf.set(grid.buf.subarray(((sy + y) * grid.w + sx) * 4, ((sy + y) * grid.w + sx + SIZE) * 4), y * SIZE * 4);
    const big = upsample(single, SCALE * 2); // 96 -> 384px
    writeFileSync(new URL(`./tiles/${tileDef.code}.png`, dir), encodePng(big.w, big.h, big.buf));
  }
  return averages;
}

// CLI: render the current default palette (tuned file) for human review.
if (process.argv[1] && process.argv[1].endsWith("render-tiles.mjs")) {
  const averages = renderTileset(DEFAULT_TILE_PALETTE, "./");
  for (const [code, avg] of Object.entries(averages)) console.log(`  tile ${code} → center-avg ${avg}`);
  console.log("wrote tiles-review.png + 8 single-tile PNGs in scripts/tiles/");
}
