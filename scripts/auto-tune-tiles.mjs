#!/usr/bin/env node
/**
 * VL auto-tuner: feeds the local 450M VL's per-tile scores back into the
 * texture factory automatically.
 *
 * Each iteration:
 *   1. renders the tileset with the current palette (scripts/render-tiles.mjs)
 *   2. asks the VL one JSON-scored question per tile (scripts/ai-tile-review.mjs)
 *   3. converts the scores into palette deltas (contrast → move dark/light
 *      pairs apart, noise → scale decorative counts; clamped per iteration)
 *   4. applies them via adjustPalette() and rewrites the DEFAULT_TILE_PALETTE
 *      literal in src/game/tilePalette.ts — the factory reads it at boot, so
 *      a `npm run build` ships the tuned look.
 *
 * Stops when no actionable deltas remain or the iteration cap is reached.
 * The 450M's scores are noisy (temperature 0.7) — deltas are clamped so the
 * look drifts gently toward contrast 3/5 and noise 2/5 rather than jumping.
 *
 * Usage:
 *   node --import tsx scripts/auto-tune-tiles.mjs            # up to 5 iterations
 *   node --import tsx scripts/auto-tune-tiles.mjs --iterations 3
 *   node --import tsx scripts/auto-tune-tiles.mjs --dry-run  # review, don't write
 */
import { writeFileSync, readFileSync } from "node:fs";
import {
  DEFAULT_TILE_PALETTE,
  adjustPalette,
} from "../src/game/tilePalette.ts";
import { renderTileset } from "./render-tiles.mjs";
import { collectTileScores, openReviewSession } from "./ai-tile-review.mjs";

const args = process.argv.slice(2);
const iterFlag = args.indexOf("--iterations");
const parsedIter = Number.parseInt(args[iterFlag + 1] ?? "", 10);
const MAX_ITER = Number.isFinite(parsedIter) ? clamp(parsedIter, 1, 10) : 5;
const DRY = args.includes("--dry-run");

const PALETTE_FILE = new URL("../src/game/tilePalette.ts", import.meta.url);

/** Scores the tuner steers toward (contrast 1=flat..5=harsh, noise 1..5). */
const TARGET = { contrast: 3, noise: 2 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function deltasFromScore(parsed) {
  const d = {};
  const contrast = Number(parsed?.contrast);
  const noise = Number(parsed?.noise);
  if (Number.isFinite(contrast) && contrast >= 1 && contrast <= 5) {
    // Gentle per-iteration steps (~0.1 * 255 ≈ 25 RGB levels max) so the
    // noisy 450M drifts the look toward the target instead of jumping it.
    d.contrast = clamp((TARGET.contrast - contrast) * 0.1, -0.15, 0.15);
  }
  if (Number.isFinite(noise) && noise >= 0 && noise <= 5) {
    d.noise = clamp((TARGET.noise - noise) * 0.15, -0.25, 0.25);
  }
  // The 450M often flags a tile (verdict "needs-work") without numeric
  // scores — nudge it gently so flagged tiles still move instead of being
  // silently ignored for the whole run.
  if (d.contrast === undefined && d.noise === undefined && parsed?.verdict === "needs-work") {
    d.contrast = 0.05;
  }
  return d;
}

/** Rewrite the DEFAULT_TILE_PALETTE literal in tilePalette.ts. */
function writePalette(palette) {
  const file = readFileSync(PALETTE_FILE, "utf8");
  const marker = "export const DEFAULT_TILE_PALETTE: TilePalette = {";
  const start = file.indexOf(marker);
  if (start === -1) throw new Error("tilePalette.ts: palette marker not found");
  const literalStart = start + marker.length - 1; // position of "{"
  const end = file.indexOf("};", literalStart);
  if (end === -1) throw new Error("tilePalette.ts: palette literal close not found");
  const literal =
    "export const DEFAULT_TILE_PALETTE: TilePalette = " +
    JSON.stringify(palette, null, 2) +
    ";";
  writeFileSync(
    PALETTE_FILE,
    file.slice(0, start) + literal + file.slice(end + 2),
  );
}

const fmtDelta = (d) =>
  `${d.contrast ? `${d.contrast > 0 ? "+" : ""}${d.contrast.toFixed(2)}c` : "0c"},` +
  `${d.noise ? `${d.noise > 0 ? "+" : ""}${d.noise.toFixed(2)}n` : "0n"}`;

async function main() {
  console.log(`VL auto-tuner — up to ${MAX_ITER} iterations (dry-run: ${DRY})`);
  let palette = structuredClone(DEFAULT_TILE_PALETTE);
  const { brain, close } = await openReviewSession();
  let converged = false;

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const averages = renderTileset(palette, "./");
    console.log(`\n── iteration ${iter}/${MAX_ITER} — rendered, asking the VL…`);

    const results = await collectTileScores(brain);
    const deltas = {};
    for (const { code, name, parsed } of results) {
      deltas[code] = deltasFromScore(parsed);
      const avg = averages[code] ?? "?";
      console.log(
        `  ${code} ${name.padEnd(24)} → ${String(parsed?.color ?? "?").padEnd(6)}` +
          ` · contrast ${parsed?.contrast ?? "?"}/5 · noise ${parsed?.noise ?? "?"}/5` +
          ` · Δ ${fmtDelta(deltas[code])} · actual ${avg}`,
      );
    }

    const active = Object.entries(deltas).filter(
      ([, d]) => (d.contrast ?? 0) !== 0 || (d.noise ?? 0) !== 0,
    );
    const usable = results.filter((r) =>
      Number.isFinite(Number(r.parsed?.contrast)) || Number.isFinite(Number(r.parsed?.noise)),
    ).length;
    if (active.length === 0) {
      if (usable === 0) {
        console.log("\nno actionable signal from the VL this round (scores unparseable) — nothing learned");
      } else {
        console.log("\nall deltas zero — converged");
        converged = true;
      }
      break;
    }
    const maxDelta = Math.max(
      ...active.map(([, d]) => Math.max(Math.abs(d.contrast ?? 0), Math.abs(d.noise ?? 0))),
    );

    palette = adjustPalette(palette, deltas);
    if (!DRY) writePalette(palette);
    console.log(
      `  applied ${active.length} deltas (max |Δ| ${maxDelta.toFixed(3)})` +
        (DRY ? " — dry run, nothing written" : " → wrote src/game/tilePalette.ts"),
    );

    if (maxDelta < 0.03) {
      console.log("\ndeltas negligible — converged");
      converged = true;
      break;
    }
  }

  await close();
  console.log(
    converged
      ? "\n✅ converged — tuned palette " + (DRY ? "reviewed (not written)" : "written to src/game/tilePalette.ts")
      : `\n🏁 finished after ${MAX_ITER} iterations ` + (DRY ? "(not written)" : "— palette written to src/game/tilePalette.ts"),
  );
  if (DRY) console.log("\nFinal palette would be:\n" + JSON.stringify(palette, null, 2));
}

main().catch((err) => {
  console.error("tune failed:", err);
  process.exit(1);
});
