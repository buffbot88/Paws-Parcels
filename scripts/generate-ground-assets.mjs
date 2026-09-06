#!/usr/bin/env node
/**
 * Generate the two authored ground surfaces for Clover Village.
 *
 * Why these exist (see the graphics audit): the pack's land/road PNGs are
 * painterly but render flat and "blocky" in-game —
 *   - land_1 (field) is a fine painted meadow whose luminance only spans
 *     ~17/255 levels, so it reads as a dark, murky smear under the bright
 *     set-piece art. We re-light it: lift + stretch its tonal range and
 *     re-seed the painting with short grass strokes (deterministic).
 *   - road_5 (path) has baked dark blotches that repeat every tile and make
 *     the road read as a row of identical squares. We strip its low-frequency
 *     shading (blotches) and keep only the painter's sub-tile cobble grain,
 *     so consecutive tiles show near-identical fine speckle with no large
 *     feature to latch the eye onto.
 *
 * Output is written next to the other new-pack art so the asset inventory
 * (scripts/inventory-assets.mjs) can mark it runtime-used.
 *
 * Run: node scripts/generate-ground-assets.mjs
 * Writes: reference/assets/new/CloverVillage/Ground/meadow.png
 *         reference/assets/new/CloverVillage/Ground/road.png
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const landSource = resolve(root, "reference/assets/maps/CloverVillage/Map/PNG/land/land_1.png");
const roadSource = resolve(root, "reference/assets/maps/CloverVillage/Map/PNG/road/road_5.png");
const outDir = resolve(root, "reference/assets/new/CloverValley/Ground");

/* ------------------------------------------------------------------ */
/* Minimal PNG decode (8-bit RGBA/RGB, non-interlaced)                 */
/* ------------------------------------------------------------------ */
function decodePNG(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${path}: unsupported bit depth ${bitDepth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * ch;
  const px = Buffer.alloc(w * h * 4);
  let rp = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(a, b, c)) & 255;
      out[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      if (colorType === 6) {
        px[(y * w + x) * 4] = out[x * 4];
        px[(y * w + x) * 4 + 1] = out[x * 4 + 1];
        px[(y * w + x) * 4 + 2] = out[x * 4 + 2];
        px[(y * w + x) * 4 + 3] = out[x * 4 + 3];
      } else {
        px[(y * w + x) * 4] = out[x * 3];
        px[(y * w + x) * 4 + 1] = out[x * 3 + 1];
        px[(y * w + x) * 4 + 2] = out[x * 3 + 2];
        px[(y * w + x) * 4 + 3] = 255;
      }
    }
    prev.set(out);
  }
  return { w, h, px };
}

