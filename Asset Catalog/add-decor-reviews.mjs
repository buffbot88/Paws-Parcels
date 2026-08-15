#!/usr/bin/env node
// Adds the 8 semantic Clover Village decor families to design/assets/asset-reviews.json
import { readFile, writeFile } from "node:fs/promises";

const path = "design/assets/asset-reviews.json";
const data = JSON.parse(await readFile(path, "utf8"));

const D = (file, extra) => ({
  assetRole: "decor",
  decorRole: extra.decorRole,
  placementRole: extra.placementRole,
  worldRole: extra.worldRole,
  collision: extra.collision,
  depthMode: extra.depthMode,
  density: extra.density ?? "normal",
  anchor: "bottom-center",
  canonicalName: extra.canonicalName,
  displayName: extra.displayName,
  runtimeStatus: extra.runtime ?? "reference",
  reviewStatus: "reviewed",
  description: extra.description,
  recommendedUses: extra.uses ?? [],
  subtype: extra.subtype ?? null,
  renameStatus: "rename",
});

// --- 1. Village Utility Props (decor 1, 2, 4, 9, 14) ---
const village_utility_props = {
  familyKey: "village_utility_props",
  canonicalFamily: "village_utility_props",
  suggestedFamilyName: "Village Utility Props",
  decorRole: "utility",
  worldRole: "CLOVER_SAFE",
  collision: "small-footprint",
  depthMode: "object",
  placementRole: "path-adjacent",
  notes: "Functional village objects — the strongest pieces for making Clover Village look like somewhere animals actually live and work. Includes torch post, basin, moss signboard, notice board, handcart. Locked 2026-08-15.",
  assets: {
    "decor/decor_1.png": D("decor_1.png", {
      decorRole: "utility", placementRole: "path-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "tall-object", density: "sparse",
      canonicalName: "prop_wooden_torch_post_01", displayName: "Wooden Torch Post",
      description: "Tall segmented wooden post topped by a shallow orange-red torch or brazier bowl. Not named lamp — the image does not establish whether the bowl emits light.",
      uses: ["path lighting", "Courier Square perimeter", "building entrances", "bridges", "wilderness waypoints"],
    }),
    "decor/decor_2.png": D("decor_2.png", {
      decorRole: "utility", placementRole: "path-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_wooden_basin_round_01", displayName: "Wooden Basin",
      description: "Broad shallow circular wooden basin/tray. Function intentionally generic.",
      uses: ["animal water bowl", "washing basin", "planter base", "crafting prop", "market prop"],
    }),
    "decor/decor_4.png": D("decor_4.png", {
      decorRole: "signage", placementRole: "path-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "tall-object", density: "sparse",
      canonicalName: "prop_signboard_wood_moss_01", displayName: "Moss-Roof Wooden Sign",
      description: "Freestanding wooden signboard with a thick mossy/green top and single support post. High-priority asset.",
      uses: ["directional signs", "zone names", "Happy Valley entrance", "shop signs", "courier routes", "tutorial navigation"],
    }),
    "decor/decor_9.png": D("decor_9.png", {
      decorRole: "signage", placementRole: "building-adjacent", worldRole: "CLOVER_SAFE",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      canonicalName: "prop_notice_board_wood_01", displayName: "Framed Notice Board",
      description: "Rectangular pale notice/sign surface surrounded by dark timber framing. Shortlist for Courier Quest Board — but canonical identity stays notice board, not quest_board.",
      uses: ["quest board", "community notices", "delivery board", "event notices"],
    }),
    "decor/decor_14.png": D("decor_14.png", {
      decorRole: "utility", placementRole: "path-adjacent", worldRole: "CLOVER_SAFE",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      canonicalName: "prop_handcart_wood_single_wheel_01", displayName: "Wooden Handcart",
      description: "Small single-wheel wooden handcart with two handles. High-value courier asset.",
      uses: ["parcels", "mail sacks", "market deliveries", "loading bay", "shop frontage", "environmental storytelling"],
    }),
  },
};

