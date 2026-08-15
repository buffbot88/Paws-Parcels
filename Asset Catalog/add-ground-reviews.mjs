#!/usr/bin/env node
// Adds the 4 Clover Village ground families to design/assets/asset-reviews.json
import { readFile, writeFile } from "node:fs/promises";

const path = "design/assets/asset-reviews.json";
const data = JSON.parse(await readFile(path, "utf8"));

// --- land_1: base texture ---
const base = {
  familyKey: "clover_grass_base",
  canonicalFamily: "clover_grass_base",
  suggestedFamilyName: "Clover Grass (Base)",
  terrainRole: "base-texture",
  tileMode: "repeat",
  topology: "verified",
  worldRole: "CLOVER_SAFE",
  walkable: true,
  collision: "none",
  runtimeStatus: "runtime",
  notes: "Seamless bright-green woodland grass texture with darker organic soil/vegetation markings, scattered dots, stones and irregular natural details. Primary underlying terrain for Clover Village — currently used as one uninterrupted repeating field; the other 25 pieces exist to break that up (terrain silhouette system). Locked 2026-08-15.",
  assets: {
    "land/land_1.png": {
      assetRole: "base-texture", terrainRole: "base-texture", tileMode: "repeat", topology: "verified",
      canonicalName: "ground_clover_grass_base_01", displayName: "Clover Grass",
      worldRole: "CLOVER_SAFE", walkable: true, collision: "none",
      runtimeStatus: "runtime", reviewStatus: "reviewed",
      description: "Seamless bright-green woodland grass base texture",
      renameStatus: "rename",
    },
  },
};

// --- land_2: irregular patch ---
const patch = {
  familyKey: "clover_grass_patch",
  canonicalFamily: "clover_grass_patch",
  suggestedFamilyName: "Irregular Clover Grass Patch",
  terrainRole: "patch",
  tileMode: "manual",
  topology: "verified",
  worldRole: "SHARED_1_20",
  walkable: true,
  collision: "none",
  notes: "Large irregular island/blob of the same green terrain surrounded by transparency. Uses: small grass islands, garden beds, terrain overlays, irregular clearings, path breakup, transition scenery. Locked 2026-08-15.",
  assets: {
    "land/land_2.png": {
      assetRole: "patch", terrainRole: "patch", tileMode: "manual", topology: "verified",
      canonicalName: "ground_clover_grass_patch_irregular_01", displayName: "Irregular Clover Grass Patch",
      worldRole: "SHARED_1_20", walkable: true, collision: "none",
      runtimeStatus: "reference", reviewStatus: "reviewed",
      description: "Irregular standalone grass island/patch with transparent surround",
      renameStatus: "rename",
    },
  },
};

// --- land_3-10: edge kit, 4 cardinal x 2 variants (a = land_3-6, b = land_7-10) ---
const edgeAssets = {};
const edgeA = { s: "land_3.png", n: "land_4.png", w: "land_5.png", e: "land_6.png" };
const edgeB = { s: "land_7.png", n: "land_8.png", w: "land_9.png", e: "land_10.png" };
for (const [dir, file] of Object.entries(edgeA)) {
  edgeAssets[`land/${file}`] = {
    assetRole: "edge", terrainRole: "edge", tileMode: "manual", topology: "verified", variant: "a",
    canonicalName: `ground_clover_grass_edge_${dir}_a`, displayName: `Clover Grass Edge — ${dir.toUpperCase()} (variant a)`,
    worldRole: "CLOVER_SAFE", walkable: true, collision: "none",
    runtimeStatus: "reference", reviewStatus: "reviewed",
    description: `Straight grass boundary edge (${dir}); organic contours`,
    renameStatus: "rename",
  };
}
for (const [dir, file] of Object.entries(edgeB)) {
  edgeAssets[`land/${file}`] = {
    assetRole: "edge", terrainRole: "edge", tileMode: "manual", topology: "verified", variant: "b",
    canonicalName: `ground_clover_grass_edge_${dir}_b`, displayName: `Clover Grass Edge — ${dir.toUpperCase()} (variant b)`,
    worldRole: "CLOVER_SAFE", walkable: true, collision: "none",
    runtimeStatus: "reference", reviewStatus: "reviewed",
    description: `Straight grass boundary edge (${dir}), variant b — alternate with variant a deterministically to avoid repeating every 256px`,
    renameStatus: "rename",
  };
}
const edge = {
  familyKey: "clover_grass_edge",
  canonicalFamily: "clover_grass_edge",
  suggestedFamilyName: "Clover Grass Edge Kit",
  terrainRole: "edge",
  tileMode: "manual",
  topology: "verified",
  worldRole: "CLOVER_SAFE",
  walkable: true,
  collision: "none",
  notes: "8 straight terrain-boundary pieces: 4 cardinal directions x 2 visual variants (land_3-6 = a: S/N/W/E; land_7-10 = b: S/N/W/E). NOT duplicates — organic contour variants (verified by alpha analysis: single solid edge band each). Preserve both variants so the map generator can alternate A/B deterministically for organic borders. Directions derived from alpha silhouette (no guessing).",
  assets: edgeAssets,
};