/* ------------------------------------------------------------------ */
/* Minimal PNG encode (8-bit RGBA, filter 0, non-interlaced)           */
/* ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Seeded PRNG (byte-stable output between runs)                       */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Color helpers                                                       */
/* ------------------------------------------------------------------ */
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/* ------------------------------------------------------------------ */
/* Field: re-lit painterly meadow                                      */
/* ------------------------------------------------------------------ */
function generateMeadow() {
  const { w, h, px } = decodePNG(landSource);
  const out = Buffer.alloc(w * h * 4);
  // Re-light: pull the meadow's mean up toward a fresh, sunlit grass tone
  // (HSL-lightness, not luma) and widen its tonal spread so blades and
  // under-shadows read instead of smearing into one dark tone.
  const targetL = 0.47;
  const spread = 1.45;
  const l0 = 0.317; // HSL lightness mean of the original painting
  const remap = (l) => targetL + (l - l0) * spread;

  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const hsl = rgbToHsl(r, g, b);
    let l = remap(hsl.l);
    l = Math.min(0.6, Math.max(0.38, l));
    // Tempered saturation: the pack's painted style is soft/pastel (sage
    // fields, cream papers, muted warm woods). Full-chroma green overreaches;
    // scale the original painting's own saturation down so the meadow reads
    // painted rather than synthetic.
    const s = Math.min(1, hsl.s * 0.72);
    const c = hslToRgb(hsl.h, s, l);
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 255;
  }

  // Soft large-scale sward mottling (patches ~64px). Built on a 4x4 toroidal
  // value-noise lattice so the 256px tile wraps seamlessly when tiled.
  const CELL = 64;
  const G = w / CELL; // 4 lattice points per axis -> lattice indices wrap mod G
  const rng0 = mulberry32(0x6d07f);
  const lat = Array.from({ length: G }, () => Array.from({ length: G }, () => rng0()));
  const smooth = (t) => t * t * (3 - 2 * t);
  const swardDelta = (x, y) => {
    const fx = x / CELL, fy = y / CELL;
    const gx = Math.floor(fx), gy = Math.floor(fy);
    const u = smooth(fx - gx), v = smooth(fy - gy);
    const i0 = ((gx % G) + G) % G, j0 = ((gy % G) + G) % G;
    const i1 = (i0 + 1) % G, j1 = (j0 + 1) % G;
    const a = lat[i0][j0] * (1 - u) + lat[i1][j0] * u;
    const b = lat[i0][j1] * (1 - u) + lat[i1][j1] * u;
    return (a * (1 - v) + b * v - 0.5) * 0.12; // +/-0.06 HSL lightness
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hsl = rgbToHsl(out[i], out[i + 1], out[i + 2]);
      const l = Math.min(0.64, Math.max(0.34, hsl.l + swardDelta(x, y)));
      const c = hslToRgb(hsl.h, hsl.s, l);
      out[i] = c.r;
      out[i + 1] = c.g;
      out[i + 2] = c.b;
    }
  }

  // Re-seed the field with short grass strokes so the meadow has painterly
  // tuft structure rather than a smeared tone. Strokes wrap toroidally so
  // the tile stays seamless.
  const rng = mulberry32(0xc10e5e);
  const stroke = (cx, cy, len, dx, dy, dr, dg, db, alpha) => {
    for (let t = 0; t < len; t++) {
      const x = (Math.floor(cx + dx * t) + w) % w;
      const y = (Math.floor(cy + dy * t) + h) % h;
      const i = (y * w + x) * 4;
      const a = alpha * (1 - t / len);
      out[i] = clamp255(out[i] * (1 - a) + (out[i] + dr) * a);
      out[i + 1] = clamp255(out[i + 1] * (1 - a) + (out[i + 1] + dg) * a);
      out[i + 2] = clamp255(out[i + 2] * (1 - a) + (out[i + 2] + db) * a);
    }
  };
  const light = hslToRgb(0.235, 0.52, 0.57); // sunlit blade tip green
  const dark = hslToRgb(0.2, 0.5, 0.33); // shadowed under-blade green
  for (let n = 0; n < 5600; n++) {
    const x = rng() * w;
    const y = rng() * h;
    const ang = rng() * Math.PI * 2;
    const len = 3 + rng() * 5;
    const lightBlade = rng() < 0.55;
    const c = lightBlade ? light : dark;
    const sign = lightBlade ? 1 : -1;
    stroke(
      x, y, len, Math.cos(ang) * 1.6, Math.sin(ang) * 1.6,
      sign * (10 + rng() * 10), sign * (16 + rng() * 10), sign * (2 + rng() * 4),
      0.16 + rng() * 0.2,
    );
  }
  return { w, h, px: out };
}

