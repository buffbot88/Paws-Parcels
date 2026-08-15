#!/usr/bin/env node
/**
 * Deterministic classifier for the HappyValley Map environment kit
 * (reference/assets/maps/HappyValley/Map/*) — per ChatGPT audit.
 *
 * The category is mislabeled "other" only because the source pack was dropped
 * in wholesale. It is actually a complete HappyValley environment kit:
 *   89 PNG gameplay assets  (56 terrain tiles + 33 props/structures)
 *   90 EPS records          (56 ground mirrors + 33 prop mirrors + 1 master)
 *   1  AI master
 *   = 180 source records
 *
 * Semantic families (12):
 *   happyvalley_ground_dirt_grass  56 tiles  (dirt + grass autotile kit, 256x256)
 *   happyvalley_bush                3        (small / medium / large)
 *   happyvalley_tree                5        (3 standing sizes + short/tall stumps)
 *   happyvalley_rock                5        (variants 01-05)
 *   happyvalley_banner              3        (blue banner / red banner / flag)
 *   happyvalley_building            2        (house + windmill)
 *   happyvalley_fortification       4        (2 castles + short/tall watchtowers)
 *   happyvalley_magic_landmark      1        (magic stone tower)
 *   happyvalley_camp                2        (campfire + tent)
 *   happyvalley_interactable        2        (treasure chest + well)
 *   happyvalley_woodwork            6        (barrel, bridges H/V, cart, fences H/V)
 *   happyvalley_source              2        (Simple Summer .ai + master .eps)
 *
 * EPS counterparts join their PNG family with assetRole authoring-source and a
 * sourceOf link; masters live in happyvalley_source. Every canonical name
 * derives deterministically from the source name; source files untouched.
 * Writes review entries into design/assets/asset-reviews.json (schema v3).
 *
 * Usage: node classify-happyvalley-env.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inventoryPath = join(root, "design", "assets", "asset-inventory.json");
const reviewsPath = join(root, "design", "assets", "asset-reviews.json");

const PACK = "HappyValley";
const PREFIX = "reference/assets/maps/HappyValley/Map/";

// Prop name (from filename) -> identity. Same slug is used for the EPS mirror.
const PROPS = {
  "Blue Banner": { family: "happyvalley_banner", canonical: "decor_happyvalley_banner_blue", envRole: "banner", variant: "blue", decorRole: "banner" },
  "Red Banner": { family: "happyvalley_banner", canonical: "decor_happyvalley_banner_red", envRole: "banner", variant: "red", decorRole: "banner" },
  "Flag": { family: "happyvalley_banner", canonical: "decor_happyvalley_flag", envRole: "flag", variant: "default", decorRole: "flag" },
  "Bushes Small": { family: "happyvalley_bush", canonical: "decor_happyvalley_bush_small", envRole: "bush", size: "small", variant: "small", decorRole: "vegetation" },
  "Bushes Medium": { family: "happyvalley_bush", canonical: "decor_happyvalley_bush_medium", envRole: "bush", size: "medium", variant: "medium", decorRole: "vegetation" },
  "Bushes Large": { family: "happyvalley_bush", canonical: "decor_happyvalley_bush_large", envRole: "bush", size: "large", variant: "large", decorRole: "vegetation" },
  "Tree Small": { family: "happyvalley_tree", canonical: "decor_happyvalley_tree_small", envRole: "tree", treeRole: "standing", size: "small" },
  "Tree Medium": { family: "happyvalley_tree", canonical: "decor_happyvalley_tree_medium", envRole: "tree", treeRole: "standing", size: "medium" },
  "Tree Large": { family: "happyvalley_tree", canonical: "decor_happyvalley_tree_large", envRole: "tree", treeRole: "standing", size: "large" },
  "Tree Stump Short": { family: "happyvalley_tree", canonical: "decor_happyvalley_tree_stump_short", envRole: "stump", treeRole: "stump", size: "short" },
  "Tree Stump Tall": { family: "happyvalley_tree", canonical: "decor_happyvalley_tree_stump_tall", envRole: "stump", treeRole: "stump", size: "tall" },
  "Rock 01": { family: "happyvalley_rock", canonical: "decor_happyvalley_rock_01", envRole: "rock", variant: "01", decorRole: "stone" },
  "Rock 02": { family: "happyvalley_rock", canonical: "decor_happyvalley_rock_02", envRole: "rock", variant: "02", decorRole: "stone" },
  "Rock 03": { family: "happyvalley_rock", canonical: "decor_happyvalley_rock_03", envRole: "rock", variant: "03", decorRole: "stone" },
  "Rock 04": { family: "happyvalley_rock", canonical: "decor_happyvalley_rock_04", envRole: "rock", variant: "04", decorRole: "stone" },
  "Rock 05": { family: "happyvalley_rock", canonical: "decor_happyvalley_rock_05", envRole: "rock", variant: "05", decorRole: "stone" },
  "House": { family: "happyvalley_building", canonical: "building_happyvalley_house", envRole: "house", structureType: "residence" },
  "Windmill": { family: "happyvalley_building", canonical: "building_happyvalley_windmill", envRole: "windmill", structureType: "utility" },
  "Castle Round": { family: "happyvalley_fortification", canonical: "building_happyvalley_castle_round", envRole: "castle", variant: "round" },
  "Castle Square": { family: "happyvalley_fortification", canonical: "building_happyvalley_castle_square", envRole: "castle", variant: "square" },
  "Watchtower Short": { family: "happyvalley_fortification", canonical: "building_happyvalley_watchtower_short", envRole: "watchtower", size: "short", variant: "short" },
  "Watchtower Tall": { family: "happyvalley_fortification", canonical: "building_happyvalley_watchtower_tall", envRole: "watchtower", size: "tall", variant: "tall" },
  "Magic Stone Tower": { family: "happyvalley_magic_landmark", canonical: "landmark_happyvalley_magic_stone_tower", envRole: "magic-tower" },
  "Campfire": { family: "happyvalley_camp", canonical: "decor_happyvalley_campfire", envRole: "campfire" },
  "Tent": { family: "happyvalley_camp", canonical: "decor_happyvalley_tent", envRole: "tent" },
  "Treasure Chest": { family: "happyvalley_interactable", canonical: "decor_happyvalley_treasure_chest", envRole: "treasure-chest" },
  "Well": { family: "happyvalley_interactable", canonical: "decor_happyvalley_well", envRole: "well" },
  "Wooden Barrel": { family: "happyvalley_woodwork", canonical: "decor_happyvalley_wood_barrel", envRole: "barrel", objectRole: "barrel" },
  "Wooden Bridge Horizontal": { family: "happyvalley_woodwork", canonical: "structure_happyvalley_wood_bridge_horizontal", envRole: "bridge", objectRole: "bridge", orientation: "horizontal" },
  "Wooden Bridge Vertical": { family: "happyvalley_woodwork", canonical: "structure_happyvalley_wood_bridge_vertical", envRole: "bridge", objectRole: "bridge", orientation: "vertical" },
  "Wooden Cart": { family: "happyvalley_woodwork", canonical: "decor_happyvalley_wood_cart", envRole: "cart", objectRole: "cart" },
  "Wooden Fence Horizontal": { family: "happyvalley_woodwork", canonical: "structure_happyvalley_wood_fence_horizontal", envRole: "fence", objectRole: "fence", orientation: "horizontal" },
  "Wooden Fence Vertical": { family: "happyvalley_woodwork", canonical: "structure_happyvalley_wood_fence_vertical", envRole: "fence", objectRole: "fence", orientation: "vertical" },
};

const FAMILY_META = {
  happyvalley_ground_dirt_grass: {
    suggestedFamilyName: "HappyValley Dirt & Grass Terrain Kit",
    envFamilyType: "terrain",
    terrainRole: "autotile-kit",
    tileMode: "autotile",
    walkable: true,
    collision: "none",
    worldRole: "SHARED_1_20",
    topology: "needs-verification",
    recommendedUses: ["Happy Valley ground", "grass clearings", "dirt paths", "terrain transitions", "village outskirts"],
    notes: "56-tile grass + dirt/path autotile kit (all 256x256): dirt interiors, grass interiors, straight boundaries, inside/outside corners, narrow corridors, bends, and compound transition pieces. Ground 14/23 are dirt-only base tiles and Ground 43/52 are grass-only base tiles (confirmed by audit); the remaining 52 tiles keep per-tile roles NEEDS-VERIFICATION until an alpha-silhouette topology pass (like Clover ground) assigns edge/corner/corridor compass roles — not guessed. Visually similar numbered pieces are TRUE VARIANTS, kept for breaking repetition. Locked 2026-08-15.",
  },
  happyvalley_bush: {
    suggestedFamilyName: "HappyValley Bushes",
    envFamilyType: "bush",
    decorRole: "vegetation",
    placementMode: "manual",
    collision: "small-footprint",
    walkable: false,
    worldRole: "SHARED_1_20",
    recommendedUses: ["ground cover", "garden edges", "pathside planting", "Happy Valley greenery"],
    notes: "Three standalone rounded bush sizes (small/medium/large). Placement mode manual; collision is a recommended profile, map-controlled. Locked 2026-08-15.",
  },
  happyvalley_tree: {
    suggestedFamilyName: "HappyValley Trees & Stumps",
    envFamilyType: "tree",
    collision: "trunk-footprint",
    walkable: false,
    worldRole: "SHARED_1_20",
    recommendedUses: ["woodland", "village shade trees", "camp edges", "Happy Valley treeline"],
    notes: "Three standing tree sizes (small/medium/large) + short/tall stumps. treeRole standing | stump; size encodes both. Anchor bottom-center (2.5D: walk behind canopy, not through trunk). Locked 2026-08-15.",
  },
  happyvalley_rock: {
    suggestedFamilyName: "HappyValley Rocks",
    envFamilyType: "rock",
    decorRole: "stone",
    placementMode: "manual",
    collision: "small-footprint",
    walkable: false,
    worldRole: "SHARED_1_20",
    recommendedUses: ["ground scatter", "terrain dressing", "path edges", "camp perimeter"],
    notes: "Five stone variants (01-05) — shape as variant, no invented directional semantics. Collision is a recommended profile; tiny variants may be collision-free at map level. Locked 2026-08-15.",
  },
  happyvalley_banner: {
    suggestedFamilyName: "HappyValley Banners & Flag",
    envFamilyType: "banner",
    decorRole: "banner",
    placementMode: "manual",
    collision: "small-footprint",
    walkable: false,
    worldRole: "SHARED_1_20",
    recommendedUses: ["castle banners", "camp markers", "festival decorations", "Happy Valley landmarks"],
    notes: "Blue banner (160x240), red banner (160x240), and flag (100x160). variant blue | red | default. Locked 2026-08-15.",
  },
  happyvalley_building: {
    suggestedFamilyName: "HappyValley Buildings",
    envFamilyType: "building",
    collision: "building-footprint",
    walkable: false,
    worldRole: "PVE_1_20",
    recommendedUses: ["Happy Valley house", "windmill landmark", "PvE settlement structures"],
    notes: "Two complete structures: house and windmill. Canonical identity is visual; game-world assignment (which building is what) stays separate. Locked 2026-08-15.",
  },
  happyvalley_fortification: {
    suggestedFamilyName: "HappyValley Fortifications",
    envFamilyType: "fortification",
    collision: "building-footprint",
    walkable: false,
    worldRole: "PVE_1_20",
    recommendedUses: ["castle layouts", "watchtowers", "PvE camp defenses", "Happy Valley strongholds"],
    notes: "Two castle forms (round/square) + short/tall watchtowers. The short watchtower is a raised wooden platform with ladder — structure system, not decor. Locked 2026-08-15.",
  },
  happyvalley_magic_landmark: {
    suggestedFamilyName: "HappyValley Magic Landmark",
    envFamilyType: "landmark",
    collision: "building-footprint",
    walkable: false,
    worldRole: "PVE_1_20",
    recommendedUses: ["quest landmark", "magic site", "dungeon approach", "Happy Valley special location"],
    notes: "Single magic stone tower. Preserve the supplied magic_stone_tower identity rather than guessing its mechanical role. Locked 2026-08-15.",
  },
  happyvalley_camp: {
    suggestedFamilyName: "HappyValley Camp",
    envFamilyType: "camp",
    collision: "object-footprint",
    walkable: false,
    worldRole: "PVE_1_20",
    recommendedUses: ["PvE campsites", "rest points", "merchant camps", "quest camps"],
    notes: "Campfire + tent. Locked 2026-08-15.",
  },
  happyvalley_interactable: {
    suggestedFamilyName: "HappyValley Interactables",
    envFamilyType: "interactable",
    collision: "object-footprint",
    walkable: false,
    worldRole: "PVE_1_20",
    recommendedUses: ["treasure locations", "well/rest point", "quest objects", "reward spots"],
    notes: "Treasure chest and well. Treasure chest gets an interactable-style role rather than ordinary scenery — actual gameplay interaction is a separate system. Locked 2026-08-15.",
  },
  happyvalley_woodwork: {
    suggestedFamilyName: "HappyValley Woodwork",
    envFamilyType: "woodwork",
    collision: "object-footprint",
    walkable: false,
    worldRole: "SHARED_1_20",
    recommendedUses: ["barrels/crates", "bridges", "carts", "fences", "village infrastructure"],
    notes: "Barrel, horizontal/vertical bridges, cart, horizontal/vertical fences. objectRole barrel | bridge | cart | fence; orientation is source-confirmed (horizontal/vertical) so it is safe canonical metadata. Bridges are walkable at map level. Locked 2026-08-15.",
  },
  happyvalley_source: {
    suggestedFamilyName: "HappyValley Simple Summer Masters",
    envFamilyType: "source",
    sourceRole: "master-tileset",
    collision: "none",
    walkable: false,
    worldRole: "SHARED_1_20",
    notes: "Master authoring files for the entire HappyValley environment pack (Top-Down Simple Summer .ai + master .eps). .ai / .eps are FORMATS, not asset families. Kept for provenance; never runtime-eligible or placeable. Locked 2026-08-15.",
  },
};

function parseName(fileName) {
  // "Top-Down Simple Summer_Ground 01.png" -> { kind: "ground", n: 1 }
  // "Top-Down Simple Summer_Prop - House.png" / "_prop - Tree Large.png" -> { kind: "prop", name: "House" }
  // "Top-Down Simple Summer.eps" -> { kind: "master", name: "Top-Down Simple Summer" }
  const base = fileName.replace(/\.(png|eps|ai)$/i, "");
  const ground = base.match(/_Ground (\d+)$/i);
  if (ground) return { kind: "ground", n: parseInt(ground[1], 10) };
  const prop = base.match(/_(?:Prop|prop) - (.+)$/);
  if (prop) return { kind: "prop", name: prop[1] };
  if (/^Top-Down Simple Summer$/.test(base)) return { kind: "master" };
  return { kind: "other" };
}

function classify(rel, file) {
  const fileName = rel.split("/").pop();
  const parsed = parseName(fileName);
  const ext = file.extension;
  const base = { placeable: false, reviewStatus: "reviewed", runtimeStatus: "reference-only" };

  if (parsed.kind === "ground") {
    const n = parsed.n;
    const label = String(n).padStart(2, "0");
    const canonical = `ground_happyvalley_dirt_grass_${label}`;
    if (ext === ".png") {
      // Ground 14/23 = dirt-only base tiles, 43/52 = grass-only base tiles (audit-confirmed).
      const terrainRole = n === 14 || n === 23 ? "base-dirt" : n === 43 || n === 52 ? "base-grass" : "autotile";
      const famMeta = FAMILY_META.happyvalley_ground_dirt_grass;
      return {
        family: "happyvalley_ground_dirt_grass",
        asset: {
          ...base,
          assetRole: "terrain-tile",
          envRole: "terrain-tile",
          envFamilyType: famMeta.envFamilyType,
          terrainRole,
          tileMode: famMeta.tileMode,
          topology: famMeta.topology,
          walkable: famMeta.walkable,
          collision: famMeta.collision,
          worldRole: famMeta.worldRole,
          runtimeEligible: true,
          placeable: true,
          displayName: `HappyValley dirt & grass tile ${label}`,
          canonicalName: canonical,
          renameStatus: "keep",
          description: `Dirt + grass terrain tile ${label} (${file.width}x${file.height}). ${terrainRole === "base-dirt" ? "Dirt-only base texture." : terrainRole === "base-grass" ? "Grass-only base texture." : "Autotile connectivity tile (role needs topology verification)."}`,
        },
      };
    }
    return {
      family: "happyvalley_ground_dirt_grass",
      asset: {
        ...base,
        assetRole: "authoring-source",
        sourceRole: "authoring-frame",
        format: "eps",
        envRole: "terrain-tile",
        envFamilyType: FAMILY_META.happyvalley_ground_dirt_grass.envFamilyType,
        sourceOf: `ground_happyvalley_dirt_grass_${label}`,
        runtimeEligible: false,
        displayName: `terrain tile ${label} EPS source`,
        canonicalName: `source_happyvalley_ground_${label}_eps`,
        renameStatus: "keep",
        description: `EPS authoring source for terrain tile ${label} (source of ground_happyvalley_dirt_grass_${label}).`,
      },
    };
  }

  if (parsed.kind === "prop") {
    const meta = PROPS[parsed.name];
    if (!meta) return null;
    const famMeta = FAMILY_META[meta.family];
    if (ext === ".png") {
      const bits = [meta.envRole.replace(/-/g, " ")];
      if (meta.size) bits.push(meta.size);
      if (meta.orientation) bits.push(meta.orientation);
      return {
        family: meta.family,
        asset: {
          ...base,
          assetRole: "decor",
          envRole: meta.envRole,
          envFamilyType: famMeta.envFamilyType,
          variant: meta.variant ?? null,
          size: meta.size ?? null,
          treeRole: meta.treeRole ?? null,
          objectRole: meta.objectRole ?? null,
          orientation: meta.orientation ?? null,
          decorRole: meta.decorRole ?? null,
          structureType: meta.structureType ?? null,
          placementMode: famMeta.placementMode ?? null,
          walkable: meta.envRole === "bridge" ? true : famMeta.walkable,
          collision: famMeta.collision,
          worldRole: famMeta.worldRole,
          runtimeEligible: true,
          placeable: true,
          displayName: `HappyValley ${bits.join(" ")}`,
          canonicalName: meta.canonical,
          renameStatus: "keep",
          description: `${bits.join(" ")} (${file.width}x${file.height}).`,
        },
      };
    }
    return {
      family: meta.family,
      asset: {
        ...base,
        assetRole: "authoring-source",
        sourceRole: "authoring-frame",
        format: "eps",
        envRole: meta.envRole,
        envFamilyType: famMeta.envFamilyType,
        sourceOf: meta.canonical,
        runtimeEligible: false,
        displayName: `${meta.envRole.replace(/-/g, " ")} EPS source`,
        canonicalName: `source_happyvalley_${meta.canonical.replace(/^(building|landmark|structure|decor)_/, "").replace(/_/g, "_")}_eps`,
        renameStatus: "keep",
        description: `EPS authoring source for ${meta.canonical}.`,
      },
    };
  }

  if (parsed.kind === "master") {
    const isAi = ext === ".ai";
    return {
      family: "happyvalley_source",
      asset: {
        ...base,
        assetRole: "authoring-master",
        sourceRole: "master-tileset",
        format: isAi ? "illustrator" : "eps",
        envFamilyType: "source",
        runtimeEligible: false,
        displayName: isAi ? "Top-Down Simple Summer Illustrator master" : "Top-Down Simple Summer master EPS",
        canonicalName: isAi ? "source_happyvalley_simple_summer_master_ai" : "source_happyvalley_simple_summer_master_eps",
        renameStatus: "keep",
        description: `Master authoring file for the entire HappyValley environment pack (${isAi ? "Illustrator" : "EPS"}).`,
      },
    };
  }

  return null;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));

  // Idempotent: remove previous HappyValley review families.
  for (const key of Object.keys(reviews.reviews)) {
    if (key.startsWith(`${PACK}/`)) delete reviews.reviews[key];
  }

  const files = inventory.files.filter((f) => f.path.startsWith(PREFIX));
  const byFamily = {};
  let unclassified = 0;
  for (const f of files) {
    const rel = f.path.slice(PREFIX.length);
    const result = classify(rel, f);
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
      envFamilyType: meta.envFamilyType,
      terrainRole: meta.terrainRole ?? null,
      tileMode: meta.tileMode ?? null,
      decorRole: meta.decorRole ?? null,
      placementMode: meta.placementMode ?? null,
      sourceRole: meta.sourceRole ?? null,
      topology: meta.topology ?? null,
      walkable: meta.walkable,
      collision: meta.collision,
      worldRole: meta.worldRole,
      recommendedUses: meta.recommendedUses ?? [],
      notes: meta.notes,
      assets,
    };
  }

  const counts = Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, Object.keys(v).length]));
  const classified = files.length - unclassified;
  console.log(`[happyvalley-env] ${classified}/${files.length} classified (${unclassified} unclassified)`);
  console.log(JSON.stringify(counts, null, 1));

  const png = files.filter((f) => f.extension === ".png").length;
  const eps = files.filter((f) => f.extension === ".eps").length;
  const ai = files.filter((f) => f.extension === ".ai").length;
  console.log(`PNG ${png} · EPS ${eps} · AI ${ai}`);

  reviews.generatedAt = new Date().toISOString();
  await writeFile(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
  console.log("reviews written:", reviewsPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
