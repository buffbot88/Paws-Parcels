#!/usr/bin/env node
// Replaces the decor families in design/assets/asset-reviews.json with
// ChatGPT's FINAL 8-family taxonomy. Old family keys are removed.
import { readFile, writeFile } from "node:fs/promises";

const path = "design/assets/asset-reviews.json";
const data = JSON.parse(await readFile(path, "utf8"));

// Remove previous decor family keys
for (const k of Object.keys(data.reviews)) {
  if (["village_utility_props", "containers_storage", "woodland_landmarks", "construction_natural_materials", "clover_greenery", "mossy_stones", "tropical_tree_upright", "tropical_tree_leaning"].includes(k.split("/")[1])) {
    delete data.reviews[k];
  }
}

const D = (file, extra) => ({
  assetRole: "decor",
  decorRole: extra.decorRole,
  placementMode: "manual",
  topology: "standalone",
  variant: extra.variant ?? null,
  worldRole: extra.worldRole ?? "SHARED_1_20",
  walkable: extra.walkable ?? true,
  collision: extra.collision ?? "none",
  depthMode: extra.depthMode ?? "object",
  density: extra.density ?? "normal",
  anchor: "bottom-center",
  canonicalName: extra.canonicalName,
  displayName: extra.displayName,
  runtimeStatus: extra.runtime ?? "reference",
  reviewStatus: "reviewed",
  description: extra.description,
  recommendedUses: extra.uses ?? [],
  renameStatus: "rename",
});

// --- 1. village_container (7): basins, bowls, vessels, barrel, crate ---
const village_container = {
  familyKey: "village_container",
  canonicalFamily: "village_container",
  suggestedFamilyName: "Village Containers",
  decorRole: "container",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "footprint",
  depthMode: "object",
  notes: "Bowls, basins, trough, vessel, barrel, bin — everyday containers that make the settlement look lived-in. Locked 2026-08-15.",
  assets: {
    "decor/decor_2.png": D("decor_2.png", { decorRole: "basin", canonicalName: "decor_village_wood_basin_large", displayName: "Large Wooden Basin", collision: "footprint", density: "normal", description: "Shallow round wooden basin/tray." }),
    "decor/decor_5.png": D("decor_5.png", { decorRole: "bowl", canonicalName: "decor_village_wood_bowl", displayName: "Wooden Bowl", collision: "none", density: "frequent", description: "Small round wooden bowl." }),
    "decor/decor_10.png": D("decor_10.png", { decorRole: "trough", canonicalName: "decor_village_stone_trough", displayName: "Stone Trough", collision: "footprint", density: "normal", description: "Long dark stone trough/basin.", uses: ["planter", "water trough", "feeding trough", "garden container"] }),
    "decor/decor_11.png": D("decor_11.png", { decorRole: "dish", canonicalName: "decor_village_stone_dish", displayName: "Stone Dish", collision: "none", density: "frequent", description: "Tiny dark dish/bowl." }),
    "decor/decor_16.png": D("decor_16.png", { decorRole: "vessel", canonicalName: "decor_village_storage_jar", displayName: "Storage Jar", collision: "footprint", density: "normal", description: "Large rounded storage vessel/jar." }),
    "decor/decor_17.png": D("decor_17.png", { decorRole: "barrel", canonicalName: "decor_village_barrel", displayName: "Barrel", collision: "footprint", density: "normal", description: "Small wooden barrel." }),
    "decor/decor_18.png": D("decor_18.png", { decorRole: "bin", canonicalName: "decor_village_wood_bin", displayName: "Wooden Bin", collision: "footprint", density: "normal", description: "Small wooden crate/bin." }),
  },
};

// --- 2. village_woodwork (4): stump, logs, cart ---
const village_woodwork = {
  familyKey: "village_woodwork",
  canonicalFamily: "village_woodwork",
  suggestedFamilyName: "Village Woodwork",
  decorRole: "timber",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "none",
  depthMode: "object",
  notes: "Stump, curved log, straight beam, handcart. Locked 2026-08-15.",
  assets: {
    "decor/decor_3.png": D("decor_3.png", { decorRole: "stump", canonicalName: "decor_village_tree_stump", displayName: "Tree Stump", collision: "footprint", density: "normal", description: "Small vine-covered tree stump." }),
    "decor/decor_12.png": D("decor_12.png", { decorRole: "timber", canonicalName: "decor_village_curved_log", displayName: "Curved Log", collision: "none", density: "normal", description: "Long curved timber/log." }),
    "decor/decor_13.png": D("decor_13.png", { decorRole: "timber", canonicalName: "decor_village_log_beam", displayName: "Log Beam", collision: "none", density: "normal", description: "Long straight timber/log beam." }),
    "decor/decor_14.png": D("decor_14.png", { decorRole: "cart", canonicalName: "decor_village_handcart", displayName: "Handcart", collision: "footprint", depthMode: "object", density: "sparse", worldRole: "CLOVER_SAFE", description: "Small wooden two-wheel cart.", uses: ["parcels", "mail sacks", "market deliveries", "loading bay", "shop frontage", "environmental storytelling"] }),
  },
};

