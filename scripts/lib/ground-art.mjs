/**
 * Clover Village ground surfaces — pure generation logic.
 *
 * Shared by scripts/generate-ground-assets.mjs (writes the PNGs) and the
 * ground-art regression test (pins tone + seamlessness so generator tweaks
 * can't silently drift). Everything is deterministic: fixed PRNG seeds and
 * the committed source paintings, so identical inputs yield identical bytes.
 *
 * Why these surfaces exist (see the graphics audit): the pack's land/road
 * PNGs are painterly but render flat and "blocky" in-game —
 *   - land_1 (field) is a fine painted meadow whose luminance only spans
 *     ~17/255 levels, so it reads as a dark, murky smear under the bright
 *     set-piece art. We re-light it: lift + stretch its tonal range and
 *     re-seed the painting with short grass strokes (deterministic).
 *   - road_5 (path) has baked dark blotches that repeat every tile and make
 *     the road read as a row of identical squares. We strip its low-frequency
 *     shading (blotches) and keep only the painter's sub-tile cobble grain,
 *     so consecutive tiles show near-identical fine speckle with no large
 *     feature to latch the eye onto.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG } from "./png.mjs";

export const landSource = resolve(
  dirname(fileURLToPath(import.meta.url)), "..", "..",
  "reference/assets/maps/CloverVillage/Map/PNG/land/land_1.png",
);
export const roadSource = resolve(
  dirname(fileURLToPath(import.meta.url)), "..", "..",
  "reference/assets/maps/CloverVillage/Map/PNG/road/road_5.png",
);

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
/* Shared meadow steps (base -> mottle -> strokes)                     */
/* ------------------------------------------------------------------ */

