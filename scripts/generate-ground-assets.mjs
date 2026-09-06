#!/usr/bin/env node
/**
 * Generate the two authored ground surfaces for Clover Village.
 *
 * The generation logic (re-lit meadow, de-featured road, determinism, the
 * tone constants) lives in scripts/lib/ground-art.mjs and is shared with the
 * regression test that pins its palette + seamlessness. This file is the thin
 * CLI: write the PNGs next to the other new-pack art (so the asset inventory
 * marks them runtime-used) and print the before/after sanity numbers.
 *
 * Run: node scripts/generate-ground-assets.mjs
 * Writes: reference/assets/new/CloverValley/Ground/meadow.png
 *         reference/assets/new/CloverValley/Ground/road.png
 * Then: npm run assets:inventory to refresh the inventory bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./lib/png.mjs";
import {
  generateMeadow,
  generatePlaza,
  generateRoad,
  generateValleyMeadow,
  generateValleyPath,
  landSource,
  roadSource,
  summarize,
} from "./lib/ground-art.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloverDir = resolve(root, "reference/assets/new/CloverValley/Ground");
const valleyDir = resolve(root, "reference/assets/new/HappyValley/Ground");

const meadow = generateMeadow();
const road = generateRoad();
mkdirSync(cloverDir, { recursive: true });
writeFileSync(resolve(cloverDir, "meadow.png"), encodePNG(meadow.w, meadow.h, meadow.px));
writeFileSync(resolve(cloverDir, "road.png"), encodePNG(road.w, road.h, road.px));
console.log(`Wrote ${resolve(cloverDir, "meadow.png")} (${meadow.w}x${meadow.h})`);
console.log(`Wrote ${resolve(cloverDir, "road.png")} (${road.w}x${road.h})`);

const valleyMeadow = generateValleyMeadow();
const valleyPath = generateValleyPath();
mkdirSync(valleyDir, { recursive: true });
writeFileSync(resolve(valleyDir, "valley-meadow.png"), encodePNG(valleyMeadow.w, valleyMeadow.h, valleyMeadow.px));
writeFileSync(resolve(valleyDir, "valley-path.png"), encodePNG(valleyPath.w, valleyPath.h, valleyPath.px));
console.log(`Wrote ${resolve(valleyDir, "valley-meadow.png")} (${valleyMeadow.w}x${valleyMeadow.h})`);
console.log(`Wrote ${resolve(valleyDir, "valley-path.png")} (${valleyPath.w}x${valleyPath.h})`);

const plaza = generatePlaza();
writeFileSync(resolve(cloverDir, "plaza.png"), encodePNG(plaza.w, plaza.h, plaza.px));
console.log(`Wrote ${resolve(cloverDir, "plaza.png")} (${plaza.w}x${plaza.h})`);

// Before/after sanity numbers for the report.
const orig = decodePNG(landSource);
const origRoad = decodePNG(roadSource);
summarize("land_1 (before)  ", orig.w, orig.h, orig.px);
summarize("meadow (after)   ", meadow.w, meadow.h, meadow.px);
summarize("road_5 (before)  ", origRoad.w, origRoad.h, origRoad.px);
summarize("road (after)     ", road.w, road.h, road.px);
summarize("valley-meadow    ", valleyMeadow.w, valleyMeadow.h, valleyMeadow.px);
summarize("valley-path      ", valleyPath.w, valleyPath.h, valleyPath.px);
summarize("plaza            ", plaza.w, plaza.h, plaza.px);