// --- 2. Containers & Storage (decor 5, 10, 11, 16, 17, 18) ---
const containers_storage = {
  familyKey: "containers_storage",
  canonicalFamily: "containers_storage",
  suggestedFamilyName: "Containers & Storage",
  decorRole: "container",
  worldRole: "SHARED_1_20",
  collision: "small-footprint",
  depthMode: "object",
  placementRole: "building-adjacent",
  notes: "Pots, vessels and storage — one catalog family with individual semantic types. Prevents settlements from looking like buildings dropped on an empty lawn. Locked 2026-08-15.",
  assets: {
    "decor/decor_5.png": D("decor_5.png", {
      decorRole: "container", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "frequent",
      canonicalName: "prop_bowl_round_brown_01", displayName: "Round Brown Bowl",
      description: "Small round brown clay/wooden bowl or pot.",
    }),
    "decor/decor_10.png": D("decor_10.png", {
      decorRole: "container", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_trough_dark_01", displayName: "Dark Trough",
      description: "Large elongated dark gray/blue trough or planter.",
      uses: ["planter", "water trough", "feeding trough", "garden container"],
    }),
    "decor/decor_11.png": D("decor_11.png", {
      decorRole: "container", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "frequent",
      canonicalName: "prop_bowl_shallow_dark_01", displayName: "Shallow Dark Bowl",
      description: "Small shallow dark bowl.",
    }),
    "decor/decor_16.png": D("decor_16.png", {
      decorRole: "container", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_vessel_earthen_large_01", displayName: "Large Earthen Vessel",
      description: "Large bulbous earthenware vessel with narrow opening.",
    }),
    "decor/decor_17.png": D("decor_17.png", {
      decorRole: "storage", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_barrel_wood_small_01", displayName: "Small Wooden Barrel",
      description: "Small round wooden barrel with metal/dark banding.",
    }),
    "decor/decor_18.png": D("decor_18.png", {
      decorRole: "storage", placementRole: "building-adjacent", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_crate_wood_dark_01", displayName: "Dark Wooden Crate",
      description: "Rectangular dark wooden crate/bin-like object. Function intentionally generic.",
    }),
  },
};

// --- 3. Woodland Landmarks (decor 3, 7, 8) ---
const woodland_landmarks = {
  familyKey: "woodland_landmarks",
  canonicalFamily: "woodland_landmarks",
  suggestedFamilyName: "Woodland Landmarks",
  decorRole: "landmark",
  worldRole: "SHARED_1_20",
  collision: "object-footprint",
  depthMode: "object",
  placementRole: "landmark",
  notes: "Special-treatment pieces rather than generic decor: ivy stump, stone idol, stone spring. Locked 2026-08-15.",
  assets: {
    "decor/decor_3.png": D("decor_3.png", {
      decorRole: "natural-prop", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal",
      canonicalName: "prop_stump_ivy_small_01", displayName: "Ivy Stump",
      description: "Small cut tree stump with vines/ivy around its base. Useful everywhere.",
    }),
    "decor/decor_7.png": D("decor_7.png", {
      decorRole: "landmark", placementRole: "landmark", worldRole: "PVE_1_20",
      collision: "object-footprint", depthMode: "tall-object", density: "sparse",
      canonicalName: "landmark_stone_idol_vine_01", displayName: "Vine-Covered Stone Idol",
      description: "Tall gray carved stone face/idol covered with creeping vegetation. Not ordinary clutter — keep largely out of central Clover Village so its appearance carries significance.",
      uses: ["ancient forest landmark", "quest location", "hidden shrine", "Happy Valley ruin", "lore point", "dungeon approach"],
    }),
    "decor/decor_8.png": D("decor_8.png", {
      decorRole: "water-feature", placementRole: "landmark", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      canonicalName: "landmark_stone_spring_vine_01", displayName: "Stone Spring",
      description: "Low oval stone basin surrounded by vines, containing bright blue water with a vertical water/splash effect. Not merely a pond.",
      uses: ["village spring", "garden centerpiece", "magical healing spring", "wilderness rest area", "quest landmark"],
    }),
  },
};

