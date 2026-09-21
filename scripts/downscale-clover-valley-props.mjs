#!/usr/bin/env node
/**
 * Downscale the new CloverValley prop art to ~4x its largest rendered size.
 *
 * Why (see the graphics audit): the pack's PNGs ship at 1133-1536px but render
 * at 40-170px, so every prop minifies 15-20:1 with a single bilinear GPU step
 * (no mipmaps possible — NPOT art on WebGL1). At those ratios the painter's
 * detail averages into mush. This script resizes each texture so its native
 * size lands at 4x its largest WORLD-rendered size (the village camera zooms
 * to 0.8, so that is ~5x its on-screen size — conservative against the rule),
 * then multiplies the matching placement scales by the inverse factor so every
 * piece renders at exactly the same world size as before. The quest-items
 * sheet's named frames (CLOVER_VILLAGE_QUEST_ITEM_FRAMES, source-pixel rects)
 * are scaled with the sheet.
 *
 * Everything is derived from the live placement data — no hardcoded factors.
 * The script is idempotent: a second run finds the rendered sizes unchanged
 * and recomputes F ~ 1, leaving files and scales untouched (modulo rounding).
 *
 * ## Gating (visual Pass 3)
 *
 * This script and hand-tuned composition are in direct tension: it derives its
 * factors FROM the placements and then rewrites the placements' `scale:` values
 * by line index. A run after a deliberate scale change would silently undo it —
 * which is exactly what raising the ponds, bridges and flower fronts does.
 * So a bare run is now a DRY RUN and says what it would do, and it refuses to
 * upscale art whose rendered size has grown:
 *
 *   node scripts/downscale-clover-valley-props.mjs                  # report only
 *   node scripts/downscale-clover-valley-props.mjs --write          # apply
 *   ... --write --allow-upscale                                     # reviewed growth
 *
 * Writes (with --write): the PNGs in place under
 * reference/assets/new/CloverValley/, and scale values + quest frame rects in
 * src/game/cloverVillagePlacements.ts. After that, refresh the inventory bytes
 * with `npm run assets:inventory`, and re-run `npm test` — the prop-sizing audit
 * checks that the rewrite left every rendered height inside its band.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./lib/png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const placementsPath = resolve(root, "src/game/cloverVillagePlacements.ts");

const argv = process.argv.slice(2);
/** Apply the resizes and the scale rewrites. Without this the run only reports. */
const WRITE = argv.includes("--write");
/** Permit re-encoding art to a LARGER source, i.e. a reviewed scale increase. */
const ALLOW_UPSCALE = argv.includes("--allow-upscale");
for (const flag of argv) {
  if (flag !== "--write" && flag !== "--allow-upscale") {
    console.error(`Unknown argument ${flag}. Use --write and/or --allow-upscale.`);
    process.exit(2);
  }
}

/**
 * New-pack texture keys to downscale, with their source file. Mirrors the
 * `sourceAssets` globs in src/game/cloverVillageAssets.ts (ground textures
 * excluded — they are already small and authored by generate-ground-assets.mjs;
 * route-clutter.png is descoped reference-only, never wired to a key).
 */