// --- 3. village_signage (2): sign + notice board ---
const village_signage = {
  familyKey: "village_signage",
  canonicalFamily: "village_signage",
  suggestedFamilyName: "Village Signage",
  decorRole: "sign",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "footprint",
  depthMode: "tall-object",
  notes: "Mossy sign + notice board. Locked 2026-08-15.",
  assets: {
    "decor/decor_4.png": D("decor_4.png", { decorRole: "sign", canonicalName: "decor_village_sign_mossy", displayName: "Mossy Sign", collision: "footprint", depthMode: "tall-object", density: "sparse", description: "Moss-covered wooden hanging/post sign.", uses: ["directional signs", "zone names", "Happy Valley entrance", "shop signs", "courier routes", "tutorial navigation"] }),
    "decor/decor_9.png": D("decor_9.png", { decorRole: "board", canonicalName: "decor_village_notice_board", displayName: "Notice Board", collision: "footprint", depthMode: "object", density: "sparse", worldRole: "CLOVER_SAFE", description: "Large blank framed notice board.", uses: ["quest board", "community notices", "delivery board", "event notices"] }),
  },
};

// --- 4. village_landmark (4): torch, fire ring, idol, spring ---
const village_landmark = {
  familyKey: "village_landmark",
  canonicalFamily: "village_landmark",
  suggestedFamilyName: "Village Landmarks",
  decorRole: "landmark",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "footprint",
  depthMode: "tall-object",
  notes: "Torch (light source), fire ring, carved stone idol, stone spring. Locked 2026-08-15.",
  assets: {
    "decor/decor_1.png": D("decor_1.png", { decorRole: "light-source", canonicalName: "decor_village_torch", displayName: "Village Torch", collision: "small-footprint", depthMode: "tall-object", density: "sparse", description: "Freestanding burning torch on a tall post.", uses: ["path lighting", "Courier Square perimeter", "building entrances", "bridges", "wilderness waypoints"] }),
    "decor/decor_6.png": D("decor_6.png", { decorRole: "fire-pit", canonicalName: "decor_village_fire_ring", displayName: "Fire Ring", collision: "none", depthMode: "ground", density: "normal", description: "Circular stone fire ring.", uses: ["campfire base", "campsite", "outdoor cooking", "boundary ring"] }),
    "decor/decor_7.png": D("decor_7.png", { decorRole: "monument", canonicalName: "decor_village_stone_idol", displayName: "Stone Idol", collision: "footprint", depthMode: "tall-object", density: "sparse", worldRole: "PVE_1_20", description: "Carved stone face/idol, vine-covered.", uses: ["ancient forest landmark", "quest location", "hidden shrine", "Happy Valley ruin", "lore point", "dungeon approach"] }),
    "decor/decor_8.png": D("decor_8.png", { decorRole: "water-feature", canonicalName: "decor_village_stone_spring", displayName: "Stone Spring", collision: "footprint", depthMode: "object", density: "sparse", description: "Water-filled carved stone basin/spring with bright blue water.", uses: ["village spring", "garden centerpiece", "magical healing spring", "wilderness rest area", "quest landmark"] }),
  },
};

// --- 5. village_market (1): produce display ---
const village_market = {
  familyKey: "village_market",
  canonicalFamily: "village_market",
  suggestedFamilyName: "Village Market",
  decorRole: "produce-display",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "CLOVER_SAFE",
  collision: "footprint",
  depthMode: "object",
  notes: "Produce display stand. Locked 2026-08-15.",
  assets: {
    "decor/decor_15.png": D("decor_15.png", { decorRole: "produce-display", canonicalName: "decor_village_produce_stand", displayName: "Produce Stand", collision: "footprint", density: "sparse", description: "Wooden display piled with round produce." }),
  },
};

// --- 6. clover_greenery (5): standalone plants, variants a/b ---
const clover_greenery = {
  familyKey: "clover_greenery",
  canonicalFamily: "clover_greenery",
  suggestedFamilyName: "Clover Greenery",
  decorRole: "vegetation",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "none",
  depthMode: "ground",
  notes: "Five distinct plant silhouettes — NOT interchangeable. Visual identity and collision are separate concerns: no collision on decorative plants. Locked 2026-08-15.",
  assets: {
    "decor/greenery_1.png": D("greenery_1.png", { decorRole: "flowering-plant", variant: "a", runtime: "runtime", density: "frequent", canonicalName: "decor_clover_flowering_stalk", displayName: "Flowering Stalk", description: "Tall flowering plant with tiny blue flowers." }),
    "decor/greenery_2.png": D("greenery_2.png", { decorRole: "broadleaf", variant: "a", runtime: "runtime", density: "frequent", canonicalName: "decor_clover_broadleaf_plant", displayName: "Broadleaf Plant", description: "Broad pointed-leaf rosette plant." }),
    "decor/greenery_3.png": D("greenery_3.png", { decorRole: "fern", variant: "a", runtime: "runtime", density: "frequent", canonicalName: "decor_clover_fern", displayName: "Clover Fern", description: "Branching bright-green fern." }),
    "decor/greenery_4.png": D("greenery_4.png", { decorRole: "grass", variant: "a", density: "frequent", canonicalName: "decor_clover_grass_tuft", displayName: "Grass Tuft", description: "Dense upright tuft of long grass blades." }),
    "decor/greenery_5.png": D("greenery_5.png", { decorRole: "broadleaf", variant: "b", density: "normal", canonicalName: "decor_clover_drooping_plant", displayName: "Drooping Plant", description: "Small drooping broadleaf bush/plant." }),
  },
};