// --- 4. Construction / Natural Materials (decor 6, 12, 13, 15) ---
const construction_natural_materials = {
  familyKey: "construction_natural_materials",
  canonicalFamily: "construction_natural_materials",
  suggestedFamilyName: "Construction & Natural Materials",
  decorRole: "material-pile",
  worldRole: "SHARED_1_20",
  collision: "small-footprint",
  depthMode: "object",
  placementRole: "ground-clutter",
  notes: "Stone ring, curved log, cut log, wood rack. Belong around workshops, camps, loading areas, construction, PvE camps. Locked 2026-08-15.",
  assets: {
    "decor/decor_6.png": D("decor_6.png", {
      decorRole: "natural-prop", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "ground", density: "normal",
      canonicalName: "prop_stone_ring_small_01", displayName: "Small Stone Ring",
      description: "Ring of small gray stones. Canonical identity is visual (ring), not assumed function.",
      uses: ["campfire base", "campsite", "outdoor cooking", "boundary ring"],
    }),
    "decor/decor_12.png": D("decor_12.png", {
      decorRole: "material-pile", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "ground", density: "normal",
      canonicalName: "prop_log_curved_dark_01", displayName: "Curved Dark Log",
      description: "Long curved dark log/branch.",
    }),
    "decor/decor_13.png": D("decor_13.png", {
      decorRole: "material-pile", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "ground", density: "normal",
      canonicalName: "prop_log_cut_light_01", displayName: "Cut Light Log",
      description: "Long clean-cut golden wooden log/beam.",
    }),
    "decor/decor_15.png": D("decor_15.png", {
      decorRole: "material-pile", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      canonicalName: "prop_material_pile_wood_rack_01", displayName: "Wood Rack Material Pile",
      description: "Raised timber rack/platform piled with many small orange-brown logs or round materials. Conservative name — does not assume what the round objects represent.",
    }),
  },
};

// --- 5. Clover Greenery (greenery 1-5) ---
const clover_greenery = {
  familyKey: "clover_greenery",
  canonicalFamily: "clover_greenery",
  suggestedFamilyName: "Clover Greenery",
  decorRole: "vegetation",
  worldRole: "SHARED_1_20",
  collision: "none",
  depthMode: "ground",
  placementRole: "ground-clutter",
  notes: "Five distinct vegetation species/shapes, NOT collapsed into greenery. Taller vegetation may depth-sort against player feet, but decorative grass has no collision. Locked 2026-08-15.",
  assets: {
    "decor/greenery_1.png": D("greenery_1.png", {
      decorRole: "vegetation", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "ground", density: "frequent", runtime: "runtime",
      subtype: "wildflower",
      canonicalName: "vegetation_wildflower_blue_tall_01", displayName: "Tall Blue Wildflower",
      description: "Tall thin flowering stalk with tiny blue flowers.",
    }),
    "decor/greenery_2.png": D("greenery_2.png", {
      decorRole: "vegetation", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "ground", density: "frequent", runtime: "runtime",
      subtype: "rosette",
      canonicalName: "vegetation_broadleaf_rosette_01", displayName: "Broadleaf Rosette",
      description: "Broad pointed-leaf rosette plant.",
    }),
    "decor/greenery_3.png": D("greenery_3.png", {
      decorRole: "vegetation", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "ground", density: "frequent", runtime: "runtime",
      subtype: "fern",
      canonicalName: "vegetation_fern_branching_01", displayName: "Branching Fern",
      description: "Branching bright-green fern/coral-shaped plant.",
    }),
    "decor/greenery_4.png": D("greenery_4.png", {
      decorRole: "vegetation", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "ground", density: "frequent",
      subtype: "grass-tuft",
      canonicalName: "vegetation_grass_tuft_tall_01", displayName: "Tall Grass Tuft",
      description: "Dense upright tuft of long grass blades.",
    }),
    "decor/greenery_5.png": D("greenery_5.png", {
      decorRole: "vegetation", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "ground", density: "normal",
      subtype: "leafy-bush",
      canonicalName: "vegetation_leafy_bush_small_01", displayName: "Small Leafy Bush",
      description: "Small drooping broadleaf bush/plant.",
    }),
  },
};