// --- land_11-26: corner/transition kit ---
const cornerDefs = [
  ["land_11.png", "outer-corner", "se", "accent", "Tiny organic corner accent (SE)"],
  ["land_12.png", "edge", "s", "organic", "Organic bottom-edge transition piece"],
  ["land_13.png", "outer-corner", "sw", "accent", "Tiny organic corner accent (SW)"],
  ["land_14.png", "edge", "e", "organic", "Organic right-edge transition piece"],
  ["land_15.png", "edge", "w", "organic", "Organic left-edge transition piece"],
  ["land_16.png", "outer-corner", "ne", "accent", "Tiny organic corner accent (NE)"],
  ["land_17.png", "edge", "n", "organic", "Organic top-edge transition piece"],
  ["land_18.png", "outer-corner", "nw", "accent", "Tiny organic corner accent (NW)"],
  ["land_19.png", "compound-corner", "nw", "organic-L", "Substantial organic L-shaped grass boundary (NW)"],
  ["land_20.png", "compound-corner", "ne", "organic-L", "Substantial organic L-shaped grass boundary (NE)"],
  ["land_21.png", "compound-corner", "sw", "organic-L", "Substantial organic L-shaped grass boundary (SW)"],
  ["land_22.png", "compound-corner", "se", "organic-L", "Substantial organic L-shaped grass boundary (SE)"],
  ["land_23.png", "hard-corner", "nw", "hard", "Clean 90-degree grass boundary corner (top + left)"],
  ["land_24.png", "hard-corner", "ne", "hard", "Clean 90-degree grass boundary corner (top + right)"],
  ["land_25.png", "hard-corner", "sw", "hard", "Clean 90-degree grass boundary corner (left + bottom)"],
  ["land_26.png", "hard-corner", "se", "hard", "Clean 90-degree grass boundary corner (right + bottom)"],
];
const cornerAssets = {};
for (const [file, role, dir, kind, desc] of cornerDefs) {
  const prefix = role === "edge" ? "edge" : role === "hard-corner" ? "hard_corner" : role === "compound-corner" ? "compound_corner" : "outer_corner";
  cornerAssets[`land/${file}`] = {
    assetRole: role, terrainRole: role, tileMode: "manual", topology: "verified",
    canonicalName: `ground_clover_grass_${prefix}_${dir}_01`, displayName: `Clover Grass ${role.replace("-", " ")} — ${dir.toUpperCase()}`,
    worldRole: "CLOVER_SAFE", walkable: true, collision: "none",
    runtimeStatus: "reference", reviewStatus: "reviewed",
    description: desc,
    renameStatus: "rename",
  };
}
const corner = {
  familyKey: "clover_grass_corner",
  canonicalFamily: "clover_grass_corner",
  suggestedFamilyName: "Clover Grass Corner / Transition Kit",
  terrainRole: "transition",
  tileMode: "manual",
  topology: "verified",
  worldRole: "CLOVER_SAFE",
  walkable: true,
  collision: "none",
  notes: "16 organic corner/bend/transition pieces. Composition (alpha-verified): 4 tiny corner accents (land_11/13/16/18), 4 organic edge transitions (land_12/14/15/17), 4 organic L-corners (land_19-22), 4 hard 90-degree corners (land_23-26). land_11-22 = natural landscape boundaries; land_23-26 = structured spaces (plazas, building plots, gardens, courtyards, clearings). Directions derived from alpha silhouette + quadrant analysis (no guessing).",
  assets: cornerAssets,
};

data.reviews["CloverVillage/ground_clover_grass_base"] = base;
data.reviews["CloverVillage/ground_clover_grass_patch"] = patch;
data.reviews["CloverVillage/ground_clover_grass_edge"] = edge;
data.reviews["CloverVillage/ground_clover_grass_corner"] = corner;

await writeFile(path, JSON.stringify(data, null, 2), "utf8");
console.log("Added 4 ground families (26 assets): base(1) patch(1) edge(8) corner(16)");