// --- 7. clover_stone (7): one rock family, A-G shape variants ---
const clover_stone = {
  familyKey: "clover_stone",
  canonicalFamily: "clover_stone",
  suggestedFamilyName: "Clover Stones",
  decorRole: "stone",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SHARED_1_20",
  collision: "none",
  depthMode: "object",
  notes: "One coherent rock family, seven shape variants encoded as A-G (no topology meaning). Collision is a recommended profile — map-controlled, not hardcoded. Locked 2026-08-15.",
  assets: {
    "decor/stones_1.png": D("stones_1.png", { decorRole: "stone", variant: "a", runtime: "runtime", collision: "small-footprint", density: "normal", canonicalName: "decor_clover_stone_a", displayName: "Clover Stone A", description: "Rounded-small mossy stone." }),
    "decor/stones_2.png": D("stones_2.png", { decorRole: "stone", variant: "b", runtime: "runtime", collision: "small-footprint", density: "normal", canonicalName: "decor_clover_stone_b", displayName: "Clover Stone B", description: "Upright-irregular mossy stone." }),
    "decor/stones_3.png": D("stones_3.png", { decorRole: "stone", variant: "c", runtime: "runtime", collision: "footprint", density: "sparse", canonicalName: "decor_clover_stone_c", displayName: "Clover Stone C", description: "Rounded-large mossy stone." }),
    "decor/stones_4.png": D("stones_4.png", { decorRole: "stone", variant: "d", collision: "footprint", density: "sparse", canonicalName: "decor_clover_stone_d", displayName: "Clover Stone D", description: "Elongated mossy stone." }),
    "decor/stones_5.png": D("stones_5.png", { decorRole: "stone", variant: "e", collision: "footprint", density: "sparse", canonicalName: "decor_clover_stone_e", displayName: "Clover Stone E", description: "Upright-rounded mossy stone." }),
    "decor/stones_6.png": D("stones_6.png", { decorRole: "stone", variant: "f", collision: "none", density: "frequent", canonicalName: "decor_clover_stone_f", displayName: "Clover Stone F", description: "Pebble-small mossy stone." }),
    "decor/stones_7.png": D("stones_7.png", { decorRole: "stone", variant: "g", collision: "footprint", density: "sparse", canonicalName: "decor_clover_stone_g", displayName: "Clover Stone G", description: "Jagged mossy stone." }),
  },
};

// --- 8. clover_palm (2): upright + leaning ---
const clover_palm = {
  familyKey: "clover_palm",
  canonicalFamily: "clover_palm",
  suggestedFamilyName: "Clover Palms",
  decorRole: "tree",
  placementMode: "manual",
  topology: "standalone",
  worldRole: "SPECIAL_USE",
  collision: "trunk-footprint",
  depthMode: "tall-object",
  notes: "Both palms are SPECIAL_USE — sourcePack and worldRole remain separate. Not default Clover vegetation. Locked 2026-08-15.",
  assets: {
    "decor/tree_1.png": D("tree_1.png", { decorRole: "tree", variant: "upright", runtime: "runtime", collision: "trunk-footprint", depthMode: "tall-object", density: "sparse", worldRole: "SPECIAL_USE", canonicalName: "decor_clover_palm_upright", displayName: "Upright Palm", description: "Tall upright palm with broad dark-green canopy and segmented brown trunk.", uses: ["micro-biome", "greenhouse", "magical garden", "southern transition", "water feature", "future warmer region"] }),
    "decor/tree_2.png": D("tree_2.png", { decorRole: "tree", variant: "leaning", runtime: "runtime", collision: "trunk-footprint", depthMode: "tall-object", density: "sparse", worldRole: "SPECIAL_USE", canonicalName: "decor_clover_palm_leaning", displayName: "Leaning Palm", description: "Strongly leaning palm with lighter olive-green canopy.", uses: ["micro-biome", "greenhouse", "magical garden", "southern transition", "water feature", "future warmer region"] }),
  },
};

for (const [key, fam] of Object.entries({
  village_container, village_woodwork, village_signage, village_landmark, village_market, clover_greenery, clover_stone, clover_palm,
})) {
  data.reviews[`CloverVillage/${key}`] = fam;
}

await writeFile(path, JSON.stringify(data, null, 2), "utf8");
console.log("Replaced decor with final 8-family taxonomy");