/* ------------------------------------------------------------------ */
/* Road: packed-earth texture with sub-tile grain only                 */
/* ------------------------------------------------------------------ */
function generateRoad() {
  const { w, h, px } = decodePNG(roadSource); // 64x64
  const N = w;
  const out = Buffer.alloc(N * N * 4);

  // Per-channel tile mean (the painter's warm earth tone).
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < N * N; i++) {
    mr += px[i * 4]; mg += px[i * 4 + 1]; mb += px[i * 4 + 2];
  }
  mr /= N * N; mg /= N * N; mb /= N * N;

  // Local mean via separable box blur (radius 5) — captures the baked
  // blotches and any larger shading, leaves the cobble grain as detail.
  const boxBlur = (src, radius) => {
    const dst = new Float32Array(N * N * 3);
    const tmp = new Float32Array(N * N * 3);
    const r = Math.min(radius, N - 1);
    for (let y = 0; y < N; y++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const x = (k + N) % N;
        sr += src[(y * N + x) * 4];
        sg += src[(y * N + x) * 4 + 1];
        sb += src[(y * N + x) * 4 + 2];
      }
      for (let x = 0; x < N; x++) {
        tmp[(y * N + x) * 3] = sr / (2 * r + 1);
        tmp[(y * N + x) * 3 + 1] = sg / (2 * r + 1);
        tmp[(y * N + x) * 3 + 2] = sb / (2 * r + 1);
        const xOut = (x + r + 1) % N;
        const xIn = (x - r + N) % N;
        sr += src[(y * N + xOut) * 4] - src[(y * N + xIn) * 4];
        sg += src[(y * N + xOut) * 4 + 1] - src[(y * N + xIn) * 4 + 1];
        sb += src[(y * N + xOut) * 4 + 2] - src[(y * N + xIn) * 4 + 2];
      }
    }
    for (let x = 0; x < N; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const y = (k + N) % N;
        sr += tmp[(y * N + x) * 3];
        sg += tmp[(y * N + x) * 3 + 1];
        sb += tmp[(y * N + x) * 3 + 2];
      }
      for (let y = 0; y < N; y++) {
        dst[(y * N + x) * 3] = sr / (2 * r + 1);
        dst[(y * N + x) * 3 + 1] = sg / (2 * r + 1);
        dst[(y * N + x) * 3 + 2] = sb / (2 * r + 1);
        const yOut = (y + r + 1) % N;
        const yIn = (y - r + N) % N;
        sr += tmp[(yOut * N + x) * 3] - tmp[(yIn * N + x) * 3];
        sg += tmp[(yOut * N + x) * 3 + 1] - tmp[(yIn * N + x) * 3 + 1];
        sb += tmp[(yOut * N + x) * 3 + 2] - tmp[(yIn * N + x) * 3 + 2];
      }
    }
    return dst;
  };

  const low = boxBlur(px, 5);
  for (let i = 0; i < N * N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const lr = low[i * 3], lg = low[i * 3 + 1], lb = low[i * 3 + 2];
    // Replace low-frequency shading with the tile mean; keep 92% of the
    // painter's high-frequency cobble grain so the road still has texture.
    const fr = r - lr, fg = g - lg, fb = b - lb;
    out[i * 4] = clamp255(mr + fr * 0.92);
    out[i * 4 + 1] = clamp255(mg + fg * 0.92);
    out[i * 4 + 2] = clamp255(mb + fb * 0.92);
    out[i * 4 + 3] = 255;
  }

  // A few deterministic pebble-sized darker flecks for scale variety; kept
  // sub-3px so no per-tile feature can re-emerge at 48px display.
  const rng = mulberry32(0x70ad5e);
  for (let n = 0; n < 260; n++) {
    const x = (rng() * N) | 0;
    const y = (rng() * N) | 0;
    const i = (y * N + x) * 4;
    const k = 0.5 + rng() * 0.4;
    out[i] = clamp255(out[i] * (1 - k * 0.25));
    out[i + 1] = clamp255(out[i + 1] * (1 - k * 0.22));
    out[i + 2] = clamp255(out[i + 2] * (1 - k * 0.2));
  }
  return { w: N, h: N, px: out };
}

function summarize(label, w, h, px) {
  let min = 1, max = 0, sum = 0, dark = 0, n = 0;
  let edgeLr = 0, edgeTb = 0, internal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      sum += l; n++;
      if (l < min) min = l;
      if (l > max) max = l;
      if (l < 0.4) dark++;
      if (x < 4) {
        const j = (y * w + (w - 1 - x)) * 4;
        edgeLr += Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]);
      }
      if (y < 4) {
        const j = ((h - 1 - y) * w + x) * 4;
        edgeTb += Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]);
      }
      if (x < w - 1) {
        const j = i + 4;
        internal += Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]);
      }
    }
  }
  console.log(
    `${label}: lum ${min.toFixed(3)}..${max.toFixed(3)} mean ${(sum / n).toFixed(3)} ` +
    `dark(<.4)=${(dark / n * 100).toFixed(1)}% ` +
    `edgeLR ${(edgeLr / (h * 4 * 3)).toFixed(2)} edgeTB ${(edgeTb / (w * 4 * 3)).toFixed(2)} internal ${(internal / (w * h * 3)).toFixed(2)}`,
  );
}

/* ------------------------------------------------------------------ */
/* Write outputs                                                       */
/* ------------------------------------------------------------------ */
const meadow = generateMeadow();
const road = generateRoad();
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "meadow.png"), encodePNG(meadow.w, meadow.h, meadow.px));
writeFileSync(resolve(outDir, "road.png"), encodePNG(road.w, road.h, road.px));
console.log(`Wrote ${resolve(outDir, "meadow.png")} (${meadow.w}x${meadow.h})`);
console.log(`Wrote ${resolve(outDir, "road.png")} (${road.w}x${road.h})`);

// Before/after sanity numbers for the report.
const orig = decodePNG(landSource);
const origRoad = decodePNG(roadSource);
summarize("land_1 (before)  ", orig.w, orig.h, orig.px);
summarize("meadow (after)   ", meadow.w, meadow.h, meadow.px);
summarize("road_5 (before)  ", origRoad.w, origRoad.h, origRoad.px);
summarize("road (after)     ", road.w, road.h, road.px);
