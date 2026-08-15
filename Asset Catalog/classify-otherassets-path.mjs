#!/usr/bin/env node
/**
 * Deterministic classifier for the OtherAssets path-composite pack
 * (reference/assets/maps/OtherAssets/Paths/*) — per ChatGPT audit.
 *
 * 17 source records -> 3 semantic families:
 *   shared_path_composite        15  precomposed path/road sprite sheets
 *                                    (5 materials × 3 surface contexts)
 *   shared_path_terrain_support   1  Ground_grass.png (path-edge palette)
 *   shared_path_source            1  Roads.tmx (path-layout definition)
 *
 * KEY RULES per the audit:
 * - These are COMPOSITE SPRITESHEETS, not individual tiles. 240x416 / 240x480 are
 *   sheet dimensions, NOT path-tile dimensions. assetRole: path-composite-sheet.
 * - The 5 road styles are MATERIALS, not five unrelated path systems:
 *   Road1=blue_cobble, Road2=tan_brick, Road3=blue_masonry, Road4=brown_paver,
 *   Road5=pale_cobble. No gameplay labels (castle/village/desert) invented.
 * - Each material has 3 surface contexts: plain (transparent), _ground (ground-edge),
 *   _grass (grass-edge). NOT duplicates — same path geometry, different edge treatment.
 * - The sheet contains a vocabulary of shapes (pad, straight, bend, junction, ring,
 *   intersection, platform) — recorded as metadata, NOT exploded into individual
 *   manually named tiles. tileExtraction: required (via Roads.tmx).
 * - Ground_grass.png is NOT a road — it's a terrain-support/path-edge palette sheet.
 * - Roads.tmx is the path-layout definition (tiled-map, format tmx) — the strongest
 *   candidate for encoding intended tile regions; runtimeEligible false unless the
 *   runtime actually consumes TMX.
 * Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-otherassets-path.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "OtherAssets";
const PREFIX = "reference/assets/maps/OtherAssets/Paths/";

// RoadN -> material identity (conservative, from visual material only)
const MATERIALS = {
  Road1: { material: "blue_cobble", desc: "Blue rounded/cobble stone" },
  Road2: { material: "tan_brick", desc: "Tan brick" },
  Road3: { material: "blue_masonry", desc: "Blue-gray cut masonry (geometric)" },
  Road4: { material: "brown_paver", desc: "Brown diamond/paver stone (geometric)" },
  Road5: { material: "pale_cobble", desc: "Pale rounded cobblestone" },
};

// Surface context per suffix
const CONTEXTS = {
  "": { context: "transparent", label: "plain" },
  "_ground": { context: "ground-edge", label: "ground" },
  "_grass": { context: "grass-edge", label: "grass" },
};

// Shape vocabulary present in the composite sheets (from the audit's visual read)
const SHEET_SHAPES = ["pad", "straight", "bend", "junction", "ring", "intersection", "platform"];

const FAMILY_META = {
  shared_path_composite: {
    suggestedFamilyName: "Shared Path Composite Sheets",
    pathFamilyType: "composite",
    worldRole: "SHARED_1_20",
    notes: "15 precomposed path/road sprite sheets — 5 materials × 3 surface contexts. Materials: blue_cobble (Road1), tan_brick (Road2), blue_masonry (Road3), brown_paver (Road4), pale_cobble (Road5). Each material has plain (transparent), ground-edge (_ground), and grass-edge (_grass) variants — same path geometry, different edge treatment, NOT duplicates. These are COMPOSITE sheets (240x416 / 240x480), NOT individual tiles: the sheet contains a shape vocabulary (pad/straight/bend/junction/ring/intersection/platform) to be extracted via Roads.tmx — tileExtraction: required, placeable false. No gameplay labels (castle/village/desert) invented. Locked 2026-08-15.",
  },
  shared_path_terrain_support: {
    suggestedFamilyName: "Shared Path Terrain Support",
    pathFamilyType: "terrain-support",
    worldRole: "SHARED_1_20",
    notes: "Ground_grass.png — NOT a road. Contains grouped color/material samples and small vegetation/ground-edge shapes in several palettes (green, cyan, dark green, olive, brown/light ground). Classified as a terrain-support sheet / path-edge palette: support artwork for adding grass/ground fringes to the path set (fits the _grass and _ground composite variants). Inference from visual relationship, not an explicit source label. placeable false, runtimeStatus reference. Locked 2026-08-15.",
  },
  shared_path_source: {
    suggestedFamilyName: "Shared Path Tiled Source",
    pathFamilyType: "source",
    worldRole: "SHARED_1_20",
    notes: "Roads.tmx — Tiled path-layout definition. Given the repeated layout of the five sheets, this TMX is the strongest candidate for encoding the intended tile regions/layout rather than manually chopping the sheets by eye (inference, fits the package structure). runtimeEligible false unless the runtime actually consumes TMX directly. Locked 2026-08-15.",
  },
};

function classify(fileName, file) {
  const base = {
    reviewStatus: "reviewed",
    runtimeStatus: "reference-only",
    worldRole: "SHARED_1_20",
    runtimeEligible: true,
    placeable: false,
    renameStatus: "keep",
  };

  // Roads.tmx
  if (fileName === "Roads.tmx") {
    return {
      family: "shared_path_source",
      asset: {
        ...base,
        assetRole: "tiled-map",
        format: "tmx",
        sourceRole: "path-layout-definition",
        runtimeEligible: false,
        displayName: "roads Tiled map",
        canonicalName: "source_paths_roads_tmx",
        description: "Tiled path-layout definition encoding the intended tile regions of the five composite road sheets. Runtime-eligible only if the runtime actually consumes TMX directly.",
      },
    };
  }

  // Ground_grass.png
  if (fileName === "Ground_grass.png") {
    return {
      family: "shared_path_terrain_support",
      asset: {
        ...base,
        assetRole: "terrain-support-sheet",
        sourceRole: "path-edge-palette",
        displayName: "ground/grass edge palette",
        canonicalName: "path_composite_ground_grass_palette",
        description: `Grouped color/material samples and small vegetation/ground-edge shapes in several palettes (${file.width}x${file.height}). NOT a road — support artwork for adding grass/ground fringes to the path set.`,
      },
    };
  }

  // RoadN[_(ground|grass)].png
  const m = fileName.match(/^(Road[1-5])(?:_(ground|grass))?\.png$/);
  if (m) {
    const road = m[1];
    const suffix = m[2] ? `_${m[2]}` : "";
    const mat = MATERIALS[road];
    const ctx = CONTEXTS[suffix];
    if (!mat || !ctx) return null;
    return {
      family: "shared_path_composite",
      asset: {
        ...base,
        assetRole: "path-composite-sheet",
        pathMaterial: mat.material,
        surfaceContext: ctx.context,
        contains: SHEET_SHAPES,
        tileExtraction: "required",
        tileSource: "tiled",
        displayName: `${mat.material.replace(/_/g, " ")} path (${ctx.label})`,
        canonicalName: `path_composite_${mat.material}_${ctx.context === "transparent" ? "plain" : ctx.context === "ground-edge" ? "ground" : "grass"}`,
        description: `${mat.desc} path composite sheet (${file.width}x${file.height}) — ${ctx.label} surface context. Contains pad/straight/bend/junction/ring/intersection/platform shapes; extract via Roads.tmx, do NOT place the whole sheet.`,
      },
    };
  }

  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Idempotent: remove previous OtherAssets path review families only.
  const OWNED = Object.keys(FAMILY_META);
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/`) && OWNED.includes(key.split("/")[1])) delete reviews.reviews[key];
  }

  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX));
  const byFamily = {};
  let unclassified = 0;
  for (const f of files) {
    const fileName = f.path.split("/").pop();
    const result = classify(fileName, f);
    if (!result) {
      unclassified++;
      console.warn(`UNCLASSIFIED: ${f.path}`);
      continue;
    }
    const famAssets = (byFamily[result.family] = byFamily[result.family] || {});
    famAssets[f.path] = { ...result.asset };
  }

  for (const [familyKey, assets] of Object.entries(byFamily)) {
    const meta = FAMILY_META[familyKey];
    reviews.reviews[`${PACK}/${familyKey}`] = {
      familyKey,
      canonicalFamily: familyKey,
      suggestedFamilyName: meta.suggestedFamilyName,
      pathFamilyType: meta.pathFamilyType,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[otherassets-path] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify: 15 + 1 + 1 = 17
  const expected = { shared_path_composite: 15, shared_path_terrain_support: 1, shared_path_source: 1 };
  const ok = Object.keys(expected).every((k) => counts[k] === expected[k]) && classified === 17;
  console.log(ok ? "✓ 17/17 classified, counts match audit (15+1+1)" : "✗ COUNT MISMATCH");

  // Verify all 15 composite canonicals are distinct (5 materials × 3 contexts)
  const comp = files.filter((f) => /Road[1-5](?:_(ground|grass))?\.png$/.test(f.path.split("/").pop()));
  const canonicals = new Set(comp.map((f) => {
    const fileName = f.path.split("/").pop();
    const m = fileName.match(/^(Road[1-5])(?:_(ground|grass))?\.png$/);
    const mat = MATERIALS[m[1]].material;
    const suffix = m[2] ? m[2] : "plain";
    return `path_composite_${mat}_${suffix}`;
  }));
  console.log(canonicals.size === 15 ? "✓ 15 distinct composite canonicals (5 materials × 3 contexts)" : `✗ ${canonicals.size} distinct canonicals`);

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