/** Re-light a painted field toward a sunlit grass tone (village meadow). */
function reLightPainting(px, w, h, { targetL, spread, l0, satFactor }) {
  const out = Buffer.alloc(w * h * 4);
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
    const s = Math.min(1, hsl.s * satFactor);
    const c = hslToRgb(hsl.h, s, l);
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Flat synthetic base at a sampled tone + fine seeded grain (valley meadow). */
function flatBaseWithGrain(w, h, { hue, sat, light, grainSeed }) {
  const out = Buffer.alloc(w * h * 4);
  const rng = mulberry32(grainSeed);
  for (let i = 0; i < w * h; i++) {
    const gl = Math.min(0.64, Math.max(0.34, light + (rng() - 0.5) * 0.03));
    const c = hslToRgb(hue, sat, gl);
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Soft large-scale sward mottling (patches ~64px), toroidal value noise. */
function applyMottling(out, w, h, { cell, seed, strength }) {
  const G = w / cell; // lattice points per axis -> indices wrap mod G
  const rng0 = mulberry32(seed);
  const lat = Array.from({ length: G }, () => Array.from({ length: G }, () => rng0()));
  const smooth = (t) => t * t * (3 - 2 * t);
  const swardDelta = (x, y) => {
    const fx = x / cell, fy = y / cell;
    const gx = Math.floor(fx), gy = Math.floor(fy);
    const u = smooth(fx - gx), v = smooth(fy - gy);
    const i0 = ((gx % G) + G) % G, j0 = ((gy % G) + G) % G;
    const i1 = (i0 + 1) % G, j1 = (j0 + 1) % G;
    const a = lat[i0][j0] * (1 - u) + lat[i1][j0] * u;
    const b = lat[i0][j1] * (1 - u) + lat[i1][j1] * u;
    return (a * (1 - v) + b * v - 0.5) * strength;
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
}

/** Re-seed the field with short grass strokes (toroidal, painterly tufts). */
function applyStrokes(out, w, h, { seed, count, light, dark }) {
  const rng = mulberry32(seed);
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
  for (let n = 0; n < count; n++) {
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
}

/* ------------------------------------------------------------------ */
/* Field: re-lit painterly meadow                                      */
/* ------------------------------------------------------------------ */
export function generateMeadow() {
  const { w, h, px } = decodePNG(landSource);
  const out = reLightPainting(px, w, h, {
    targetL: 0.47,
    spread: 1.45,
    l0: 0.317, // HSL lightness mean of the original painting
    satFactor: 0.72,
  });
  applyMottling(out, w, h, { cell: 64, seed: 0x6d07f, strength: 0.12 });
  applyStrokes(out, w, h, {
    seed: 0xc10e5e,
    count: 5600,
    light: hslToRgb(0.235, 0.52, 0.57), // sunlit blade tip green
    dark: hslToRgb(0.2, 0.5, 0.33), // shadowed under-blade green
  });
  return { w, h, px: out };
}

/**
 * Happy Valley meadow — the same authored pipeline as the village, anchored
 * in the valley pack's own palette. The pack's 56 Ground tiles are ~1.5%
 * opaque cutouts (tufts/patches), so there is no full-bleed painting to
 * re-light; instead the base starts at the sampled tone of the pack's painted
 * grass patches (hue ~93deg, summer-vivid saturation) with a fine grain for
 * painterly sub-tile variance, then the shared toroidal mottle + strokes with
 * valley-specific seeds so the two zones share the language without cloning
 * the pattern.
 */
export function generateValleyMeadow() {
  const w = 256;
  const h = 256;
  const out = flatBaseWithGrain(w, h, {
    hue: 0.258, // ~93deg — mean of the pack's painted grass-patch hues
    sat: 0.43, // summer-vivid after the shared 0.72 tempering (0.60 source)
    light: 0.47, // the village target lightness
    grainSeed: 0xa11c3,
  });
  applyMottling(out, w, h, { cell: 64, seed: 0xb0a5e5, strength: 0.12 });
  applyStrokes(out, w, h, {
    seed: 0x1e5c0de,
    count: 5600,
    light: hslToRgb(0.235, 0.52, 0.57),
    dark: hslToRgb(0.2, 0.5, 0.33),
  });
  return { w, h, px: out };
}

/* ------------------------------------------------------------------ */
/* Road: packed-earth texture with sub-tile grain only                 */
/* ------------------------------------------------------------------ */
function generateRoadFrom(src, fleckSeed) {
  const { w, h, px } = decodePNG(src); // 64x64
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
  const rng = mulberry32(fleckSeed);
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

/** Clover Village road (painter's cobble grain, blotches stripped). */
export function generateRoad() {
  return generateRoadFrom(roadSource, 0x70ad5e);
}

/** Happy Valley path — same packed-earth language, own fleck seeding. */
export function generateValleyPath() {
  return generateRoadFrom(roadSource, 0xf1ee5e);
}

/* ------------------------------------------------------------------ */
/* Plaza: soft gray-stone cobble for Courier Square                    */
/* ------------------------------------------------------------------ */
/**
 * Paved plaza for Courier Square — the reference look is a cobblestone
 * plaza in front of the Post Office (gray stone, distinct from the warm
 * earth paths). Seeded 8x8 jittered stone cells on a toroidal grid with
 * soft edges, per-stone tone variation, and occasional moss-tinted stones;
 * wrapped so the 64px tile tiles seamlessly like the road.
 */
export function generatePlaza() {
  const N = 64;
  const CELL = 8;
  const G = N / CELL; // 8 rows/cols of stones
  const out = Buffer.alloc(N * N * 4);
  const rng = mulberry32(0x9a1f5e);
  const stones = Array.from({ length: G }, () =>
    Array.from({ length: G }, () => ({
      jx: (rng() - 0.5) * 1.2,
      jy: (rng() - 0.5) * 1.2,
      dl: (rng() - 0.5) * 0.06,
      moss: rng() < 0.08,
    })),
  );
  const grout = hslToRgb(0.58, 0.1, 0.44);
  const wrap = (v) => v - Math.round(v / N) * N;
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Grid bond of rounded-rect pavers with per-stone jitter. All indexing
      // wraps mod G (cell) / mod N (pixel), so the 64px tile is toroidally
      // seamless — a half-cell running bond cannot wrap on an even tile, so
      // the jitter carries the natural feel instead.
      const row = Math.floor(y / CELL);
      const col = Math.floor(x / CELL);
      let best = Infinity, bi = 0, bj = 0;
      for (let cy = -1; cy <= 1; cy++) {
        for (let cx = -1; cx <= 1; cx++) {
          const gy = (((row + cy) % G) + G) % G;
          const gx = (((col + cx) % G) + G) % G;
          const s = stones[gy][gx];
          const cxp = wrap(gx * CELL + CELL / 2 + s.jx);
          const cyp = wrap(gy * CELL + CELL / 2 + s.jy);
          const dx = Math.max(Math.abs(wrap(x - cxp)) - 3.2, 0);
          const dy = Math.max(Math.abs(wrap(y - cyp)) - 3.2, 0);
          const d = Math.sqrt(dx * dx + dy * dy) - 0.7;
          if (d < best) {
            best = d;
            bi = gx;
            bj = gy;
          }
        }
      }
      const s = stones[bj][bi];
      const cxp = wrap(bi * CELL + CELL / 2 + s.jx);
      const cyp = wrap(bj * CELL + CELL / 2 + s.jy);
      const dx = Math.max(Math.abs(wrap(x - cxp)) - 3.2, 0);
      const dy = Math.max(Math.abs(wrap(y - cyp)) - 3.2, 0);
      const d = Math.sqrt(dx * dx + dy * dy) - 0.7;
      const cov = 1 - smooth(Math.min(1, Math.max(0, d / 0.8)));
      let c;
      if (s.moss) c = hslToRgb(0.22, 0.2, 0.62 + s.dl);
      else if ((bi + bj) % 5 === 0) c = hslToRgb(0.58, 0.07, 0.7 + s.dl); // brighter accent stones
      else c = hslToRgb(0.56, 0.06, 0.66 + s.dl);
      const i = (y * N + x) * 4;
      out[i] = Math.round(c.r * cov + grout.r * (1 - cov));
      out[i + 1] = Math.round(c.g * cov + grout.g * (1 - cov));
      out[i + 2] = Math.round(c.b * cov + grout.b * (1 - cov));
      out[i + 3] = 255;
    }
  }
  return { w: N, h: N, px: out };
}

/* ------------------------------------------------------------------ */
/* Stats: tone + seam metrics (also used by the regression test)       */
/* ------------------------------------------------------------------ */
export function computeStats(w, h, px) {
  let lumMin = 1, lumMax = 0, lumSum = 0, dark = 0, n = 0;
  let rSum = 0, gSum = 0, bSum = 0, sSum = 0, lSum = 0, hSum = 0;
  let edgeLR = 0, edgeTB = 0, internal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumSum += l; n++;
      if (l < lumMin) lumMin = l;
      if (l > lumMax) lumMax = l;
      if (l < 0.4) dark++;
      rSum += r; gSum += g; bSum += b;
      const hsl = rgbToHsl(r, g, b);
      sSum += hsl.s; lSum += hsl.l; hSum += hsl.h;
      if (x < 4) {
        const j = (y * w + (w - 1 - x)) * 4;
        edgeLR += Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]);
      }
      if (y < 4) {
        const j = ((h - 1 - y) * w + x) * 4;
        edgeTB += Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]);
      }
      if (x < w - 1) {
        const j = i + 4;
        internal += Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]);
      }
    }
  }
  return {
    lumMin, lumMax,
    lumMean: lumSum / n,
    darkFraction: dark / n,
    edgeLR: edgeLR / (h * 4 * 3),
    edgeTB: edgeTB / (w * 4 * 3),
    internal: internal / (w * h * 3),
    avgRGB: { r: rSum / n, g: gSum / n, b: bSum / n },
    avgHsl: { h: hSum / n, s: sSum / n, l: lSum / n },
  };
}

export function summarize(label, w, h, px) {
  const s = computeStats(w, h, px);
  console.log(
    `${label}: lum ${s.lumMin.toFixed(3)}..${s.lumMax.toFixed(3)} mean ${s.lumMean.toFixed(3)} ` +
    `dark(<.4)=${(s.darkFraction * 100).toFixed(1)}% ` +
    `edgeLR ${s.edgeLR.toFixed(2)} edgeTB ${s.edgeTB.toFixed(2)} internal ${s.internal.toFixed(2)}`,
  );
}