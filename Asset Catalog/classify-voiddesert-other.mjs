#!/usr/bin/env node
/**
 * Deterministic classifier for the VoidDesert map/tileset pack
 * (reference/assets/maps/VoidDesert/Map/*) — the "other" category per ChatGPT audit.
 *
 * 72 source records -> 8 semantic PNG families + 1 source family:
 *   voiddesert_ground        19  bg sand base + land_1-18 elevation/cliff kit
 *   voiddesert_stone_road    26  13-topology stone-road kit × 2 visual variants (a/b)
 *   voiddesert_building       5  desert/adobe structures
 *   voiddesert_decor          8  pyramid, tent, sign, log, boat, skull, fire, wagon
 *   voiddesert_cactus         8  upright cacti (6) + round cacti (2)
 *   voiddesert_dry_grass      2  small desert grass tufts
 *   voiddesert_water          1  oasis/lake
 *   voiddesert_preview        1  tileset reference preview
 *   voiddesert_source         2  AI + EPS masters (authoring only)
 *
 * KEY RULES per the audit:
 * - bg.png is ground_voiddesert_sand_base (seamless); land_6 is ground_voiddesert_sand.
 * - land_12/14/17 are CLIFF FACES (a/b/c), land_13 is CLIFF STAIRS, land_4/8 stair transitions.
 * - land_1,2,3,5,7,9,10,11,15,16,18 are sand boundary tiles (terrainRole: edge) — compass
 *   directions NOT asserted (needs-verification), same rule as Clover road candidates.
 * - road_1-13 = topology A, road_14-26 = topology B (road_14<->1 ... road_26<->13).
 *   Topology for outer corners/edges/center is verified from alpha-silhouette analysis
 *   (matches the audit exactly). road_10-13 are inner corners — compass direction NOT
 *   asserted (needs-verification); canonical inner_corner_01..04.
 * - stones_2/3 are cut stone; stone ring NOT a well; mesas landmark-scale (see nature pack).
 * - building_3 is domed_tower (white dome unmistakable); no tavern/temple/inn guesses.
 * - decor roles are semantic (landmark/camp/sign/timber/boat/bone/fire/vehicle).
 * - greenery: 6 upright cactus + 2 round cactus = voiddesert_cactus (8); greenery_6/10 dry grass.
 * - cactus/dry-grass: collision none, walkable true (not obstacles just because standalone).
 * - lake.png is an oasis (waterType: oasis) — confirmed by full preview composition.
 * - preview is NOT gameplay (runtimeEligible: false); AI/EPS are formats, not families.
 * Everything stays reference — nothing runtime-confirmed on this page.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-voiddesert-other.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "VoidDesert";
const PREFIX = "reference/assets/maps/VoidDesert/Map/";

// land_N -> { canonicalName, terrainRole, variant, walkable, collision, topology, desc }
// Directions for boundary tiles are NOT asserted (needs-verification per project rule).
const LAND = {
  // base texture (clean full sand)
  land_6: { canonicalName: "ground_voiddesert_sand", terrainRole: "base-texture", tileMode: "repeat", walkable: true, collision: "none", topology: "verified", desc: "Clean full sand surface — base texture for the desert floor." },
  // cliff faces (brown rock walls — not ordinary walkable ground)
  land_12: { canonicalName: "ground_voiddesert_cliff_a", terrainRole: "cliff-face", tileMode: "manual", walkable: false, collision: "terrain-boundary", topology: "verified", desc: "Exposed brown stone cliff face (variant a)." },
  land_14: { canonicalName: "ground_voiddesert_cliff_b", terrainRole: "cliff-face", tileMode: "manual", walkable: false, collision: "terrain-boundary", topology: "verified", desc: "Exposed brown stone cliff face (variant b)." },
  land_17: { canonicalName: "ground_voiddesert_cliff_c", terrainRole: "cliff-face", tileMode: "manual", walkable: false, collision: "terrain-boundary", topology: "verified", desc: "Exposed brown stone cliff face (variant c)." },
  // stairs
  land_13: { canonicalName: "ground_voiddesert_cliff_stairs", terrainRole: "stairs", tileMode: "manual", walkable: true, collision: "none", topology: "verified", desc: "Frontal staircase embedded into the cliff." },
  // stair/edge transitions
  land_4: { canonicalName: "ground_voiddesert_cliff_stair_transition_a", terrainRole: "transition", tileMode: "manual", walkable: true, collision: "none", topology: "verified", desc: "Complementary angled stair/edge structure (variant a)." },
  land_8: { canonicalName: "ground_voiddesert_cliff_stair_transition_b", terrainRole: "transition", tileMode: "manual", walkable: true, collision: "none", topology: "verified", desc: "Complementary angled stair/edge structure (variant b)." },
  // sand tiles with cliff/drop boundaries (11) — directions needs-verification
  land_1: { canonicalName: "ground_voiddesert_sand_edge_01", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_2: { canonicalName: "ground_voiddesert_sand_edge_02", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_3: { canonicalName: "ground_voiddesert_sand_edge_03", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_5: { canonicalName: "ground_voiddesert_sand_edge_04", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_7: { canonicalName: "ground_voiddesert_sand_edge_05", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_9: { canonicalName: "ground_voiddesert_sand_edge_06", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_10: { canonicalName: "ground_voiddesert_sand_edge_07", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_11: { canonicalName: "ground_voiddesert_sand_edge_08", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_15: { canonicalName: "ground_voiddesert_sand_edge_09", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_16: { canonicalName: "ground_voiddesert_sand_edge_10", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
  land_18: { canonicalName: "ground_voiddesert_sand_edge_11", terrainRole: "edge", tileMode: "manual", walkable: true, collision: "none", topology: "needs-verification", desc: "Sand tile with cliff/drop boundary (candidate edge). Compass direction pending topology pass." },
};

// road_N -> { role, dir }  (variant b = index + 13)
// Topology verified by alpha-silhouette analysis (matches audit enumeration exactly).
const ROAD_A = {
  1: { role: "outer-corner", dir: "nw" },
  2: { role: "edge", dir: "n" },
  3: { role: "outer-corner", dir: "ne" },
  4: { role: "edge", dir: "w" },
  5: { role: "center", dir: null },
  6: { role: "edge", dir: "e" },
  7: { role: "outer-corner", dir: "sw" },
  8: { role: "edge", dir: "s" },
  9: { role: "outer-corner", dir: "se" },
  10: { role: "inner-corner", dir: null }, // direction pending topology pass
  11: { role: "inner-corner", dir: null },
  12: { role: "inner-corner", dir: null },
  13: { role: "inner-corner", dir: null },
};

// decor_N -> { canonicalName, decorRole, desc }
const DECOR = {
  decor_1: { canonicalName: "decor_voiddesert_pyramid", decorRole: "landmark", desc: "Small stone pyramid. Used as a landmark in the full tileset preview composition." },
  decor_2: { canonicalName: "decor_voiddesert_tent", decorRole: "camp", desc: "Desert tent." },
  decor_3: { canonicalName: "decor_voiddesert_signpost", decorRole: "sign", desc: "Wooden directional sign." },
  decor_4: { canonicalName: "decor_voiddesert_log", decorRole: "timber", desc: "Straight timber/log." },
  decor_5: { canonicalName: "decor_voiddesert_boat", decorRole: "boat", desc: "Wooden canoe/boat." },
  decor_6: { canonicalName: "decor_voiddesert_horned_skull", decorRole: "bone", desc: "Horned animal skull." },
  decor_7: { canonicalName: "decor_voiddesert_campfire", decorRole: "fire", desc: "Burning campfire." },
  decor_8: { canonicalName: "decor_voiddesert_covered_wagon", decorRole: "vehicle", desc: "Covered wagon." },
};

// greenery_N -> cactus (upright/round) or dry grass
const GREENERY = {
  greenery_1: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_tall", variant: "tall", desc: "Large saguaro-style upright cactus." },
  greenery_2: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_tiny", variant: "tiny", desc: "Tiny compact upright cactus." },
  greenery_3: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_upright", variant: "upright", desc: "Upright cactus form." },
  greenery_4: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_round", variant: "round", desc: "Round upright cactus form." },
  greenery_5: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_small", variant: "small", desc: "Small upright cactus form." },
  greenery_6: { family: "voiddesert_dry_grass", canonicalName: "nature_voiddesert_dry_grass_a", variant: "a", desc: "Small desert dry grass/brush tuft (variant a)." },
  greenery_7: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_round_cactus_a", variant: "round_a", desc: "Broad round green desert plant with yellow center/top (variant a). NOT called a melon — no source evidence." },
  greenery_8: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_round_cactus_b", variant: "round_b", desc: "Broad round green desert plant with yellow center/top (variant b). NOT called a melon — no source evidence." },
  greenery_9: { family: "voiddesert_cactus", canonicalName: "nature_voiddesert_cactus_broad", variant: "broad", desc: "Broad curved upright cactus." },
  greenery_10: { family: "voiddesert_dry_grass", canonicalName: "nature_voiddesert_dry_grass_b", variant: "b", desc: "Small desert dry grass/brush tuft (variant b)." },
};

// building_N -> { canonicalName, desc }
const BUILDINGS = {
  building_1: { canonicalName: "building_voiddesert_adobe_house_large", desc: "Large desert/adobe house." },
  building_2: { canonicalName: "building_voiddesert_adobe_house_long", desc: "Long desert/adobe house." },
  building_3: { canonicalName: "building_voiddesert_domed_tower", desc: "Desert structure with unmistakable white dome and narrow vertical footprint — domed_tower identity is visually confirmed; no tavern/temple/inn inferred." },
  building_4: { canonicalName: "building_voiddesert_house_peaked_roof", desc: "Desert house with peaked roof." },
  building_5: { canonicalName: "building_voiddesert_adobe_house_tall", desc: "Tall desert/adobe house." },
};

const FAMILY_META = {
  voiddesert_ground: {
    suggestedFamilyName: "Desert Sand & Cliff Terrain Kit",
    vdMapFamilyType: "ground",
    worldRole: "PVE_1_20",
    notes: "19 assets — bg.png (seamless sand base) + land_1-18 (one elevation/cliff system, NOT 18 arbitrary pieces). land_6 = clean sand base; land_12/14/17 = cliff faces (a/b/c, walkable false); land_13 = cliff stairs; land_4/8 = stair transitions; the other 11 = sand boundary tiles (terrainRole edge, compass directions needs-verification pending a topology pass — same rule as Clover road candidates). Locked 2026-08-15.",
  },
  voiddesert_stone_road: {
    suggestedFamilyName: "Stone Road Kit (13 Topologies × 2 Variants)",
    vdMapFamilyType: "road",
    worldRole: "PVE_1_20",
    notes: "26 assets — road_1-13 = topology A, road_14-26 = variant B of the same 13-piece topology (road_14<->1 ... road_26<->13, confirmed by identical alpha silhouettes). Outer corners NW/NE/SW/SE, edges N/E/S/W, center verified from analysis matching the audit. road_10-13 = four inner-corner transitions — compass directions NOT asserted (needs-verification). topology and visual variant stay separate fields. walkable, collision none. Locked 2026-08-15.",
  },
  voiddesert_building: {
    suggestedFamilyName: "Desert Adobe Structures",
    vdMapFamilyType: "building",
    worldRole: "PVE_1_20",
    notes: "5 standalone desert structures. building_3 is domed_tower (white dome + narrow footprint unmistakable). No tavern/temple/inn/shop inferred from architecture alone. occlusion: true, collision: footprint, walkable: false. Locked 2026-08-15.",
  },
  voiddesert_decor: {
    suggestedFamilyName: "Desert Decor Props",
    vdMapFamilyType: "decor",
    worldRole: "PVE_1_20",
    notes: "8 visually distinct standalone props — pyramid (landmark), tent (camp), signpost (sign), log (timber), boat, horned skull (bone), campfire (fire), covered wagon (vehicle). Semantic decorRole per object; identities established directly from the rendered sprites. Locked 2026-08-15.",
  },
  voiddesert_cactus: {
    suggestedFamilyName: "Desert Cacti",
    vdMapFamilyType: "cactus",
    worldRole: "PVE_1_20",
    notes: "8 assets — 6 conventional upright cacti (tall, tiny, upright, round, small, broad) + 2 round/melon-like plants (a/b). Round plants NOT called melons — no source evidence. collision: none, walkable: true (not obstacles just because they're standalone sprites). Locked 2026-08-15.",
  },
  voiddesert_dry_grass: {
    suggestedFamilyName: "Desert Dry Grass",
    vdMapFamilyType: "dry-grass",
    worldRole: "PVE_1_20",
    notes: "2 separate dry grass/brush tufts (a/b). collision: none, walkable: true. Locked 2026-08-15.",
  },
  voiddesert_water: {
    suggestedFamilyName: "Desert Oasis",
    vdMapFamilyType: "water",
    worldRole: "PVE_1_20",
    notes: "1 standalone blue desert water pool — oasis confirmed by the full tileset preview (pool embedded among palms and desert vegetation). waterType: oasis, collision: water, walkable: false. Locked 2026-08-15.",
  },
  voiddesert_preview: {
    suggestedFamilyName: "Tileset Reference Preview",
    vdMapFamilyType: "preview",
    worldRole: "PVE_1_20",
    notes: "1 tileset reference preview (3072x2048) — the complete example composition showing how the pack fits together. NOT a gameplay sprite: runtimeEligible false, placeable false. Visual source of truth for intended combinations. Locked 2026-08-15.",
  },
  voiddesert_source: {
    suggestedFamilyName: "Desert Tileset Authoring Masters",
    vdMapFamilyType: "source",
    worldRole: "PVE_1_20",
    notes: "2 master authoring files — .ai + .eps. AI/EPS are FORMATS, not asset families. Kept for provenance; never runtime-eligible or placeable. Locked 2026-08-15.",
  },
};

function classify(fileName) {
  const base = {
    reviewStatus: "reviewed",
    runtimeStatus: "reference-only",
    worldRole: "PVE_1_20",
    placementMode: "manual",
    runtimeEligible: true,
    placeable: false,
    renameStatus: "keep",
  };

  // Masters
  if (fileName === "2D_RPG_Desert_Tileset.ai") {
    return {
      family: "voiddesert_source",
      asset: {
        ...base,
        assetRole: "authoring-master",
        sourceRole: "tileset",
        format: "illustrator",
        runtimeEligible: false,
        displayName: "desert tileset Illustrator master",
        canonicalName: "source_voiddesert_tileset_master_ai",
        description: "Illustrator master for the 2D RPG Desert Tileset.",
      },
    };
  }
  if (fileName === "2D_RPG_Desert_Tileset.eps") {
    return {
      family: "voiddesert_source",
      asset: {
        ...base,
        assetRole: "authoring-master",
        sourceRole: "tileset",
        format: "eps",
        runtimeEligible: false,
        displayName: "desert tileset EPS master",
        canonicalName: "source_voiddesert_tileset_master_eps",
        description: "EPS master for the 2D RPG Desert Tileset.",
      },
    };
  }

  // Preview
  if (fileName === "Preview_2D_RPG_Desert_Tileset.png") {
    return {
      family: "voiddesert_preview",
      asset: {
        ...base,
        assetRole: "preview",
        sourceRole: "tileset-reference",
        runtimeEligible: false,
        displayName: "desert tileset reference preview",
        canonicalName: "source_voiddesert_tileset_preview",
        description: "Complete 3072x2048 reference composition of the desert tileset — visual source of truth for intended combinations. NOT a gameplay sprite.",
      },
    };
  }

  // bg + land
  if (fileName === "bg.png") {
    return {
      family: "voiddesert_ground",
      asset: {
        ...base,
        assetRole: "terrain-tile",
        terrainRole: "base-texture",
        tileMode: "repeat",
        walkable: true,
        collision: "none",
        topology: "verified",
        displayName: "desert sand base",
        canonicalName: "ground_voiddesert_sand_base",
        description: "Seamless 256x256 sandy desert texture without cliffs or transparency — clean base surface.",
      },
    };
  }
  const land = LAND[fileName.replace(/\.png$/i, "")];
  if (land) {
    return {
      family: "voiddesert_ground",
      asset: {
        ...base,
        assetRole: "terrain-tile",
        terrainRole: land.terrainRole,
        tileMode: land.tileMode,
        walkable: land.walkable,
        collision: land.collision,
        topology: land.topology,
        variant: null,
        displayName: land.canonicalName.replace(/^ground_voiddesert_/, "").replace(/_/g, " "),
        canonicalName: land.canonicalName,
        description: land.desc,
      },
    };
  }

  // roads
  const roadMatch = fileName.match(/^road_(\d+)\.png$/);
  if (roadMatch) {
    const n = parseInt(roadMatch[1], 10);
    const variant = n <= 13 ? "a" : "b";
    const aIdx = ((n - 1) % 13) + 1;
    const role = ROAD_A[aIdx];
    const display = `${role.role.replace(/-/g, " ")}${role.dir ? " " + role.dir.toUpperCase() : ""}`;
    const canonical = role.role === "center"
      ? `road_voiddesert_stone_center_${variant}`
      : role.dir
      ? `road_voiddesert_stone_${role.role}_${role.dir}_${variant}`
      : `road_voiddesert_stone_${role.role}_${String(aIdx - 9).padStart(2, "0")}_${variant}`;
    return {
      family: "voiddesert_stone_road",
      asset: {
        ...base,
        assetRole: "road-tile",
        roadRole: role.role,
        roadType: "autotile",
        surfaceType: "cobblestone",
        direction: role.dir,
        variant,
        topology: role.role === "center" || role.dir ? "verified" : "needs-verification",
        tileMode: "manual",
        walkable: true,
        collision: "none",
        displayName: `stone road ${display} (variant ${variant.toUpperCase()})`,
        canonicalName: canonical,
        description: `${display} stone road tile — variant ${variant.toUpperCase()} of the 13-piece topology (${variant === "a" ? "road_1-13" : `variant B, paired with road_${aIdx}`}).`,
      },
    };
  }

  // buildings
  const bName = fileName.replace(/\.png$/i, "");
  const building = BUILDINGS[bName];
  if (building) {
    return {
      family: "voiddesert_building",
      asset: {
        ...base,
        assetRole: "building",
        occlusion: true,
        collision: "footprint",
        walkable: false,
        displayName: building.canonicalName.replace(/^building_voiddesert_/, "").replace(/_/g, " "),
        canonicalName: building.canonicalName,
        description: building.desc,
      },
    };
  }

  // decor
  const dName = fileName.replace(/\.png$/i, "");
  const decor = DECOR[dName];
  if (decor) {
    return {
      family: "voiddesert_decor",
      asset: {
        ...base,
        assetRole: "decor",
        decorRole: decor.decorRole,
        collision: "none",
        walkable: true,
        displayName: decor.canonicalName.replace(/^decor_voiddesert_/, "").replace(/_/g, " "),
        canonicalName: decor.canonicalName,
        description: decor.desc,
      },
    };
  }

  // greenery
  const gName = fileName.replace(/\.png$/i, "");
  const greenery = GREENERY[gName];
  if (greenery) {
    const isCactus = greenery.family === "voiddesert_cactus";
    return {
      family: greenery.family,
      asset: {
        ...base,
        assetRole: "vegetation",
        natureRole: isCactus ? "cactus" : "dry-grass",
        variant: greenery.variant,
        collision: "none",
        walkable: true,
        displayName: greenery.canonicalName.replace(/^nature_voiddesert_/, "").replace(/_/g, " "),
        canonicalName: greenery.canonicalName,
        description: greenery.desc,
      },
    };
  }

  // lake
  if (fileName === "lake.png") {
    return {
      family: "voiddesert_water",
      asset: {
        ...base,
        assetRole: "water-feature",
        waterType: "oasis",
        collision: "water",
        walkable: false,
        displayName: "desert oasis",
        canonicalName: "water_voiddesert_oasis",
        description: "Standalone blue desert water pool (oasis) — confirmed by the full tileset preview showing it embedded among palms and desert vegetation.",
      },
    };
  }

  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Idempotent: remove previous VoidDesert map-family reviews only (never touch the
  // nature families voiddesert_rock/cut_stone/stone_formation/mesa/palm/desert_tree
  // owned by classify-voiddesert-nature.mjs).
  const OWNED = Object.keys(FAMILY_META);
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/`) && OWNED.includes(key.split("/")[1])) delete reviews.reviews[key];
  }

  // Only the 72 map-kit files (exclude stones_*/tree_* which belong to the nature pack).
  const files = inventory.files.filter((f) => {
    if (!f.path.startsWith(PREFIX)) return false;
    const name = f.path.split("/").pop();
    return !/^(stones|tree)_\d+\.png$/i.test(name);
  });
  const byFamily = {};
  let unclassified = 0;
  for (const f of files) {
    const fileName = f.path.split("/").pop();
    const result = classify(fileName);
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
      vdMapFamilyType: meta.vdMapFamilyType,
      worldRole: meta.worldRole,
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[voiddesert-other] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  // Verify: 19+26+5+8+8+2+1+1+2 = 72
  const expected = { voiddesert_ground: 19, voiddesert_stone_road: 26, voiddesert_building: 5, voiddesert_decor: 8, voiddesert_cactus: 8, voiddesert_dry_grass: 2, voiddesert_water: 1, voiddesert_preview: 1, voiddesert_source: 2 };
  const ok = Object.keys(expected).every((k) => counts[k] === expected[k]) && classified === 72;
  console.log(ok ? "✓ 72/72 classified, counts match audit (19+26+5+8+8+2+1+1+2)" : "✗ COUNT MISMATCH");

  // Verify road variant pairing: road_14..26 must have same role as road_1..13
  const roadFiles = files.filter((f) => /road_\d+\.png$/.test(f.path.split("/").pop()));
  const roleOf = (n) => ROAD_A[((n - 1) % 13) + 1].role;
  const aRoles = Array.from({ length: 13 }, (_, i) => roleOf(i + 1));
  const bRoles = Array.from({ length: 13 }, (_, i) => roleOf(i + 14));
  const pairingOk = roadFiles.length === 26 && aRoles.every((r, i) => r === bRoles[i]);
  console.log(pairingOk ? "✓ road variant B pairs 1:1 with variant A (road_14<->1 ... road_26<->13)" : "✗ ROAD PAIRING MISMATCH");

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