const PACK = {
  postOfficeSign: "reference/assets/new/CloverValley/Buildings/post-office-sign.png",
  parcels: "reference/assets/new/CloverValley/Buildings/parcels.png",
  courierBanner: "reference/assets/new/CloverValley/Buildings/courier-banner.png",
  cafeSign: "reference/assets/new/CloverValley/Buildings/cafe-sign.png",
  cafeFront: "reference/assets/new/CloverValley/Buildings/cafe-front.png",
  researchSign: "reference/assets/new/CloverValley/Buildings/research-shop-sign.png",
  researchTable: "reference/assets/new/CloverValley/Buildings/research-table.png",
  floristSign: "reference/assets/new/CloverValley/Buildings/florist-sign.png",
  flowerFront: "reference/assets/new/CloverValley/Buildings/flower-front.png",
  gardenProp: "reference/assets/new/CloverValley/Buildings/garden-prop.png",
  hollowOak: "reference/assets/new/CloverValley/Buildings/hollow-oak.png",
  rabbitBurrow: "reference/assets/new/CloverValley/Props/rabbit-burrow.png",
  bench: "reference/assets/new/CloverValley/Props/bench.png",
  bridge: "reference/assets/new/CloverValley/Props/bridge.png",
  lampPost: "reference/assets/new/CloverValley/Props/lamp-post.png",
  mailbox: "reference/assets/new/CloverValley/Props/mailbox.png",
  picnic: "reference/assets/new/CloverValley/Props/picnic-setup.png",
  pondArea: "reference/assets/new/CloverValley/Props/pond-area.png",
  questItems: "reference/assets/new/CloverValley/Props/quest-items.png",
  questItemsAlt: "reference/assets/new/CloverValley/Props/quest-items.2.png",
  fenceStraight: "reference/assets/new/CloverValley/Props/fence/fence-straight.png",
  fenceLongStraight: "reference/assets/new/CloverValley/Props/fence/fence-long-straight.png",
  fenceCorner: "reference/assets/new/CloverValley/Props/fence/fence-corner.png",
  fenceAngleLeft: "reference/assets/new/CloverValley/Props/fence/fence-angle-left.png",
  fenceAngleRight: "reference/assets/new/CloverValley/Props/fence/fence-angle-right.png",
  fencePost: "reference/assets/new/CloverValley/Props/fence/fence-post.png",
  fencePostBroken: "reference/assets/new/CloverValley/Props/fence/fence-post-broken.png",
  fenceShortStraight: "reference/assets/new/CloverValley/Props/fence/fence-short-straight.png",
  fenceGate: "reference/assets/new/CloverValley/Props/fence/fence-gate.png",
};

const QUEST_FRAME_NAMES = ["goldenAcorn", "letterOpener", "moonNotebook", "polishedPebble"];
const MAX_SOURCE_PX = 4; // rule: native size = 4x largest rendered size
const MIN_MAX_AXIS = 128; // floor so no texture (or sheet) becomes a sliver