// --- 6. Mossy Stone Set (stones 1-7) ---
const mossy_stones = {
  familyKey: "mossy_stones",
  canonicalFamily: "mossy_stones",
  suggestedFamilyName: "Mossy Woodland Stones",
  decorRole: "stone",
  worldRole: "SHARED_1_20",
  collision: "object-footprint",
  depthMode: "object",
  placementRole: "ground-clutter",
  notes: "One coherent rock family with seven shape/size variants — pale gray stone with green vine/moss growth around the lower portion. Collision is a RECOMMENDED profile, not hardcoded physics — ultimately map-controlled. Locked 2026-08-15.",
  assets: {
    "decor/stones_1.png": D("stones_1.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal", runtime: "runtime",
      subtype: "rounded",
      canonicalName: "prop_stone_mossy_rounded_01", displayName: "Mossy Rounded Stone",
      description: "Rounded mossy woodland stone.",
    }),
    "decor/stones_2.png": D("stones_2.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "small-footprint", depthMode: "object", density: "normal", runtime: "runtime",
      subtype: "notched",
      canonicalName: "prop_stone_mossy_notched_01", displayName: "Mossy Notched Stone",
      description: "Mossy woodland stone with notched silhouette.",
    }),
    "decor/stones_3.png": D("stones_3.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse", runtime: "runtime",
      subtype: "large-boulder",
      canonicalName: "prop_stone_mossy_large_01", displayName: "Mossy Large Stone",
      description: "Large mossy boulder.",
    }),
    "decor/stones_4.png": D("stones_4.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      subtype: "long",
      canonicalName: "prop_stone_mossy_long_01", displayName: "Mossy Long Stone",
      description: "Long low mossy stone formation.",
    }),
    "decor/stones_5.png": D("stones_5.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      subtype: "tall",
      canonicalName: "prop_stone_mossy_tall_01", displayName: "Mossy Tall Stone",
      description: "Taller compact mossy boulder.",
    }),
    "decor/stones_6.png": D("stones_6.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "none", depthMode: "object", density: "frequent",
      subtype: "small",
      canonicalName: "prop_stone_mossy_small_01", displayName: "Mossy Small Stone",
      description: "Tiny mossy stone variant — no collision recommended.",
    }),
    "decor/stones_7.png": D("stones_7.png", {
      decorRole: "stone", placementRole: "ground-clutter", worldRole: "SHARED_1_20",
      collision: "object-footprint", depthMode: "object", density: "sparse",
      subtype: "jagged",
      canonicalName: "prop_stone_mossy_jagged_01", displayName: "Mossy Jagged Stone",
      description: "Sharply irregular/jagged mossy stone formation.",
    }),
  },
};

// --- 7. Tropical Tree Upright (tree_1) ---
const tropical_tree_upright = {
  familyKey: "tropical_tree_upright",
  canonicalFamily: "tropical_tree_upright",
  suggestedFamilyName: "Upright Green Palm",
  decorRole: "tree",
  worldRole: "SPECIAL_USE",
  collision: "trunk-footprint",
  depthMode: "tall-object",
  placementRole: "freestanding",
  notes: "Tall upright palm with broad dark-green canopy and segmented brown trunk. SPECIAL_USE — do not scatter throughout Clover Village; sourcePack and worldRole remain separate. Possible: micro-biome, greenhouse, magical garden, southern transition, water feature, future warmer region. Locked 2026-08-15.",
  assets: {
    "decor/tree_1.png": D("tree_1.png", {
      decorRole: "tree", placementRole: "freestanding", worldRole: "SPECIAL_USE",
      collision: "trunk-footprint", depthMode: "tall-object", density: "sparse", runtime: "runtime",
      canonicalName: "tree_palm_upright_green_01", displayName: "Upright Green Palm",
      description: "Tall upright palm with broad dark-green canopy and segmented brown trunk.",
      uses: ["micro-biome", "greenhouse", "magical garden", "southern transition", "water feature", "future warmer region"],
    }),
  },
};

// --- 8. Tropical Tree Leaning (tree_2) ---
const tropical_tree_leaning = {
  familyKey: "tropical_tree_leaning",
  canonicalFamily: "tropical_tree_leaning",
  suggestedFamilyName: "Leaning Green Palm",
  decorRole: "tree",
  worldRole: "SPECIAL_USE",
  collision: "trunk-footprint",
  depthMode: "tall-object",
  placementRole: "freestanding",
  notes: "Strongly leaning palm with lighter olive-green canopy. SPECIAL_USE like tree_1 — not default Clover vegetation. Locked 2026-08-15.",
  assets: {
    "decor/tree_2.png": D("tree_2.png", {
      decorRole: "tree", placementRole: "freestanding", worldRole: "SPECIAL_USE",
      collision: "trunk-footprint", depthMode: "tall-object", density: "sparse", runtime: "runtime",
      canonicalName: "tree_palm_leaning_green_01", displayName: "Leaning Green Palm",
      description: "Strongly leaning palm variant with a lighter olive-green canopy.",
      uses: ["micro-biome", "greenhouse", "magical garden", "southern transition", "water feature", "future warmer region"],
    }),
  },
};

for (const [key, fam] of Object.entries({
  village_utility_props,
  containers_storage,
  woodland_landmarks,
  construction_natural_materials,
  clover_greenery,
  mossy_stones,
  tropical_tree_upright,
  tropical_tree_leaning,
})) {
  data.reviews[`CloverVillage/${key}`] = fam;
}

await writeFile(path, JSON.stringify(data, null, 2), "utf8");
console.log("Added 8 decor families (32 assets)");