/* ------------------------------------------------------------------ */
/* Native size from a PNG header                                       */
/* ------------------------------------------------------------------ */
function pngDims(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ */
/* Alpha-weighted separable Lanczos-3 resize (good for minification)   */
/* ------------------------------------------------------------------ */
function lanczos(t, a) {
  if (t === 0) return 1;
  const ab = Math.abs(t);
  if (ab >= a) return 0;
  const p = Math.PI * t;
  return (a * Math.sin(p) * Math.sin(p / a)) / (p * p);
}

function resampleRGBA(px, sw, sh, dw, dh) {
  const a = 3;
  const sx = sw / dw;
  const sy = sh / dh;
  // Horizontal pass: (dw x sh), accumulating r*wa, g*wa, b*wa, wa, w.
  const acc = new Float64Array(dw * sh * 4);
  const wsum = new Float64Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const sOff = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const cx = (x + 0.5) * sx;
      const dOff = (y * dw + x) * 4;
      let wa = 0, wAll = 0, r = 0, g = 0, b = 0;
      for (let i = Math.floor(cx - a * sx); i <= Math.ceil(cx + a * sx); i++) {
        const w = lanczos((cx - (i + 0.5)) / sx, a);
        if (w === 0) continue;
        const si = Math.min(Math.max(i, 0), sw - 1) * 4;
        const al = px[sOff + si + 3] / 255;
        const wA = w * al;
        wa += wA;
        wAll += w;
        r += wA * px[sOff + si];
        g += wA * px[sOff + si + 1];
        b += wA * px[sOff + si + 2];
      }
      acc[dOff] = r;
      acc[dOff + 1] = g;
      acc[dOff + 2] = b;
      acc[dOff + 3] = wa;
      wsum[y * dw + x] = wAll;
    }
  }
  // Vertical pass: (dw x dh), reading horizontal output.
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const cy = (y + 0.5) * sy;
    for (let x = 0; x < dw; x++) {
      let wa = 0, wAll = 0, r = 0, g = 0, b = 0;
      for (let j = Math.floor(cy - a * sy); j <= Math.ceil(cy + a * sy); j++) {
        const w = lanczos((cy - (j + 0.5)) / sy, a);
        if (w === 0) continue;
        const sj = Math.min(Math.max(j, 0), sh - 1);
        const sOff = (sj * dw + x) * 4;
        const wA = w * acc[sOff + 3];
        wa += wA;
        wAll += w;
        r += wA * acc[sOff];
        g += wA * acc[sOff + 1];
        b += wA * acc[sOff + 2];
      }
      const dOff = (y * dw + x) * 4;
      const alpha = wAll > 0 ? wa / wAll : 0;
      if (wa > 0) {
        out[dOff] = r / wa;
        out[dOff + 1] = g / wa;
        out[dOff + 2] = b / wa;
      }
      out[dOff + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Parse placement data (scales per key, quest frame rects)            */
/* ------------------------------------------------------------------ */
const placementsSrc = readFileSync(placementsPath, "utf8");
const lines = placementsSrc.split("\n");

/** key -> list of { idx, frame, scale } for placement lines using a pack texture */
const entryScales = new Map();
lines.forEach((line, idx) => {
  const mKey = line.match(/texture: CloverVillageTextureKeys\.(\w+)/);
  const mScale = line.match(/scale: ([\d.]+)/);
  if (mKey && mScale && PACK[mKey[1]]) {
    if (!entryScales.has(mKey[1])) entryScales.set(mKey[1], []);
    const mFrame = line.match(/frame: "(\w+)"/);
    entryScales.get(mKey[1]).push({ idx, frame: mFrame ? mFrame[1] : null, scale: parseFloat(mScale[1]) });
  }
});

/** questItems sheet frame rects (source pixels) -> { idx, w, h, dw, dh } */
const questFrames = [];
lines.forEach((line, idx) => {
  const m = line.match(
    /(goldenAcorn|letterOpener|moonNotebook|polishedPebble): \{ x: (\d+), y: (\d+), width: (\d+), height: (\d+) \}/,
  );
  if (m) questFrames.push({ idx, lineName: m[1], w: +m[2], h: +m[3], dw: +m[4], dh: +m[5] });
});

/* ------------------------------------------------------------------ */
/* Per-key factor: F = newMax / maxNative, newMax = clamp(4*maxRendered) */
/* ------------------------------------------------------------------ */
const factors = new Map(); // key -> { F, nativeMax, newMax, newW, newH, maxRendered }
for (const [key, file] of Object.entries(PACK)) {
  const abs = resolve(root, file);
  const { w, h } = pngDims(abs);
  const nativeMax = Math.max(w, h);
  const entries = entryScales.get(key) ?? [];
  let maxRendered = 0;
  if (key === "questItems") {
    // Frames are cut from the sheet; rendered size uses each frame's dims.
    for (const e of entries) {
      const fr = questFrames.find((f) => f.lineName === e.frame);
      if (!fr) throw new Error(`no frame rect for questItems frame "${e.frame}"`);
      maxRendered = Math.max(maxRendered, Math.max(fr.dw, fr.dh) * e.scale);
    }
  } else {
    for (const e of entries) maxRendered = Math.max(maxRendered, nativeMax * e.scale);
  }
  if (maxRendered === 0) throw new Error(`no placement scales found for ${key}`);
  const newMax = Math.max(Math.round((MAX_SOURCE_PX * maxRendered) / 2) * 2, MIN_MAX_AXIS);
  const F = newMax / nativeMax;
  factors.set(key, {
    F,
    nativeMax,
    newMax,
    newW: Math.round(w * F),
    newH: Math.round(h * F),
    maxRendered,
  });
}

/* ------------------------------------------------------------------ */
/* Verify: every placement keeps its rendered size within 1.5px        */
/* ------------------------------------------------------------------ */
const qF = factors.get("questItems").F;

// Upscaling is the tell-tale of a placement whose rendered size grew since the
// art was last cut: the script would re-encode bigger art to keep the world size
// identical, i.e. spend bytes to undo a deliberate change. Refuse unless asked.
const grown = [...factors.entries()].filter(([, f]) => f.F > 1.02);
if (grown.length > 0 && !ALLOW_UPSCALE) {
  console.error(
    [
      "Refusing to upscale art. These props now render larger than when they were last cut:",
      ...grown.map(
        ([key, f]) =>
          `  ${key}: F=${f.F.toFixed(3)} (${f.nativeMax}px native, largest rendered ${f.maxRendered.toFixed(1)}px)`,
      ),
      "A hand-tuned scale increase is already satisfied at the current art size.",
      "Re-run with --allow-upscale only after deciding the art itself should grow.",
    ].join("\n"),
  );
  process.exit(1);
}

for (const [key, entries] of entryScales) {
  const f = factors.get(key);
  const errs = [];
  for (const e of entries) {
    const newScale = parseFloat((e.scale / f.F).toPrecision(4));
    const before = f.nativeMax * e.scale;
    const after = f.newMax * newScale;
    if (Math.abs(before - after) > 1.5) errs.push(`${e.scale} -> ${newScale} (${before.toFixed(2)} -> ${after.toFixed(2)})`);
  }
  if (errs.length) throw new Error(`rendered-size drift for ${key}: ${errs.join("; ")}`);
}
for (const fr of questFrames) {
  const nx = Math.round(fr.w * qF);
  const ny = Math.round(fr.h * qF);
  const nw = Math.round(fr.dw * qF);
  const nh = Math.round(fr.dh * qF);
  const { newW, newH } = factors.get("questItems");
  if (nx + nw > newW || ny + nh > newH) throw new Error(`quest frame ${fr.line.trim()} exceeds ${newW}x${newH}`);
}

/* ------------------------------------------------------------------ */
/* Resize the PNGs in place                                            */
/* ------------------------------------------------------------------ */
let bytesBefore = 0;
let bytesAfter = 0;
const report = [];
for (const [key, file] of Object.entries(PACK)) {
  const abs = resolve(root, file);
  const { w, h } = pngDims(abs);
  const { newW, newH, F, maxRendered } = factors.get(key);
  const before = readFileSync(abs).length;
  if (newW === w && newH === h) {
    report.push(`${key.padEnd(16)} ${w}x${h} (unchanged)`);
    continue;
  }
  const { px } = decodePNG(abs);
  const out = resampleRGBA(px, w, h, newW, newH);
  const encoded = encodePNG(newW, newH, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  if (WRITE) writeFileSync(abs, encoded);
  const after = WRITE ? readFileSync(abs).length : encoded.length;
  bytesBefore += before;
  bytesAfter += after;
  const minBefore = (Math.max(w, h) / maxRendered).toFixed(1);
  const minAfter = (Math.max(newW, newH) / maxRendered).toFixed(1);
  report.push(
    `${key.padEnd(16)} ${String(w).padStart(4)}x${String(h).padStart(4)} -> ${String(newW).padStart(4)}x${String(newH).padStart(4)}  F=${F.toFixed(3)}  minify ${minBefore}:1 -> ${minAfter}:1`,
  );
}
console.log(report.join("\n"));
if (bytesBefore === 0) {
  console.log("\nNothing to resize: every prop already matches the 4x rule.");
  process.exit(0);
}
console.log(`\nFile bytes: ${(bytesBefore / 1024).toFixed(0)}KB -> ${(bytesAfter / 1024).toFixed(0)}KB (${(100 - (100 * bytesAfter) / bytesBefore).toFixed(0)}% smaller)`);
if (!WRITE) {
  console.log(
    [
      "",
      "DRY RUN — no files written.",
      "This run would also rewrite `scale:` values in src/game/cloverVillagePlacements.ts",
      "by line index, including hand-tuned composition. Review the table above, then",
      "re-run with --write, and afterwards `npm test` (the prop-sizing audit re-checks",
      "every rendered height) plus `npm run assets:inventory`.",
    ].join("\n"),
  );
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Rewrite placement scales + quest frame rects in the TS (by line idx) */
/* ------------------------------------------------------------------ */
const rewritten = new Map(); // line idx -> new line text
for (const [key, entries] of entryScales) {
  const F = factors.get(key).F;
  for (const e of entries) {
    const ns = parseFloat((e.scale / F).toPrecision(4));
    rewritten.set(e.idx, lines[e.idx].replace(/scale: [\d.]+/, `scale: ${ns}`));
  }
}
for (const fr of questFrames) {
  const nx = Math.round(fr.w * qF);
  const ny = Math.round(fr.h * qF);
  const nw = Math.round(fr.dw * qF);
  const nh = Math.round(fr.dh * qF);
  rewritten.set(
    fr.idx,
    lines[fr.idx].replace(
      /(x: )\d+(, y: )\d+(, width: )\d+(, height: )\d+/,
      `$1${nx}$2${ny}$3${nw}$4${nh}`,
    ),
  );
}
const finalSrc = lines.map((l, i) => rewritten.get(i) ?? l).join("\n");
if (finalSrc !== placementsSrc) {
  writeFileSync(placementsPath, finalSrc);
  console.log("\nUpdated scales + quest frame rects in src/game/cloverVillagePlacements.ts");
} else {
  console.log("\nNo placement changes needed (already downscaled).");
}